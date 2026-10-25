//! Minimal replies for the headless PTY test consumer, never linked into the app.
#[derive(Default)]
pub struct Queries {
    pending: Vec<u8>,
}
impl Queries {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut replies = Vec::new();
        for &byte in bytes {
            if byte == 0x1b {
                self.pending.clear();
                self.pending.push(byte);
            } else if self.pending.as_slice() == b"\x1b" && byte == b'[' {
                self.pending.push(byte);
            } else if self.pending.starts_with(b"\x1b[") && self.pending.len() < 32 {
                self.pending.push(byte);
                if (0x40..=0x7e).contains(&byte) {
                    replies.extend_from_slice(match self.pending.as_slice() {
                        b"\x1b[6n" => b"\x1b[1;1R",
                        b"\x1b[c" | b"\x1b[0c" => b"\x1b[?1;2c",
                        b"\x1b[>c" | b"\x1b[>0c" => b"\x1b[>0;0;0c",
                        b"\x1b[5n" => b"\x1b[0n",
                        _ => b"",
                    });
                    self.pending.clear();
                }
            } else {
                self.pending.clear();
            }
        }
        replies
    }
}

#[cfg(test)]
mod tests {
    use super::Queries;

    #[test]
    fn conpty_startup_queries_are_answered_across_every_read_boundary() {
        let startup = b"\x1b[6n\x1b[c\x1b[?1004h\x1b[?9001h";
        for split in 0..=startup.len() {
            let mut queries = Queries::default();
            let mut replies = queries.feed(&startup[..split]);
            replies.extend(queries.feed(&startup[split..]));
            assert_eq!(replies, b"\x1b[1;1R\x1b[?1;2c");
        }
    }

    #[test]
    fn unknown_or_oversized_sequences_do_not_create_input() {
        let mut queries = Queries::default();
        assert!(queries.feed(b"text\x1b[?9001h\x1b[31m\x1b[").is_empty());
        assert!(queries.feed(&[b'1'; 40]).is_empty());
        assert_eq!(
            queries.feed(b"\x1b[0c\x1b[>c\x1b[5n"),
            b"\x1b[?1;2c\x1b[>0;0;0c\x1b[0n"
        );
    }
}
