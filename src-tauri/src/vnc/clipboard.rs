use super::frame::invalid;
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use std::io::{self, Read, Write};

pub const MAX_TEXT: usize = 1024 * 1024;
const TEXT: u32 = 1;
const CAPS: u32 = 1 << 24;
const REQUEST: u32 = 1 << 25;
const PEEK: u32 = 1 << 26;
const NOTIFY: u32 = 1 << 27;
const PROVIDE: u32 = 1 << 28;
const ACTIONS: u32 = REQUEST | PEEK | NOTIFY | PROVIDE;

#[derive(Default)]
pub struct Clipboard {
    peer: u32,
    // Only text explicitly sent in this session may be requested by the peer.
    offered: Option<String>,
}

fn message(data: &[u8], extended: bool) -> Vec<u8> {
    let mut msg = vec![6, 0, 0, 0];
    let n = data.len() as i32;
    msg.extend((if extended { -n } else { n }).to_be_bytes());
    msg.extend(data);
    msg
}

fn extended(flags: u32, payload: &[u8]) -> Vec<u8> {
    let mut data = flags.to_be_bytes().to_vec();
    data.extend(payload);
    message(&data, true)
}

impl Clipboard {
    pub fn offer(&mut self, text: String) -> io::Result<Vec<u8>> {
        if text.len() > MAX_TEXT {
            return Err(invalid());
        }
        if self.peer & (TEXT | NOTIFY) == TEXT | NOTIFY {
            self.offered = Some(text);
            return Ok(extended(NOTIFY | TEXT, &[]));
        }
        let bytes = text
            .replace("\r\n", "\n")
            .chars()
            .map(|ch| {
                u8::try_from(u32::from(ch)).map_err(|_| {
                    io::Error::new(
                        io::ErrorKind::InvalidInput,
                        crate::native_message::plain("vncClipboardLatin1"),
                    )
                })
            })
            .collect::<io::Result<Vec<_>>>()?;
        Ok(message(&bytes, false))
    }

    pub fn receive(&mut self, data: &[u8]) -> io::Result<(Option<Vec<u8>>, Option<String>)> {
        let (flags, body) = data.split_at_checked(4).ok_or_else(invalid)?;
        let flags = u32::from_be_bytes(flags.try_into().unwrap());
        if flags & CAPS != 0 {
            if body.len() != 4 * (flags as u16).count_ones() as usize {
                return Err(invalid());
            }
            self.peer = flags;
            return Ok((
                Some(extended(CAPS | ACTIONS | TEXT, &0u32.to_be_bytes())),
                None,
            ));
        }
        if self.peer == 0 {
            return Err(invalid());
        }
        let reply = match flags & 0xff00_0000 {
            NOTIFY if flags & TEXT != 0 && self.peer & REQUEST != 0 => {
                Some(extended(REQUEST | TEXT, &[]))
            }
            NOTIFY => {
                return Ok((None, Some(String::new())));
            }
            PEEK => Some(extended(NOTIFY | u32::from(self.offered.is_some()), &[])),
            REQUEST if flags & TEXT != 0 => {
                let Some(text) = self.offered.as_ref() else {
                    return Ok((None, None));
                };
                let text = text.replace("\r\n", "\n").replace('\n', "\r\n");
                let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
                encoder.write_all(&((text.len() + 1) as u32).to_be_bytes())?;
                encoder.write_all(text.as_bytes())?;
                encoder.write_all(&[0])?;
                Some(extended(PROVIDE | TEXT, &encoder.finish()?))
            }
            PROVIDE if flags & TEXT != 0 => {
                let mut reader = ZlibDecoder::new(body);
                let mut length = [0; 4];
                reader.read_exact(&mut length)?;
                let length = u32::from_be_bytes(length) as usize;
                if length == 0 || length > MAX_TEXT * 2 + 1 {
                    return Err(invalid());
                }
                let mut text = vec![0; length];
                reader.read_exact(&mut text)?;
                if text.pop() != Some(0) {
                    return Err(invalid());
                }
                let text = String::from_utf8(text)
                    .map_err(|_| invalid())?
                    .replace("\r\n", "\n");
                return Ok((None, Some(text)));
            }
            _ => None,
        };
        Ok((reply, None))
    }
}
