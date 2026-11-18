use super::fs::{err, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    collections::VecDeque,
    fs::File,
    io::{BufRead, BufReader, BufWriter, Write},
};

// The two handles have independent offsets. A scan can enqueue directories while
// consuming earlier ones without keeping a wide or deep tree in memory.
pub(super) struct Manifest<T> {
    memory: VecDeque<T>,
    disk: Option<Spool>,
}

struct Spool {
    reader: BufReader<File>,
    writer: BufWriter<File>,
    readable: usize,
    buffered: usize,
    line: String,
    encoded: Vec<u8>,
    written: u64,
}

impl<T: Serialize + DeserializeOwned> Manifest<T> {
    pub fn new() -> Self {
        Self {
            memory: VecDeque::new(),
            disk: None,
        }
    }

    pub fn push(&mut self, item: T) -> Result<()> {
        if self.disk.is_none() {
            if self.memory.len() < 256 {
                self.memory.push_back(item);
                return Ok(());
            }
            let file = tempfile::NamedTempFile::new().map_err(err)?;
            self.disk = Some(Spool {
                reader: BufReader::new(file.reopen().map_err(err)?),
                writer: BufWriter::new(file.reopen().map_err(err)?),
                readable: 0,
                buffered: 0,
                line: String::new(),
                encoded: Vec::new(),
                written: 0,
            });
        }
        let disk = self.disk.as_mut().unwrap();
        disk.encoded.clear();
        serde_json::to_writer(&mut disk.encoded, &item).map_err(err)?;
        disk.encoded.push(b'\n');
        disk.written += disk.encoded.len() as u64;
        if disk.written > 2 * 1024 * 1024 * 1024 {
            return Err("transferManifestLimit".into());
        }
        disk.writer.write_all(&disk.encoded).map_err(err)?;
        disk.buffered += 1;
        Ok(())
    }

    pub fn next(&mut self) -> Result<Option<T>> {
        if let Some(item) = self.memory.pop_front() {
            return Ok(Some(item));
        }
        let Some(disk) = &mut self.disk else {
            return Ok(None);
        };
        if disk.readable == 0 {
            if disk.buffered == 0 {
                return Ok(None);
            }
            disk.writer.flush().map_err(err)?;
            disk.readable = std::mem::take(&mut disk.buffered);
        }
        disk.line.clear();
        disk.reader.read_line(&mut disk.line).map_err(err)?;
        disk.readable -= 1;
        serde_json::from_str(&disk.line).map(Some).map_err(err)
    }
}
