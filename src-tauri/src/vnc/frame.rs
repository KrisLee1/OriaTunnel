//! RFB rectangles in the negotiated little-endian RGBX format.
use flate2::{Decompress, FlushDecompress};
use std::io::{self, Read};

// Up to 128 MiB of RGBA pixels per desktop, including a single 6K display.
pub const MAX_PIXELS: usize = 32 * 1024 * 1024;

pub fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Invalid or unsupported VNC message",
    )
}

pub fn pixels(w: u16, h: u16) -> io::Result<usize> {
    let n = usize::from(w) * usize::from(h);
    (n > 0 && n <= MAX_PIXELS && w <= 16384 && h <= 16384)
        .then_some(n)
        .ok_or_else(invalid)
}

pub fn packet(kind: u8, bounds: [u16; 4]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(9);
    append_header(&mut bytes, kind, bounds);
    bytes
}

pub fn append_header(bytes: &mut Vec<u8>, kind: u8, bounds: [u16; 4]) {
    bytes.push(kind);
    for n in bounds {
        bytes.extend(n.to_be_bytes());
    }
}

fn byte(data: &mut &[u8]) -> io::Result<u8> {
    let (&n, rest) = data.split_first().ok_or_else(invalid)?;
    *data = rest;
    Ok(n)
}
fn color(data: &mut &[u8]) -> io::Result<[u8; 4]> {
    let mut rgba = [255; 4];
    data.read_exact(&mut rgba[..3])?;
    Ok(rgba)
}
fn tile(mode: u8, data: &mut &[u8], w: usize, h: usize, rgba: &mut Vec<[u8; 4]>) -> io::Result<()> {
    rgba.clear();
    let entries = usize::from(mode & 127);
    if matches!(mode, 17..=127 | 129) {
        return Err(invalid());
    }
    let mut colors = [[0; 4]; 127];
    let palette = &mut colors[..entries];
    for entry in &mut *palette {
        *entry = color(data)?;
    }
    match mode {
        0 => {
            let (rgb, rest) = data.split_at_checked(w * h * 3).ok_or_else(invalid)?;
            rgba.extend(
                rgb.as_chunks::<3>()
                    .0
                    .iter()
                    .map(|&[r, g, b]| [r, g, b, 255]),
            );
            *data = rest;
        }
        3..=16 => {
            let bits = if entries <= 4 { 2 } else { 4 };
            for _ in 0..h {
                let mut packed = 0;
                for x in 0..w {
                    if x % (8 / bits) == 0 {
                        packed = byte(data)?;
                    }
                    rgba.push(
                        *palette
                            .get(usize::from(packed >> (8 - bits)))
                            .ok_or_else(invalid)?,
                    );
                    packed <<= bits;
                }
            }
        }
        _ => {
            while rgba.len() < w * h {
                let (value, run) = if entries == 0 {
                    (color(data)?, true)
                } else {
                    let index = byte(data)?;
                    (
                        *palette.get(usize::from(index & 127)).ok_or_else(invalid)?,
                        index & 128 != 0,
                    )
                };
                let mut count = 1;
                if run {
                    loop {
                        let n = byte(data)?;
                        count += usize::from(n);
                        if count > w * h - rgba.len() {
                            return Err(invalid());
                        }
                        if n != 255 {
                            break;
                        }
                    }
                }
                rgba.resize(rgba.len() + count, value);
            }
        }
    }
    Ok(())
}

/// A single zlib dictionary lasts for the whole connection. Limit expansion
/// before parsing any tile, including the worst-case single-pixel RLE runs.
pub fn zrle(
    stream: &mut Decompress,
    compressed: &[u8],
    [left, top, w, h]: [u16; 4],
    output: &mut Vec<u8>,
) -> io::Result<()> {
    let n = pixels(w, h)?;
    let (w, h) = (usize::from(w), usize::from(h));
    let limit = n * 4 + w.div_ceil(64) * h.div_ceil(64) * 382;
    let (before_in, before_out) = (stream.total_in(), stream.total_out());
    let mut decoded = Vec::with_capacity(limit + 1);
    stream
        .decompress_vec(compressed, &mut decoded, FlushDecompress::Sync)
        .map_err(|_| invalid())?;
    if stream.total_in() - before_in != compressed.len() as u64
        || stream.total_out() - before_out > limit as u64
    {
        return Err(invalid());
    }
    let mut data = decoded.as_slice();
    let mut tile_data = Vec::with_capacity(4096);
    for y in (0..h).step_by(64) {
        for x in (0..w).step_by(64) {
            let width = (w - x).min(64);
            let height = (h - y).min(64);
            let bounds = [left + x as u16, top + y as u16, width as u16, height as u16];
            let mode = byte(&mut data)?;
            if mode == 1 {
                let rgba = color(&mut data)?;
                append_header(output, 12, bounds);
                output.extend(rgba);
            } else if mode == 2 {
                let background = color(&mut data)?;
                let foreground = color(&mut data)?;
                let bytes = width.div_ceil(8) * height;
                let (indices, rest) = data.split_at_checked(bytes).ok_or_else(invalid)?;
                append_header(output, 13, bounds);
                output.extend(background);
                output.extend(foreground);
                output.extend_from_slice(indices);
                data = rest;
            } else {
                tile(mode, &mut data, width, height, &mut tile_data)?;
                append_header(output, 2, bounds);
                output.extend_from_slice(tile_data.as_flattened());
            }
        }
    }
    if !data.is_empty() {
        return Err(invalid());
    }
    Ok(())
}
