use super::{frame, rfb, session_error, Endpoint, Input, Viewer, Viewers};
use crate::native_message;
use flate2::{Compress, Compression, FlushCompress};
use std::{io, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::mpsc;
use zeroize::Zeroizing;

fn init(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = width.to_be_bytes().to_vec();
    bytes.extend(height.to_be_bytes());
    bytes.extend([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
    bytes.extend(0u32.to_be_bytes()); // empty desktop name
    bytes
}

async fn security(peer: &mut DuplexStream, offered: u16, minor: u8, auth: u8) {
    let banner = format!("RFB 003.{offered:03}\n");
    peer.write_all(banner.as_bytes()).await.unwrap();
    let mut reply = [0; 12];
    peer.read_exact(&mut reply).await.unwrap();
    assert_eq!(reply.as_slice(), format!("RFB 003.00{minor}\n").as_bytes());
    if minor == 3 {
        peer.write_u32(u32::from(auth)).await.unwrap();
    } else {
        if auth == 2 {
            peer.write_all(&[2, 1, 2]).await.unwrap();
        } else {
            peer.write_all(&[1, auth]).await.unwrap();
        }
        assert_eq!(peer.read_u8().await.unwrap(), auth);
    }
}

#[tokio::test(start_paused = true)]
async fn handshake_version_security_and_wrong_password_matrix() {
    for (offered, minor) in [(3, 3), (7, 7), (8, 8), (889, 8)] {
        for (auth, accepted) in [(1, true), (2, true), (2, false)] {
            let (socket, mut peer) = tokio::io::duplex(4096);
            let (actions, mut input) = mpsc::channel(2);
            let (out, mut events) = mpsc::channel(4);
            let client =
                tokio::spawn(async move { rfb::run(socket, &mut input, &out, None, false).await });
            security(&mut peer, offered, minor, auth).await;
            if auth == 2 {
                peer.write_all(&[7; 16]).await.unwrap();
                assert_eq!(events.recv().await.unwrap().unwrap(), [0]);
                // The network timeout must not consume time spent entering credentials.
                tokio::time::advance(Duration::from_secs(90)).await;
                actions
                    .send(Input::Password(
                        Zeroizing::new(uuid::Uuid::new_v4().to_string()),
                        false,
                    ))
                    .await
                    .unwrap();
                let mut answer = [0; 16];
                peer.read_exact(&mut answer).await.unwrap();
                assert_ne!(answer, [7; 16]);
            }
            if auth == 2 || minor == 8 {
                peer.write_u32(u32::from(!accepted)).await.unwrap();
            }
            if !accepted {
                if offered == 889 {
                    // A malformed failure reason must not hide a definitive rejection.
                    peer.write_u32(u32::MAX).await.unwrap();
                } else if minor == 8 {
                    peer.write_all(&[0, 0, 0, 3, 98, 97, 100]).await.unwrap();
                }
                let err = client.await.unwrap().unwrap_err();
                assert_eq!(
                    native_message::key(&session_error(err)).as_deref(),
                    Some("vncAuthentication")
                );
                assert!(events.recv().await.is_none());
                continue;
            }
            assert_eq!(peer.read_u8().await.unwrap(), 1, "shared ClientInit");
            peer.write_all(&init(3, 2)).await.unwrap();
            assert_eq!(
                events.recv().await.unwrap().unwrap(),
                frame::packet(1, [0, 0, 3, 2])
            );
            drop(peer);
            assert!(client.await.unwrap().is_err());
        }
    }
}

// Preload a None/3.8 stream. Capture client requests and events separately.
async fn exchange(server_bytes: &[u8]) -> (Vec<Vec<u8>>, Vec<u8>, io::Error) {
    let (socket, mut peer) = tokio::io::duplex(server_bytes.len().max(65536));
    let (_actions, mut input) = mpsc::channel(1);
    let (out, mut events) = mpsc::channel(16);
    peer.write_all(server_bytes).await.unwrap();
    peer.shutdown().await.unwrap();
    let result = rfb::run(socket, &mut input, &out, None, false)
        .await
        .unwrap_err();
    drop(out);
    let mut messages = vec![];
    while let Some(msg) = events.recv().await {
        messages.push(msg.unwrap());
    }
    let mut replies = vec![];
    peer.read_to_end(&mut replies).await.unwrap();
    (messages, replies, result)
}

fn server_prefix(w: u16, h: u16) -> Vec<u8> {
    let mut data = b"RFB 003.008\n\x01\x01\0\0\0\0".to_vec();
    data.extend(init(w, h));
    data
}

fn rectangle(bounds: [u16; 4], encoding: i32, body: &[u8]) -> Vec<u8> {
    let mut record: Vec<_> = bounds.into_iter().flat_map(u16::to_be_bytes).collect();
    record.extend(encoding.to_be_bytes());
    record.extend(body);
    record
}

#[tokio::test]
async fn apple_account_only_offer_reports_types_before_requesting_credentials() {
    let (events, sent, err) = exchange(b"RFB 003.889\n\x04\x1e\x21\x24\x23").await;
    assert_eq!(sent, b"RFB 003.008\n");
    assert!(events.is_empty());
    let error = session_error(err);
    assert_eq!(
        native_message::key(&error).as_deref(),
        Some("vncSecurityTypes")
    );
    assert!(error.contains("30, 33, 36, 35"));
}

#[tokio::test]
async fn retina_desktop_sizes_respect_the_framebuffer_budget() {
    let (w, h) = (5120, 2880);
    let mut wire = server_prefix(w, h);
    wire.extend([0, 0, 0, 1]);
    wire.extend(rectangle([w - 1, h - 1, 1, 1], 0, &[7, 8, 9, 0]));
    wire.extend([0, 0, 0, 1]);
    wire.extend(rectangle([0, 0, 6016, 3384], -223, &[]));
    let (events, _, _) = exchange(&wire).await;
    let mut pixels = vec![10];
    pixels.extend(frame::packet(2, [w - 1, h - 1, 1, 1]));
    pixels.extend([7, 8, 9, 255]);
    assert_eq!(
        events,
        [
            frame::packet(1, [0, 0, w, h]),
            pixels,
            frame::packet(1, [0, 0, 6016, 3384])
        ]
    );
    for (width, height) in [(6016, 3384), (10240, 2880)] {
        let (events, _, _) = exchange(&server_prefix(width, height)).await;
        assert_eq!(events, [frame::packet(1, [0, 0, width, height])]);
    }
}

#[tokio::test(start_paused = true)]
async fn stalled_version_security_and_server_init_expire() {
    for prefix in [
        b"RFB 0".as_slice(),
        b"RFB 003.007\n\x02\x01",
        b"RFB 003.008\n\x01\x01\0\0\0\0\0\x04",
    ] {
        let (socket, mut peer) = tokio::io::duplex(256);
        let (_actions, mut input) = mpsc::channel(1);
        let (out, mut events) = mpsc::channel(1);
        peer.write_all(prefix).await.unwrap();
        let err = rfb::run(socket, &mut input, &out, None, false)
            .await
            .unwrap_err();
        assert_eq!(
            native_message::key(&session_error(err)).as_deref(),
            Some("vncTimeout")
        );
        assert!(events.try_recv().is_err());
    }
}

#[tokio::test(start_paused = true)]
async fn a_slow_canvas_applies_backpressure_without_timing_out_or_dropping_rectangles() {
    let (socket, mut peer) = tokio::io::duplex(4096);
    let (_actions, mut input) = mpsc::channel(1);
    let (out, mut events) = mpsc::channel(1);
    let client = tokio::spawn(async move { rfb::run(socket, &mut input, &out, None, false).await });
    let mut wire = server_prefix(2, 1);
    wire.extend([0, 0, 0, 2]);
    wire.extend(rectangle([0, 0, 1, 1], 0, &[1, 2, 3, 0]));
    wire.extend(rectangle([1, 0, 1, 1], 1, &[0, 0, 0, 0]));
    peer.write_all(&wire).await.unwrap();
    let mut setup = [0; 72];
    peer.read_exact(&mut setup).await.unwrap();
    tokio::time::advance(Duration::from_secs(120)).await;
    assert!(!client.is_finished());
    assert_eq!(
        events.recv().await.unwrap().unwrap(),
        frame::packet(1, [0, 0, 2, 1])
    );
    let mut frame = vec![10];
    frame.extend(frame::packet(2, [0, 0, 1, 1]));
    frame.extend([1, 2, 3, 255]);
    frame.extend(frame::packet(3, [1, 0, 1, 1]));
    frame.extend([0; 4]);
    assert_eq!(events.recv().await.unwrap().unwrap(), frame);
    let mut request = [0; 10];
    peer.read_exact(&mut request).await.unwrap();
    assert_eq!(request, [3, 1, 0, 0, 0, 0, 0, 2, 0, 1]);
    drop(peer);
    assert!(client.await.unwrap().is_err());
}

#[tokio::test]
async fn refused_unsupported_and_oversized_handshakes_never_publish_a_desktop() {
    for (wire, key) in [
        (
            b"RFB 003.003\n\0\0\0\0\0\0\0\x01x".as_slice(),
            "vncServerRefused",
        ),
        (b"RFB 003.007\n\0\0\0\0\x01x", "vncServerRefused"),
        (b"RFB 003.008\n\0\0\0\0\x01x", "vncServerRefused"),
        (b"RFB 003.008\n\0\xff\xff\xff\xff", "vncProtocolField"),
        (b"RFB 003.003\n\0\0\0\x13", "vncSecurityTypes"),
        (b"RFB 003.007\n\x02\x12\x13", "vncSecurityTypes"),
        (b"RFB 003.008\n\x02\x12\x13", "vncSecurityTypes"),
        (b"invalid data", "vncVersion"),
    ] {
        let (events, sent, error) = exchange(wire).await;
        assert!(events.is_empty());
        let message = session_error(error);
        assert_eq!(native_message::key(&message).as_deref(), Some(key));
        if key == "vncSecurityTypes" {
            assert!(sent.len() == 12 && message.contains("19"));
        }
    }
    for (w, h) in [(0, 1), (1, 0), (16385, 1), (8192, 4097)] {
        let (events, _, err) = exchange(&server_prefix(w, h)).await;
        assert!(events.is_empty());
        assert_eq!(
            native_message::key(&session_error(err)).as_deref(),
            Some("vncDesktopSize")
        );
    }
}

#[tokio::test]
async fn split_update_commits_only_after_its_last_rectangle_is_decoded() {
    // 64 raw ZRLE tiles expand to one MiB, crossing the IPC batch limit
    // without filling the simulated socket.
    let mut tile = vec![0];
    tile.extend([1, 2, 3].repeat(64 * 64));
    let mut compressed = Vec::with_capacity(8192);
    Compress::new(Compression::fast(), true)
        .compress_vec(&tile.repeat(64), &mut compressed, FlushCompress::Sync)
        .unwrap();
    let mut body = (compressed.len() as u32).to_be_bytes().to_vec();
    body.extend(compressed);
    let mut wire = server_prefix(512, 512);
    wire.extend([0, 0, 0, 2]);
    wire.extend(rectangle([0, 0, 512, 512], 16, &body));
    // A trailing rectangle larger than the reserved 8 KiB tail starts a new batch.
    let mut trailing = [9, 8, 7, 0].repeat(64 * 64);
    trailing.pop();
    wire.extend(rectangle([0, 0, 64, 64], 0, &trailing));
    let (events, _, err) = exchange(&wire).await;
    assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    assert_eq!(events.iter().map(|e| e[0]).collect::<Vec<_>>(), [1, 9]);
    assert_eq!(events[1].len(), 1 + 64 * 9 + 512 * 512 * 4);
    wire.push(0);
    let (events, _, _) = exchange(&wire).await;
    assert_eq!(events.iter().map(|e| e[0]).collect::<Vec<_>>(), [1, 9, 10]);
    assert_eq!(&events[2][10..], [9, 8, 7, 255].repeat(64 * 64));
}

#[tokio::test]
async fn large_raw_bands_cover_the_rectangle_and_commit_only_at_the_end() {
    let (w, h) = (4093u16, 1103u16);
    let data: Vec<_> = (0..usize::from(w) * usize::from(h) * 4)
        .map(|i| (i ^ (i >> 9)) as u8)
        .collect();
    let mut wire = server_prefix(w + 7, h + 3);
    wire.extend([0, 0, 0, 1]);
    wire.extend(rectangle([7, 3, w, h], 0, &data));
    let (events, _, _) = exchange(&wire).await;
    assert!(events.len() > 2);
    let mut row = 0;
    for (i, band) in events.iter().enumerate().skip(1) {
        let rows = u16::from_be_bytes([band[8], band[9]]);
        assert!(rows > 0);
        assert_eq!(band[0], if i + 1 == events.len() { 10 } else { 9 });
        assert_eq!(
            &band[1..10],
            frame::packet(rfb::RAW_BAND_KIND, [7, 3 + row, w, rows])
        );
        let stride = usize::from(w) * 4;
        let mut expected =
            data[usize::from(row) * stride..usize::from(row + rows) * stride].to_vec();
        if cfg!(target_os = "macos") {
            for p in expected.as_chunks_mut::<4>().0 {
                p[3] = 255;
            }
        }
        assert_eq!(&band[10..], expected);
        row += rows;
    }
    assert_eq!(row, h);
    let mut with_tail = wire.clone();
    let count_offset = server_prefix(w + 7, h + 3).len() + 3;
    with_tail[count_offset] = 2;
    with_tail.extend(rectangle([0, 0, 1, 1], 0, &[9, 8, 7, 0]));
    let (tailed, _, _) = exchange(&with_tail).await;
    assert_eq!(tailed.len(), events.len());
    let last = tailed.last().unwrap();
    assert_eq!(last[0], 10);
    assert_eq!(&last[last.len() - 4..], &[9, 8, 7, 255]);
    wire.pop();
    let (events, _, err) = exchange(&wire).await;
    assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    assert!(events.iter().skip(1).all(|e| e[0] == 9));
}

#[tokio::test]
async fn malformed_or_truncated_rectangles_do_not_reach_the_canvas() {
    for (count, rect, key) in [
        (1, rectangle([1, 0, 2, 1], 0, &[]), "vncProtocolField"),
        (1, rectangle([0, 0, 2, 1], 1, &[0, 1, 0, 0]), "vncProtocol"),
        (1, rectangle([0, 0, 2, 1], 0, &[1, 2, 3]), "vncTruncated"),
        (
            1,
            rectangle([0, 0, 1, 1], 16, &[0xff; 4]),
            "vncProtocolField",
        ),
        (
            1,
            rectangle([0, 0, 1, 1], 16, &[0, 0, 0, 4, 1]),
            "vncTruncated",
        ),
        (1, rectangle([0, 0, 0, 1], -223, &[]), "vncDesktopSize"),
        (2, rectangle([0, 0, 1, 1], -223, &[]), "vncProtocol"),
        (1, rectangle([0, 0, 1, 1], 99, &[]), "vncProtocolField"),
    ] {
        let mut wire = server_prefix(2, 1);
        wire.extend([0, 0, 0, count]);
        wire.extend(rect);
        let (messages, _, error) = exchange(&wire).await;
        assert_eq!(messages, [frame::packet(1, [0, 0, 2, 1])]);
        assert_eq!(
            native_message::key(&session_error(error)).as_deref(),
            Some(key)
        );
    }
}

#[tokio::test(start_paused = true)]
async fn resize_requests_full_then_incremental_updates_and_idle_desktops_stay_open() {
    let (socket, mut peer) = tokio::io::duplex(4096);
    let (_actions, mut input) = mpsc::channel(1);
    let (out, mut events) = mpsc::channel(1);
    let client = tokio::spawn(async move { rfb::run(socket, &mut input, &out, None, false).await });
    peer.write_all(&server_prefix(2, 1)).await.unwrap();
    let mut setup = [0; 72];
    peer.read_exact(&mut setup).await.unwrap();
    assert_eq!(&setup[62..], &[3, 0, 0, 0, 0, 0, 0, 2, 0, 1]);
    events.recv().await.unwrap().unwrap();
    tokio::time::advance(Duration::from_secs(120)).await;
    assert!(!client.is_finished());
    peer.write_all(&[0, 0, 0, 1]).await.unwrap();
    peer.write_all(&rectangle([0, 0, 3, 2], -223, &[]))
        .await
        .unwrap();
    assert_eq!(
        events.recv().await.unwrap().unwrap(),
        frame::packet(1, [0, 0, 3, 2])
    );
    let mut req = [0; 10];
    peer.read_exact(&mut req).await.unwrap();
    assert_eq!(req, [3, 0, 0, 0, 0, 0, 0, 3, 0, 2]);
    peer.write_all(&[0, 0, 0, 1]).await.unwrap();
    peer.write_all(&rectangle([2, 1, 1, 1], 0, &[9, 8, 7, 0]))
        .await
        .unwrap();
    let pixels = events.recv().await.unwrap().unwrap();
    assert_eq!(pixels[0], 10);
    assert_eq!(&pixels[10..], &[9, 8, 7, 255]);
    peer.read_exact(&mut req).await.unwrap();
    assert_eq!(req, [3, 1, 0, 0, 0, 0, 0, 3, 0, 2]);
    // A partial update with an open TCP stream must end on inactivity.
    peer.write_all(&[0, 0, 0, 1, 0]).await.unwrap();
    assert_eq!(
        client.await.unwrap().unwrap_err().kind(),
        io::ErrorKind::TimedOut
    );
}

#[tokio::test]
async fn zlib_rectangles_share_their_dictionary_and_require_the_exact_pixel_count() {
    fn rect(stream: &mut Compress, x: u16, pixels: &[u8]) -> Vec<u8> {
        let mut compressed = Vec::with_capacity(128);
        stream
            .compress_vec(pixels, &mut compressed, FlushCompress::Sync)
            .unwrap();
        let mut body = (compressed.len() as u32).to_be_bytes().to_vec();
        body.extend(compressed);
        rectangle([x, 0, 1, 1], 6, &body)
    }
    let mut stream = Compress::new(Compression::fast(), true);
    let mut wire = server_prefix(2, 1);
    wire.extend([0, 0, 0, 2]);
    wire.extend(rect(&mut stream, 1, &[1, 2, 3, 0]));
    wire.extend(rect(&mut stream, 0, &[1, 2, 3, 10]));
    let (messages, _, _) = exchange(&wire).await;
    let mut expected = vec![10];
    for x in [1, 0] {
        expected.extend(frame::packet(2, [x, 0, 1, 1]));
        expected.extend([1, 2, 3, 255]);
    }
    assert_eq!(messages[1], expected);
    for pixels in [&[1, 2, 3][..], &[0; 256]] {
        let mut wire = server_prefix(1, 1);
        wire.extend([0, 0, 0, 1]);
        wire.extend(rect(
            &mut Compress::new(Compression::fast(), true),
            0,
            pixels,
        ));
        let (messages, _, err) = exchange(&wire).await;
        assert_eq!(messages.len(), 1);
        assert!(session_error(err).contains("Zlib"));
    }
}

#[test]
fn zrle_tiles_cross_edges_and_reject_decompression_or_run_overflows() {
    let compress = |src: &[u8]| {
        let mut dst = Vec::with_capacity(1024);
        Compress::new(Compression::fast(), true)
            .compress_vec(src, &mut dst, FlushCompress::Sync)
            .unwrap();
        dst
    };
    let decode = |src: &[u8], w, h| {
        let mut dst = vec![];
        frame::zrle(
            &mut flate2::Decompress::new(true),
            &compress(src),
            [0, 0, w, h],
            &mut dst,
        )
        .map(|_| dst)
    };
    let tiles = [1, 1, 2, 3, 1, 4, 5, 6, 1, 7, 8, 9, 0, 10, 11, 12];
    let patches = decode(&tiles, 65, 65).unwrap();
    let mut expected = vec![];
    for (kind, bounds, pixel) in [
        (12, [0, 0, 64, 64], [1, 2, 3, 255]),
        (12, [64, 0, 1, 64], [4, 5, 6, 255]),
        (12, [0, 64, 64, 1], [7, 8, 9, 255]),
        (2, [64, 64, 1, 1], [10, 11, 12, 255]),
    ] {
        frame::append_header(&mut expected, kind, bounds);
        expected.extend(pixel);
    }
    assert_eq!(patches, expected);
    for bad in [
        vec![0; 8192],
        vec![128, 1, 2, 3, 255],
        vec![129],
        vec![0, 1, 2],
        vec![1, 1, 2, 3, 9],
    ] {
        assert!(decode(&bad, 1, 1).is_err());
    }
}

#[tokio::test]
async fn cancelling_password_wait_releases_tcp_and_a_refused_target_reports_the_cause() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = Endpoint {
        host: "127.0.0.1".into(),
        port: listener.local_addr().unwrap().port(),
    };
    let viewers = Viewers::default();
    let mut viewer = Viewer {
        endpoint,
        session: None,
    };
    let id = viewer.begin(None, false);
    viewers.0.lock().unwrap().insert("fixture".into(), viewer);
    let session = viewers.session("fixture", &id).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        let (mut peer, _) = listener.accept().await.unwrap();
        peer.write_all(b"RFB 003.003\n\0\0\0\x02").await.unwrap();
        peer.write_all(&[0; 16]).await.unwrap();
        let mut banner = [0; 12];
        peer.read_exact(&mut banner).await.unwrap();
        assert_eq!(
            session.output.lock().await.recv().await.unwrap().unwrap(),
            [0]
        );
        viewers.stop("fixture");
        assert_eq!(peer.read(&mut banner).await.unwrap(), 0);
        assert!(viewers.session("fixture", &id).is_err());
        drop(listener);
        let retry = viewers
            .0
            .lock()
            .unwrap()
            .get_mut("fixture")
            .unwrap()
            .begin(None, false);
        let session = viewers.session("fixture", &retry).unwrap();
        let error = session
            .output
            .lock()
            .await
            .recv()
            .await
            .unwrap()
            .unwrap_err();
        assert_eq!(
            native_message::key(&error).as_deref(),
            Some("vncUnreachable")
        );
    })
    .await
    .unwrap();
}
