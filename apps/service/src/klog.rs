//! Lossless Kaffelogic `.klog` ingestion lives here. It is kept independent
//! from serial transport so fixtures and imported files exercise identical
//! parsing code.

#[derive(Debug, thiserror::Error)]
pub enum KlogError {
    #[error("Kaffelogic log is not valid UTF-8")]
    InvalidUtf8,
    #[error("Kaffelogic log has no time-series table")]
    MissingTable,
}

pub fn sniff(input: &[u8]) -> bool {
    std::str::from_utf8(input)
        .map(|text| {
            text.lines().any(|line| {
                line.to_ascii_lowercase().starts_with("time\t")
                    || line.to_ascii_lowercase().starts_with("time,")
            })
        })
        .unwrap_or(false)
}
