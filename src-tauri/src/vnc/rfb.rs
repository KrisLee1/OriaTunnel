use super::{
    clipboard::{Clipboard, MAX_TEXT},
    frame::{self, invalid},
    Input,
};
use des::{
    cipher::{BlockCipherEncrypt, KeyInit},
    Des,
};
use flate2::{Decompress, FlushDecompress};
use std::{
    io,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader, ReadBuf},
    sync::mpsc,
};
use zeroize::Zeroizing;

pub type Events = mpsc::Sender<Result<Vec<u8>, String>>;
const IO_TIMEOUT: Duration = Duration::from_secs(20);
// Small rectangles share a response. Large Raw rectangles can be staged in
// whole rows while the socket is still receiving the rest of the update.
const BATCH_BYTES: usize = 1024 * 1024;
const RAW_BAND_BYTES: usize = 16 * 1024 * 1024;
pub(super) const RAW_BAND_KIND: u8 = if cfg!(target_os = "macos") { 2 } else { 11 };
const RAW_TAIL_BYTES: usize = 8 * 1024;
const UPDATE_PART: u8 = 9;
const UPDATE_END: u8 = 10;

// Only arm the timer while a read *inside* a server message is pending. Waiting
// for the next update, the user, or the bounded UI channel has no deadline.
struct MessageReader<'a, R> {
    reader: &'a mut R,
    deadline: Option<Pin<Box<tokio::time::Sleep>>>,
}
impl<R: AsyncRead + Unpin> AsyncRead for MessageReader<'_, R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        dst: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        use std::future::Future;
        let remaining = dst.remaining();
        if let Poll::Ready(result) = Pin::new(&mut *self.reader).poll_read(cx, dst) {
            self.deadline = None;
            if result.is_ok() && remaining != 0 && dst.remaining() == remaining {
                return Poll::Ready(Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    crate::native_message::plain("vncTruncated"),
                )));
            }
            return Poll::Ready(result);
        }
        let timer = self
            .deadline
            .get_or_insert_with(|| Box::pin(tokio::time::sleep(IO_TIMEOUT)));
        timer
            .as_mut()
            .poll(cx)
            .map(|_| Err(io::ErrorKind::TimedOut.into()))
    }
}
async fn event(out: &Events, bytes: Vec<u8>) -> io::Result<()> {
    out.send(Ok(bytes))
        .await
        .map_err(|_| io::ErrorKind::BrokenPipe.into())
}
async fn bytes(
    reader: &mut (impl AsyncRead + Unpin),
    len: usize,
    limit: usize,
    field: &str,
) -> io::Result<Vec<u8>> {
    if len > limit {
        return Err(protocol_field(field, len));
    }
    let mut data = vec![0; len];
    reader.read_exact(&mut data).await?;
    Ok(data)
}
async fn discard_reason(stream: &mut (impl AsyncRead + Unpin)) -> io::Result<()> {
    let n = stream.read_u32().await?;
    bytes(stream, n as usize, 4096, "ConnectionFailed.reasonLength").await?;
    Ok(())
}
async fn refused<T>(stream: &mut (impl AsyncRead + Unpin)) -> io::Result<T> {
    discard_reason(stream).await?;
    Err(io::Error::new(
        io::ErrorKind::ConnectionAborted,
        crate::native_message::plain("vncServerRefused"),
    ))
}

async fn negotiate<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> io::Result<(u8, u8)> {
    let mut banner = [0; 12];
    s.read_exact(&mut banner).await?;
    // Apple Screen Sharing advertises 3.889 and accepts a standard 3.8 reply.
    if &banner == b"RFB 003.889\n" {
        banner = *b"RFB 003.008\n";
    }
    let minor = match &banner {
        b"RFB 003.003\n" => 3,
        b"RFB 003.007\n" => 7,
        b"RFB 003.008\n" => 8,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                crate::native_message::plain("vncVersion"),
            ))
        }
    };
    s.write_all(&banner).await?;
    let auth = if minor == 3 {
        match s.read_u32().await? {
            0 => return refused(s).await,
            1 => 1,
            2 => 2,
            other => return Err(unsupported_security(other.to_string())),
        }
    } else {
        let n = s.read_u8().await?;
        if n == 0 {
            return refused(s).await;
        }
        let types = bytes(s, usize::from(n), 255, "SecurityTypes.count").await?;
        let auth = if types.contains(&2) {
            2
        } else if types.contains(&1) {
            1
        } else {
            let offered = types
                .iter()
                .map(u8::to_string)
                .collect::<Vec<_>>()
                .join(", ");
            return Err(unsupported_security(offered));
        };
        s.write_u8(auth).await?;
        auth
    };
    Ok((minor, auth))
}

fn unsupported_security(types: String) -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        crate::native_message::message("vncSecurityTypes", serde_json::json!({ "types": types })),
    )
}

fn response(password: &str, challenge: &mut [u8; 16]) -> io::Result<()> {
    let mut key = Zeroizing::new([0u8; 8]);
    for (dst, ch) in key.iter_mut().zip(password.chars()) {
        *dst = u8::try_from(u32::from(ch))
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    crate::native_message::plain("vncPasswordCharset"),
                )
            })?
            .reverse_bits();
    }
    let cipher = Des::new_from_slice(key.as_slice()).map_err(|_| invalid())?;
    for chunk in challenge.as_chunks_mut::<8>().0 {
        cipher.encrypt_block(chunk.into());
    }
    Ok(())
}

fn request(w: u16, h: u16, incremental: bool) -> Vec<u8> {
    let mut data = vec![3, u8::from(incremental), 0, 0, 0, 0];
    data.extend(w.to_be_bytes());
    data.extend(h.to_be_bytes());
    data
}

fn protocol_field(field: &str, value: impl std::fmt::Display) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        crate::native_message::message(
            "vncProtocolField",
            serde_json::json!({ "field": field, "value": value.to_string() }),
        ),
    )
}

fn desktop_size(width: u16, height: u16) -> io::Result<()> {
    frame::pixels(width, height).map(|_| ()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            crate::native_message::message(
                "vncDesktopSize",
                serde_json::json!({ "width": width, "height": height, "limit": frame::MAX_PIXELS }),
            ),
        )
    })
}

async fn initialize<S: AsyncRead + AsyncWrite + Unpin>(
    s: &mut S,
    minor: u8,
    auth: u8,
) -> io::Result<(u16, u16)> {
    if auth == 2 || minor == 8 {
        match s.read_u32().await? {
            0 => {}
            1 | 2 => {
                // The status is definitive. Some servers omit or misframe the
                // optional explanation; we close this failed session immediately.
                let key = if auth == 2 {
                    "vncAuthentication"
                } else {
                    "vncServerRefused"
                };
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    crate::native_message::plain(key),
                ));
            }
            status => return Err(protocol_field("SecurityResult", status)),
        }
    }
    s.write_u8(1).await?; // Shared desktop
    let (w, h) = (s.read_u16().await?, s.read_u16().await?);
    desktop_size(w, h)?;
    let mut format = [0; 16];
    s.read_exact(&mut format).await?;
    let len = s.read_u32().await?;
    bytes(s, len as usize, 65536, "ServerInit.nameLength").await?;
    // RGBX on the wire, with red in the least significant byte.
    s.write_all(&[
        0, 0, 0, 0, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 0, 8, 16, 0, 0, 0,
    ])
    .await?;
    let encodings = [16i32, 1, 6, 0, -223, 0xc0a1e5ceu32 as i32];
    let mut msg = vec![2, 0, 0, encodings.len() as u8];
    for code in encodings {
        msg.extend(code.to_be_bytes());
    }
    s.write_all(&msg).await?;
    s.write_all(&request(w, h, false)).await?;
    Ok((w, h))
}

async fn notice(out: &Events, message: &str) -> io::Result<()> {
    let mut packet = vec![6];
    packet.extend(message.bytes());
    event(out, packet).await
}

pub async fn run<S: AsyncRead + AsyncWrite + Unpin>(
    mut s: S,
    inputs: &mut mpsc::Receiver<Input>,
    out: &Events,
    vault: Option<&crate::credentials::VncCredential>,
    skip_saved: bool,
) -> io::Result<()> {
    let timeout = IO_TIMEOUT;
    let (minor, auth) = tokio::time::timeout(timeout, negotiate(&mut s)).await??;
    let mut pending_password = None;
    let mut used_saved = false;
    if auth == 2 {
        let mut challenge = Zeroizing::new([0; 16]);
        tokio::time::timeout(timeout, s.read_exact(&mut *challenge)).await??;
        let saved = match vault.filter(|_| !skip_saved).map(|v| v.read()).transpose() {
            Ok(password) => password.flatten(),
            Err(message) => {
                notice(out, &message).await?;
                None
            }
        };
        let (password, remember) = if let Some(saved) = saved {
            used_saved = true;
            (saved, false)
        } else {
            event(out, if vault.is_some() { vec![0, 1] } else { vec![0] }).await?;
            let input = tokio::select! {
                result = s.read_u8() => { result?; return Err(invalid()); }
                input = inputs.recv() => input,
            };
            let Some(Input::Password(password, remember)) = input else {
                return Err(invalid());
            };
            (password, remember)
        };
        response(&password, &mut challenge)?;
        if remember || used_saved {
            pending_password = Some(password);
        }
        tokio::time::timeout(timeout, s.write_all(&*challenge)).await??;
    }
    let initialized = tokio::time::timeout(timeout, initialize(&mut s, minor, auth)).await?;
    if let (Some(vault), Some(password)) = (vault, pending_password.take()) {
        match &initialized {
            Ok(_) => {
                let saved = if used_saved {
                    Ok(())
                } else {
                    vault.save(&password)
                };
                match saved {
                    Ok(()) => event(out, vec![7]).await?,
                    Err(message) => notice(out, &message).await?,
                }
            }
            Err(e)
                if used_saved
                    && crate::native_message::key(&e.to_string()).as_deref()
                        == Some("vncAuthentication") =>
            {
                if let Err(message) = vault.forget_rejected(&password) {
                    notice(out, &message).await?;
                }
                event(out, vec![8]).await?;
            }
            Err(_) => {}
        }
    }
    let (w, h) = initialized?;
    event(out, frame::packet(1, [0, 0, w, h])).await?;
    let (reader, mut writer) = tokio::io::split(s);
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(8);
    let clipboard = Arc::new(Mutex::new(Clipboard::default()));
    let read = updates(BufReader::new(reader), w, h, out, tx, clipboard.clone());
    let write = async {
        loop {
            let data = tokio::select! {
                biased;
                input = inputs.recv() => match input {
                    Some(Input::Wire(data)) => data,
                    Some(Input::Clipboard { text, keys }) => {
                        let offered = clipboard.lock().unwrap().offer(text);
                        match offered {
                            Ok(mut data) => { data.extend(keys); data },
                            Err(e) => { notice(out, &e.to_string()).await?; continue; }
                        }
                    }
                    _ => return Err(invalid()),
                },
                msg = rx.recv() => msg.ok_or_else(invalid)?,
            };
            tokio::time::timeout(timeout, writer.write_all(&data)).await??;
        }
    };
    tokio::select! { biased; result=write => result, result=read => result }
}

fn within([x, y, w, h]: [u16; 4], width: u16, height: u16) -> io::Result<()> {
    if w == 0
        || h == 0
        || u32::from(x) + u32::from(w) > u32::from(width)
        || u32::from(y) + u32::from(h) > u32::from(height)
    {
        Err(invalid())
    } else {
        Ok(())
    }
}

async fn stage_large_raw(
    reader: &mut (impl AsyncRead + Unpin),
    out: &Events,
    batch: &mut Vec<u8>,
    [x, y, w, h]: [u16; 4],
) -> io::Result<()> {
    let stride = usize::from(w) * 4;
    let rows_per_batch = (RAW_BAND_BYTES / stride).min(usize::from(h)) as u16;
    let mut row = 0;
    while row < h {
        let rows = rows_per_batch.min(h - row);
        let len = usize::from(rows) * stride;
        if batch.len() > 1 {
            event(out, std::mem::replace(batch, vec![UPDATE_PART])).await?;
        }
        batch.reserve_exact(9 + len + RAW_TAIL_BYTES);
        frame::append_header(batch, RAW_BAND_KIND, [x, y + row, w, rows]);
        // read_buf appends only initialized socket bytes to the reserved Vec.
        let mut band = (&mut *reader).take(len as u64);
        while band.limit() != 0 {
            if band.read_buf(batch).await? == 0 {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
        }
        #[cfg(target_os = "macos")]
        {
            let start = batch.len() - len;
            for pixel in batch[start..].as_chunks_mut::<4>().0 {
                pixel[3] = 255;
            }
        }
        row += rows;
    }
    Ok(())
}

async fn updates<R: AsyncRead + Unpin>(
    mut reader: R,
    mut width: u16,
    mut height: u16,
    out: &Events,
    tx: mpsc::Sender<Vec<u8>>,
    clipboard: Arc<Mutex<Clipboard>>,
) -> io::Result<()> {
    let mut zrle_stream = Decompress::new(true);
    let mut zlib_stream = Decompress::new(true);
    loop {
        let mut reply = None;
        let kind = reader.read_u8().await?;
        let mut r = MessageReader {
            reader: &mut reader,
            deadline: None,
        };
        match kind {
            0 => {
                r.read_u8().await?;
                let count = r.read_u16().await?;
                let mut resized = false;
                let mut large_update = false;
                let mut batch = vec![UPDATE_PART];
                let mut tail_limit = 0;
                for index in 0..count {
                    let bounds = [
                        r.read_u16().await?,
                        r.read_u16().await?,
                        r.read_u16().await?,
                        r.read_u16().await?,
                    ];
                    let [_, _, w, h] = bounds;
                    let encoding = r.read_i32().await?;
                    if encoding == -223 {
                        if index + 1 != count {
                            return Err(invalid());
                        }
                        desktop_size(w, h)?;
                        width = w;
                        height = h;
                        resized = true;
                        event(out, frame::packet(1, [0, 0, w, h])).await?;
                        continue;
                    }
                    if !matches!(encoding, 0 | 1 | 6 | 16) {
                        return Err(protocol_field("FramebufferUpdate.encoding", encoding));
                    }
                    within(bounds, width, height).map_err(|_| {
                        protocol_field(
                            "FramebufferUpdate.rectangle",
                            format_args!("{bounds:?} / {width}×{height}"),
                        )
                    })?;
                    let n = frame::pixels(w, h)?;
                    let payload = if encoding == 1 { 4 } else { n * 4 };
                    if encoding == 0 && payload > BATCH_BYTES {
                        stage_large_raw(&mut r, out, &mut batch, bounds).await?;
                        large_update = true;
                        tail_limit = batch.capacity().min(batch.len() + RAW_TAIL_BYTES);
                        continue;
                    }
                    // Piggyback small Raw/CopyRect records on a large final band
                    // or compressed patch when this costs no extra allocation.
                    let next_len = batch.len() + 9 + payload;
                    let fits_tail = matches!(encoding, 0 | 1) && next_len <= tail_limit;
                    if batch.len() > 1 && !fits_tail && next_len > BATCH_BYTES {
                        event(out, std::mem::replace(&mut batch, vec![UPDATE_PART])).await?;
                        tail_limit = 0;
                    }
                    if matches!(encoding, 6 | 16) && payload > BATCH_BYTES {
                        large_update = true;
                    }
                    match encoding {
                        0 => {
                            frame::append_header(&mut batch, 2, bounds);
                            let start = batch.len();
                            batch.resize(start + payload, 0);
                            r.read_exact(&mut batch[start..]).await?;
                            for p in batch[start..].as_chunks_mut::<4>().0 {
                                p[3] = 255;
                            }
                        }
                        1 => {
                            let (sx, sy) = (r.read_u16().await?, r.read_u16().await?);
                            within([sx, sy, w, h], width, height)?;
                            frame::append_header(&mut batch, 3, bounds);
                            batch.extend(sx.to_be_bytes());
                            batch.extend(sy.to_be_bytes());
                        }
                        6 => {
                            let len = r.read_u32().await?;
                            let compressed =
                                bytes(&mut r, len as usize, n * 5 + 65536, "Zlib.length").await?;
                            frame::append_header(&mut batch, 2, bounds);
                            let start = batch.len();
                            // One extra byte distinguishes exact-size output from an
                            // oversized rectangle whose remaining bytes are buffered.
                            batch.resize(start + payload + 1, 0);
                            let (before_in, before_out) =
                                (zlib_stream.total_in(), zlib_stream.total_out());
                            let decoded = zlib_stream.decompress(
                                &compressed,
                                &mut batch[start..],
                                FlushDecompress::Sync,
                            );
                            if decoded.is_err()
                                || zlib_stream.total_in() - before_in != u64::from(len)
                                || zlib_stream.total_out() - before_out != payload as u64
                            {
                                return Err(protocol_field(
                                    "Zlib",
                                    format_args!("{w}×{h}, {len} B"),
                                ));
                            }
                            batch.pop();
                            for pixel in batch[start..].as_chunks_mut::<4>().0 {
                                pixel[3] = 255;
                            }
                        }
                        16 => {
                            let len = r.read_u32().await?;
                            let compressed =
                                bytes(&mut r, len as usize, n * 5 + 65536, "ZRLE.length").await?;
                            frame::zrle(&mut zrle_stream, &compressed, bounds, &mut batch)
                                .map_err(|_| {
                                    protocol_field("ZRLE", format_args!("{w}×{h}, {len} B"))
                                })?;
                        }
                        _ => return Err(invalid()),
                    }
                    if matches!(encoding, 6 | 16) && batch.len() > BATCH_BYTES {
                        tail_limit = batch.capacity().min(batch.len() + RAW_TAIL_BYTES);
                    }
                }
                // DesktopSize discards the old framebuffer, including any
                // staged rectangles. The next request asks for all new pixels.
                if !resized && count != 0 {
                    batch[0] = UPDATE_END;
                    event(out, batch).await?;
                    if large_update {
                        // Wait for the viewer to pull this frame before asking the
                        // server to choose the pixels for another expensive update.
                        drop(out.reserve().await.map_err(|_| invalid())?);
                    }
                }
                reply = Some(request(width, height, !resized));
            }
            2 => {} // Bell has no payload
            3 => {
                let mut padding = [0; 3];
                r.read_exact(&mut padding).await?;
                let len = r.read_i32().await?;
                let limit = if len >= 0 {
                    MAX_TEXT
                } else {
                    MAX_TEXT * 2 + 4096
                };
                let data = bytes(
                    &mut r,
                    len.unsigned_abs() as usize,
                    limit,
                    "ServerCutText.length",
                )
                .await?;
                let text = if len >= 0 {
                    Some(data.iter().copied().map(char::from).collect())
                } else {
                    let (answer, text) = clipboard.lock().unwrap().receive(&data)?;
                    reply = answer;
                    text
                };
                if let Some(text) = text {
                    let mut msg = vec![4];
                    msg.extend(text.bytes());
                    event(out, msg).await?;
                }
            }
            _ => return Err(protocol_field("ServerMessage.type", kind)),
        }
        if let Some(data) = reply {
            tx.send(data).await.map_err(|_| invalid())?;
        }
    }
}
