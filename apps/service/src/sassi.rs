//! Kaffeelogic SASSI framing and session support.
//!
//! The implementation is deliberately independent of HTTP and SQLite. The
//! direct serial actor in `device` is the only module allowed to combine this
//! codec with physical I/O.

pub const FRAME_TERMINATOR: u8 = 0x0d;

pub fn crc16_ccitt_xmodem(input: &[u8], initial: u16) -> u16 {
    let mut crc = initial;
    for byte in input {
        crc ^= u16::from(*byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 == 0 {
                crc << 1
            } else {
                (crc << 1) ^ 0x1021
            };
        }
    }
    crc
}

pub fn encode_frame(
    kind: u8,
    elapsed_ms: u64,
    fields: &[&str],
    crc_seed: u16,
) -> Result<Vec<u8>, &'static str> {
    if fields.iter().any(|field| {
        field
            .bytes()
            .any(|byte| !(0x20..=0x7e).contains(&byte) || matches!(byte, b'|' | b'\r'))
    }) {
        return Err("invalid_sassi_field");
    }
    let payload = if fields.is_empty() {
        String::new()
    } else {
        format!("{}|", fields.join("|"))
    };
    let body = format!("KL*{kind}|{elapsed_ms:x}|{payload}");
    let crc = crc16_ccitt_xmodem(body.as_bytes(), crc_seed);
    Ok(format!("{body}{crc:04x}\r").into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_the_standard_check_vector() {
        assert_eq!(crc16_ccitt_xmodem(b"123456789", 0), 0x31c3);
    }

    #[test]
    fn encodes_seeded_cr_terminated_frames() {
        let frame = encode_frame(1, 15, &[], 0).unwrap();
        assert!(frame.starts_with(b"KL*1|f|"));
        assert_eq!(frame.last(), Some(&FRAME_TERMINATOR));
    }
}
