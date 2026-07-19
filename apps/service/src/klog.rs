//! Lossless, fail-closed Kaffelogic `.klog` parsing and transactional SQLite
//! projection. Original bytes are always retained before any derived values
//! become the active roast record.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::Database;

const MAX_ROWS: usize = 250_000;
const MAX_COLUMNS: usize = 256;
const MAX_VALUE: f64 = 1_000_000_000_000.0;
const MIN_ELAPSED_MS: i64 = -3_600_000;
const MAX_ELAPSED_MS: i64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_RETAINED_FILE: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelUnit {
    Celsius,
    CelsiusPerMinute,
    Kilowatts,
    Rpm,
    Unitless,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub key: String,
    pub name: String,
    pub raw_name: String,
    pub source_index: usize,
    pub offset_ms: i64,
    pub unit: ChannelUnit,
    pub hidden_by_default: bool,
    pub reuse_previous_scale: bool,
    pub special_processing: bool,
}

#[derive(Debug, Clone)]
pub struct Sample {
    pub sample_seq: usize,
    pub elapsed_ms: i64,
    pub values: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Diagnostic {
    pub severity: &'static str,
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct Event {
    pub kind: String,
    pub elapsed_ms: i64,
}

#[derive(Debug, Clone)]
pub struct Document {
    pub source_hash: String,
    pub metadata: BTreeMap<String, String>,
    pub channels: Vec<Channel>,
    pub samples: Vec<Sample>,
    pub events: Vec<Event>,
    pub diagnostics: Vec<Diagnostic>,
    pub safe_to_import: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum KlogError {
    #[error("Kaffelogic log is not valid UTF-8")]
    InvalidUtf8,
    #[error("Kaffelogic log has no time-series table")]
    MissingTable,
    #[error("Kaffelogic log exceeds parser limits")]
    TooLarge,
    #[error("Kaffelogic log cannot be projected safely: {0}")]
    Unsafe(String),
    #[error("Kaffelogic database operation failed")]
    Database(#[from] rusqlite::Error),
}

pub fn parse(input: &[u8]) -> Result<Document, KlogError> {
    if input.len() > MAX_RETAINED_FILE {
        return Err(KlogError::TooLarge);
    }
    let source = std::str::from_utf8(input).map_err(|_| KlogError::InvalidUtf8)?;
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let lines: Vec<_> = source.lines().collect();
    let header_index = lines
        .iter()
        .position(|line| {
            let lower = line.trim_start().to_ascii_lowercase();
            lower.starts_with("time\t") || lower.starts_with("time,")
        })
        .ok_or(KlogError::MissingTable)?;
    let header_cells = cells(lines[header_index]);
    if header_cells.len() < 2
        || header_cells.len() > MAX_COLUMNS
        || !header_cells[0].trim().eq_ignore_ascii_case("time")
    {
        return Err(KlogError::TooLarge);
    }
    let mut diagnostics = Vec::new();
    let offsets = parse_offsets(
        header_index
            .checked_sub(1)
            .and_then(|index| lines.get(index).copied()),
        header_cells.len() - 1,
        &mut diagnostics,
        header_index,
    );
    let channels = parse_channels(&header_cells[1..], &offsets, &mut diagnostics)?;
    let mut metadata = BTreeMap::new();
    for (index, line) in lines[..header_index].iter().enumerate() {
        if line.is_empty()
            || line.to_ascii_lowercase().starts_with("offsets\t")
            || line.to_ascii_lowercase().starts_with("offsets,")
        {
            continue;
        }
        if let Some((key, value)) = property(line) {
            validate_property(&key, &value)?;
            metadata.insert(key, value);
        } else {
            diagnostic(
                &mut diagnostics,
                "warning",
                "unknown_metadata_line",
                "Preserved an unrecognised metadata line",
                Some(index + 1),
            );
        }
    }

    let mut samples = Vec::new();
    for (index, line) in lines.iter().enumerate().skip(header_index + 1) {
        if line.is_empty() {
            continue;
        }
        if let Some(incidental) = line.strip_prefix('!') {
            if let Some((key, value)) = property(incidental) {
                validate_property(&key, &value)?;
                metadata.insert(key, value);
            } else {
                diagnostic(
                    &mut diagnostics,
                    "warning",
                    "invalid_incidental",
                    "Ignored malformed incidental override",
                    Some(index + 1),
                );
            }
            continue;
        }
        if samples.len() >= MAX_ROWS {
            return Err(KlogError::TooLarge);
        }
        let row = cells(line);
        if row.len() < header_cells.len() {
            diagnostic(
                &mut diagnostics,
                "error",
                "short_row",
                "Ignored an incomplete telemetry row",
                Some(index + 1),
            );
            continue;
        }
        let trailing_empty = row.len() == header_cells.len() + 1 && row.last() == Some(&"");
        if row.len() > header_cells.len() && !trailing_empty {
            diagnostic(
                &mut diagnostics,
                "error",
                "extra_cells",
                "Ignored extra telemetry cells",
                Some(index + 1),
            );
        }
        let Ok(seconds) = row[0].trim().parse::<f64>() else {
            diagnostic(
                &mut diagnostics,
                "error",
                "unknown_table_line",
                "Ignored a non-numeric telemetry row",
                Some(index + 1),
            );
            continue;
        };
        let elapsed_ms = scaled_integer(seconds, 1_000.0)
            .filter(|value| (MIN_ELAPSED_MS..=MAX_ELAPSED_MS).contains(value));
        let Some(elapsed_ms) = elapsed_ms else {
            diagnostic(
                &mut diagnostics,
                "error",
                "invalid_time",
                "Telemetry time is outside the supported range",
                Some(index + 1),
            );
            continue;
        };
        let mut values = BTreeMap::new();
        for (channel_index, channel) in channels.iter().enumerate() {
            let raw = row
                .get(channel_index + 1)
                .copied()
                .unwrap_or_default()
                .trim();
            let value = raw
                .parse::<f64>()
                .ok()
                .filter(|value| value.is_finite() && value.abs() <= MAX_VALUE);
            if let Some(value) = value {
                values.insert(channel.key.clone(), value);
            } else {
                diagnostic(
                    &mut diagnostics,
                    "error",
                    "invalid_number",
                    format!("Replaced invalid {} with zero", channel.raw_name),
                    Some(index + 1),
                );
                values.insert(channel.key.clone(), 0.0);
            }
        }
        samples.push(Sample {
            sample_seq: samples.len(),
            elapsed_ms,
            values,
        });
    }
    if samples.is_empty() {
        diagnostic(
            &mut diagnostics,
            "error",
            "no_samples",
            "The telemetry table has no complete rows",
            None,
        );
    }
    if !channels.iter().any(|channel| {
        matches!(
            channel.name.as_str(),
            "temp" | "mean_temp" | "spot_temp" | "BT" | "Bean_temp" | "Bean_temperature"
        )
    }) {
        diagnostic(
            &mut diagnostics,
            "error",
            "missing_master_temperature",
            "No supported bean-temperature channel is present",
            None,
        );
    }
    let mut events = Vec::new();
    for key in [
        "colour_change",
        "first_crack",
        "first_crack_end",
        "second_crack",
        "second_crack_end",
        "roast_end",
        "anti_beanlock",
    ] {
        let Some(raw) = metadata.get(key) else {
            continue;
        };
        let Ok(seconds) = raw.parse::<f64>() else {
            diagnostic(
                &mut diagnostics,
                "error",
                "invalid_event",
                format!("The {key} event is invalid"),
                None,
            );
            continue;
        };
        if seconds == 0.0 {
            continue;
        }
        if let Some(elapsed_ms) = scaled_integer(seconds, 1_000.0)
            .filter(|value| (MIN_ELAPSED_MS..=MAX_ELAPSED_MS).contains(value))
        {
            events.push(Event {
                kind: key.into(),
                elapsed_ms,
            });
        } else {
            diagnostic(
                &mut diagnostics,
                "error",
                "invalid_event",
                format!("The {key} event is outside the supported range"),
                None,
            );
        }
    }
    let safe_to_import = !diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == "error");
    Ok(Document {
        source_hash: hex::encode(Sha256::digest(input)),
        metadata,
        channels,
        samples,
        events,
        diagnostics,
        safe_to_import,
    })
}

fn cells(line: &str) -> Vec<&str> {
    line.split(|character| character == '\t' || character == ',')
        .collect()
}

fn property(line: &str) -> Option<(String, String)> {
    let (key, value) = line.split_once(':')?;
    let key = key.trim().replace(' ', "_");
    (!key.is_empty()).then(|| (key, value.trim().to_owned()))
}

fn validate_property(key: &str, value: &str) -> Result<(), KlogError> {
    if key.len() > 256 || key.chars().any(char::is_control) || value.len() > 256 * 1024 {
        Err(KlogError::Unsafe(
            "metadata field exceeds parser limits".into(),
        ))
    } else {
        Ok(())
    }
}

fn parse_offsets(
    line: Option<&str>,
    count: usize,
    diagnostics: &mut Vec<Diagnostic>,
    line_number: usize,
) -> Vec<f64> {
    let Some(line) = line.filter(|line| {
        line.to_ascii_lowercase().starts_with("offsets\t")
            || line.to_ascii_lowercase().starts_with("offsets,")
    }) else {
        return vec![0.0; count];
    };
    let values = cells(line);
    (0..count)
        .map(|index| {
            let value = values
                .get(index + 1)
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| {
                    value.is_finite() && value.abs() <= MAX_ELAPSED_MS as f64 / 1_000.0
                });
            value.unwrap_or_else(|| {
                diagnostic(
                    diagnostics,
                    "error",
                    "invalid_offset",
                    format!("Channel {} has an invalid offset", index + 1),
                    Some(line_number),
                );
                0.0
            })
        })
        .collect()
}

fn parse_channels(
    raw_names: &[&str],
    offsets: &[f64],
    diagnostics: &mut Vec<Diagnostic>,
) -> Result<Vec<Channel>, KlogError> {
    let mut occurrences = HashMap::new();
    raw_names
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            if raw.is_empty() || raw.len() > 256 || raw.chars().any(char::is_control) {
                return Err(KlogError::Unsafe("invalid channel name".into()));
            }
            let mut cursor = 0;
            let mut hidden = false;
            let mut reuse = false;
            let mut special = false;
            let mut temperature = false;
            let mut ror = false;
            let mut fan = false;
            for character in raw.chars() {
                match character {
                    '#' => hidden = true,
                    '=' => reuse = true,
                    '~' => special = true,
                    '@' => temperature = true,
                    '&' => ror = true,
                    '^' => fan = true,
                    _ => break,
                }
                cursor += character.len_utf8();
            }
            let name = if cursor == raw.len() {
                format!("channel_{}", index + 1)
            } else {
                raw[cursor..].to_owned()
            };
            let occurrence = occurrences.entry(name.clone()).or_insert(0usize);
            *occurrence += 1;
            let key = if *occurrence == 1 {
                name.clone()
            } else {
                diagnostic(
                    diagnostics,
                    "warning",
                    "duplicate_channel",
                    format!("Disambiguated duplicate channel {name}"),
                    None,
                );
                format!("{name}__{}", *occurrence)
            };
            let unit = if fan || matches!(name.as_str(), "actual_fan_RPM" | "fan_speed") {
                ChannelUnit::Rpm
            } else if ror || matches!(name.as_str(), "profile_ROR" | "actual_ROR" | "desired_ROR") {
                ChannelUnit::CelsiusPerMinute
            } else if temperature
                || matches!(
                    name.as_str(),
                    "spot_temp"
                        | "temp"
                        | "mean_temp"
                        | "profile"
                        | "BT"
                        | "Bean_temp"
                        | "Bean_temperature"
                )
            {
                ChannelUnit::Celsius
            } else if name == "power_kW" {
                ChannelUnit::Kilowatts
            } else {
                ChannelUnit::Unitless
            };
            Ok(Channel {
                key,
                name,
                raw_name: (*raw).into(),
                source_index: index,
                offset_ms: (offsets.get(index).copied().unwrap_or(0.0) * 1_000.0).round() as i64,
                unit,
                hidden_by_default: hidden,
                reuse_previous_scale: reuse,
                special_processing: special,
            })
        })
        .collect()
}

fn diagnostic(
    diagnostics: &mut Vec<Diagnostic>,
    severity: &'static str,
    code: &'static str,
    message: impl Into<String>,
    line: Option<usize>,
) {
    if diagnostics.len() < 256 {
        diagnostics.push(Diagnostic {
            severity,
            code,
            message: message.into(),
            line,
        });
    }
}

fn scaled_integer(value: f64, scale: f64) -> Option<i64> {
    let scaled = (value * scale).round();
    (scaled.is_finite() && scaled >= i64::MIN as f64 && scaled <= i64::MAX as f64)
        .then_some(scaled as i64)
}

#[derive(Debug, Clone)]
pub struct ImportInput {
    pub bytes: Vec<u8>,
    pub device_path: String,
    pub filename: String,
    pub source_modified_at: String,
}

#[derive(Debug, Clone)]
pub struct ImportResult {
    pub roast_id: String,
    pub serial_number: i64,
    pub imported: bool,
    pub updated: bool,
    pub warning_count: usize,
}

#[derive(Clone)]
pub struct KlogImporter {
    database: Database,
}

impl KlogImporter {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn import(&self, input: ImportInput) -> Result<ImportResult, KlogError> {
        let document = match parse(&input.bytes).and_then(|document| {
            validate_projection(&document, &input)?;
            Ok(document)
        }) {
            Ok(document) => document,
            Err(error) => {
                self.quarantine(&input, &error)?;
                return Err(error);
            }
        };
        let mut connection = self.database.connection();
        if let Some(existing) = connection.query_row(
            "SELECT r.id, r.serial_number FROM native_files f JOIN roasts r ON r.source_file_id=f.id WHERE f.sha256=?",
            [&document.source_hash], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        ).optional()? {
            return Ok(ImportResult { roast_id: existing.0, serial_number: existing.1, imported: false, updated: false, warning_count: document.diagnostics.len() });
        }
        let transaction = connection.transaction()?;
        let logical = transaction.query_row(
            "SELECT r.id, r.serial_number, s.stream_version FROM native_files f JOIN roasts r ON r.source_file_id=f.id LEFT JOIN roast_sample_streams s ON s.roast_id=r.id WHERE f.device_path=? ORDER BY f.imported_at_ms DESC LIMIT 1",
            [&input.device_path], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, Option<i64>>(2)?)),
        ).optional()?;
        let now = Utc::now().timestamp_millis();
        let source_file_id = new_id();
        transaction.execute(
            "INSERT INTO native_files (id, sha256, kind, filename, device_path, source_modified_at, byte_length, original_bytes, parser_version, warnings_json, imported_at_ms) VALUES (?, ?, 'klog', ?, ?, ?, ?, ?, 2, ?, ?)",
            params![source_file_id, document.source_hash, input.filename, input.device_path, input.source_modified_at, input.bytes.len() as i64, input.bytes, serde_json::to_string(&document.diagnostics).map_err(|_| KlogError::Unsafe("diagnostics are not serializable".into()))?, now],
        )?;
        let profile_revision_id = resolve_profile(&transaction, &document, now)?;
        let facts = facts(&document, &input);
        let (roast_id, serial_number, stream_version, updated) = match logical {
            Some((id, serial, version)) => (id, serial, version.unwrap_or(0) + 1, true),
            None => (
                new_id(),
                transaction.query_row(
                    "SELECT coalesce(max(serial_number),0)+1 FROM roasts",
                    [],
                    |row| row.get(0),
                )?,
                1,
                false,
            ),
        };
        if updated {
            transaction.execute(
                "UPDATE roasts SET profile_revision_id=?, roasted_at_ms=?, roasted_at_source=?, source_timezone='UTC', level_thousandths=?, development_basis_points=?, green_input_mass_mg=?, end_reason=?, result=?, status=?, notes=?, native_log_number=?, roast_duration_ms=?, cooldown_end_ms=?, source_file_id=?, native_metadata_json=?, import_warnings_json=?, updated_at_ms=?, revision=revision+1 WHERE id=?",
                params![profile_revision_id, facts.roasted_at_ms, facts.roasted_at_source, facts.level_thousandths, facts.development_basis_points, facts.green_input_mass_mg, facts.end_reason, facts.result, facts.status, facts.notes, facts.native_log_number, facts.duration_ms, facts.cooldown_end_ms, source_file_id, serde_json::to_string(&facts.public_metadata).unwrap(), serde_json::to_string(&document.diagnostics).unwrap(), now, roast_id],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO roasts (id, serial_number, profile_revision_id, roasted_at_ms, roasted_at_source, source_timezone, level_thousandths, development_basis_points, green_input_mass_mg, end_reason, result, status, notes, native_log_number, roast_duration_ms, cooldown_end_ms, source_file_id, native_metadata_json, import_warnings_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![roast_id, serial_number, profile_revision_id, facts.roasted_at_ms, facts.roasted_at_source, facts.level_thousandths, facts.development_basis_points, facts.green_input_mass_mg, facts.end_reason, facts.result, facts.status, facts.notes, facts.native_log_number, facts.duration_ms, facts.cooldown_end_ms, source_file_id, serde_json::to_string(&facts.public_metadata).unwrap(), serde_json::to_string(&document.diagnostics).unwrap(), now, now],
            )?;
        }
        replace_telemetry(&transaction, &roast_id, stream_version, &document, now)?;
        if updated {
            refresh_projection(
                &transaction,
                &roast_id,
                &facts,
                profile_revision_id.as_deref(),
            )?;
        } else {
            insert_projection(
                &transaction,
                &roast_id,
                serial_number,
                &facts,
                profile_revision_id.as_deref(),
            )?;
        }
        transaction.commit()?;
        Ok(ImportResult {
            roast_id,
            serial_number,
            imported: !updated,
            updated,
            warning_count: document.diagnostics.len(),
        })
    }

    fn quarantine(&self, input: &ImportInput, error: &KlogError) -> Result<(), KlogError> {
        let hash = hex::encode(Sha256::digest(&input.bytes));
        let now = Utc::now().timestamp_millis();
        let retained = (input.bytes.len() <= MAX_RETAINED_FILE).then_some(input.bytes.as_slice());
        self.database.connection().execute(
            "INSERT INTO native_file_quarantine (sha256, kind, filename, device_path, source_modified_at, byte_length, original_bytes, parser_version, error_code, error_detail, first_seen_at_ms, last_seen_at_ms, attempt_count) VALUES (?, 'klog', ?, ?, ?, ?, ?, 2, 'unsafe_semantic_projection', ?, ?, ?, 1) ON CONFLICT(sha256) DO UPDATE SET last_seen_at_ms=excluded.last_seen_at_ms, attempt_count=native_file_quarantine.attempt_count+1, error_code=excluded.error_code, error_detail=excluded.error_detail",
            params![hash, truncate(&input.filename, 512, "unnamed.klog"), truncate(&input.device_path, 2048, "unknown"), truncate(&input.source_modified_at, 512, "unknown"), input.bytes.len() as i64, retained, truncate(&error.to_string(), 2048, "Kaffelogic log rejected"), now, now],
        )?;
        Ok(())
    }
}

fn validate_projection(document: &Document, input: &ImportInput) -> Result<(), KlogError> {
    if !document.safe_to_import {
        return Err(KlogError::Unsafe(
            "parser diagnostics contain errors".into(),
        ));
    }
    if input.filename.is_empty()
        || input.filename.len() > 512
        || input.device_path.len() > 2048
        || input.source_modified_at.len() > 512
    {
        return Err(KlogError::Unsafe("source identity is invalid".into()));
    }
    let mut previous = i64::MIN;
    for (index, sample) in document.samples.iter().enumerate() {
        if sample.sample_seq != index || sample.elapsed_ms < previous {
            return Err(KlogError::Unsafe("sample ordering is invalid".into()));
        }
        previous = sample.elapsed_ms;
        range(
            master_temperature(&sample.values)?,
            -500.0,
            1_000.0,
            "temperature",
        )?;
        for (name, minimum, maximum) in [
            ("profile", -500.0, 1_000.0),
            ("spot_temp", -500.0, 1_000.0),
            ("mean_temp", -500.0, 1_000.0),
            ("actual_ROR", -10_000.0, 10_000.0),
            ("profile_ROR", -10_000.0, 10_000.0),
            ("desired_ROR", -10_000.0, 10_000.0),
            ("power_kW", -1_000.0, 1_000.0),
            ("actual_fan_RPM", -1_000_000.0, 1_000_000.0),
        ] {
            if let Some(value) = sample.values.get(name) {
                range(*value, minimum, maximum, name)?;
            }
        }
        for value in sample.values.values() {
            milli(*value)?;
        }
        if serde_json::to_vec(&sample.values)
            .map_err(|_| KlogError::Unsafe("telemetry JSON failed".into()))?
            .len()
            > 256 * 1024
        {
            return Err(KlogError::Unsafe("telemetry row is too large".into()));
        }
    }
    if document
        .metadata
        .get("roast_date")
        .is_some_and(|value| parse_roast_date(value).is_none())
    {
        return Err(KlogError::Unsafe("roast date is invalid".into()));
    }
    Ok(())
}

fn range(value: f64, minimum: f64, maximum: f64, label: &str) -> Result<(), KlogError> {
    if value.is_finite() && value >= minimum && value <= maximum {
        Ok(())
    } else {
        Err(KlogError::Unsafe(format!(
            "{label} is outside its storage range"
        )))
    }
}

struct Facts {
    native_log_number: Option<i64>,
    roasted_at_ms: i64,
    roasted_at_source: &'static str,
    level_thousandths: Option<i64>,
    development_basis_points: Option<i64>,
    green_input_mass_mg: Option<i64>,
    end_reason: Option<String>,
    result: &'static str,
    status: &'static str,
    notes: String,
    duration_ms: i64,
    cooldown_end_ms: i64,
    public_metadata: BTreeMap<String, String>,
}

fn facts(document: &Document, input: &ImportInput) -> Facts {
    let end_reason_number = document
        .metadata
        .get("roast_end_reason")
        .and_then(|value| value.parse::<f64>().ok());
    let roast_end = document
        .events
        .iter()
        .find(|event| event.kind == "roast_end" && event.elapsed_ms > 0)
        .map(|event| event.elapsed_ms);
    let first_crack = document
        .events
        .iter()
        .find(|event| event.kind == "first_crack")
        .map(|event| event.elapsed_ms);
    let cooldown_end_ms = document
        .samples
        .last()
        .map(|sample| sample.elapsed_ms.max(0))
        .or(roast_end)
        .unwrap_or(0);
    let duration_ms = roast_end.unwrap_or(cooldown_end_ms).max(0);
    let successful = end_reason_number == Some(0.0) && duration_ms >= 60_000;
    let source_name = document
        .metadata
        .get("log_file_name")
        .map(String::as_str)
        .unwrap_or(&input.filename);
    let (roasted_at_ms, roasted_at_source) = roast_timestamp(document, input);
    Facts {
        native_log_number: native_log_number(source_name),
        roasted_at_ms,
        roasted_at_source,
        level_thousandths: document
            .metadata
            .get("roasting_level")
            .and_then(|value| value.parse().ok())
            .and_then(|value| milli(value).ok()),
        development_basis_points: first_crack
            .zip(roast_end)
            .filter(|(first, end)| first < end)
            .map(|(first, end)| (((end - first) as f64 / end as f64) * 10_000.0).round() as i64)
            .or_else(|| {
                document
                    .metadata
                    .get("development_percent")
                    .and_then(|value| value.parse::<f64>().ok())
                    .map(|value| (value * 100.0).round() as i64)
            }),
        green_input_mass_mg: document
            .metadata
            .get("boost_load_size")
            .or_else(|| document.metadata.get("reference_load_size"))
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| *value > 0.0)
            .map(|value| (value * 1_000.0).round() as i64),
        end_reason: end_reason_number
            .map(|value| format!("{}:{}", value as i64, end_reason_label(value as i64))),
        result: if successful {
            "success"
        } else if end_reason_number.is_some() || !document.samples.is_empty() {
            "aborted"
        } else {
            "unknown"
        },
        status: if successful {
            "completed"
        } else {
            "interrupted"
        },
        notes: document
            .metadata
            .get("tasting_notes")
            .cloned()
            .unwrap_or_default()
            .replace("\\v", "\n"),
        duration_ms,
        cooldown_end_ms,
        public_metadata: document
            .metadata
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    if key == "model" {
                        redact_model(value)
                    } else {
                        value.clone()
                    },
                )
            })
            .collect(),
    }
}

fn resolve_profile(
    transaction: &Transaction<'_>,
    document: &Document,
    now: i64,
) -> Result<Option<String>, KlogError> {
    let short_name = document
        .metadata
        .get("profile_short_name")
        .or_else(|| document.metadata.get("profile_file_name"))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported profile");
    let normalized = short_name.to_lowercase();
    let profile_id = transaction.query_row("SELECT id FROM profiles WHERE normalized_name=? AND origin='extracted' ORDER BY created_at_ms LIMIT 1", [&normalized], |row| row.get::<_, String>(0)).optional()?.unwrap_or_else(|| new_id());
    if transaction
        .query_row("SELECT 1 FROM profiles WHERE id=?", [&profile_id], |_| {
            Ok(())
        })
        .optional()?
        .is_none()
    {
        transaction.execute("INSERT INTO profiles (id, display_name, normalized_name, family, origin, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, 'extracted', ?, ?)", params![profile_id, short_name, normalized, short_name, now, now])?;
    }
    let roast_only: HashSet<_> = [
        "log_file_name",
        "roasting_level",
        "roast_date",
        "roast_end",
        "roast_end_reason",
        "tasting_notes",
        "ambient_temperature",
        "mains_voltage",
        "heater_power_available",
        "model",
        "motor_hours",
        "heater_hours",
        "firmware_version",
    ]
    .into_iter()
    .collect();
    let profile_document: BTreeMap<_, _> = document
        .metadata
        .iter()
        .filter(|(key, _)| !roast_only.contains(key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let document_json = serde_json::to_string(&profile_document).unwrap();
    if let Some(id) = transaction
        .query_row(
            "SELECT id FROM profile_revisions WHERE profile_id=? AND document_json=?",
            params![profile_id, document_json],
            |row| row.get(0),
        )
        .optional()?
    {
        return Ok(Some(id));
    }
    let revision: i64 = transaction.query_row(
        "SELECT coalesce(max(revision_number),0)+1 FROM profile_revisions WHERE profile_id=?",
        [&profile_id],
        |row| row.get(0),
    )?;
    let id = new_id();
    let schema = document
        .metadata
        .get("profile_schema_version")
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value > 0.0 && *value <= 1_000.0)
        .map(|value| (value * 1_000.0).round() as i64)
        .unwrap_or(1);
    transaction.execute("INSERT INTO profile_revisions (id, profile_id, revision_number, schema_version, short_name, document_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)", params![id, profile_id, revision, schema, short_name, document_json, now])?;
    Ok(Some(id))
}

fn replace_telemetry(
    transaction: &Transaction<'_>,
    roast_id: &str,
    version: i64,
    document: &Document,
    now: i64,
) -> Result<(), KlogError> {
    transaction.execute(
        "DELETE FROM roast_series_points WHERE roast_id=?",
        [roast_id],
    )?;
    transaction.execute(
        "DELETE FROM roast_events WHERE roast_id=? AND source='native'",
        [roast_id],
    )?;
    transaction.execute(
        "DELETE FROM roast_sample_streams WHERE roast_id=?",
        [roast_id],
    )?;
    transaction.execute("INSERT INTO roast_sample_streams (roast_id, stream_version, channel_schema_json, row_count, first_elapsed_ms, last_elapsed_ms, reconciliation_state) VALUES (?, ?, ?, ?, ?, ?, 'reconciled')", params![roast_id, version, serde_json::to_string(&document.channels).unwrap(), document.samples.len() as i64, document.samples.first().map(|sample| sample.elapsed_ms).unwrap_or(0), document.samples.last().map(|sample| sample.elapsed_ms).unwrap_or(0)])?;
    let mut insert = transaction.prepare("INSERT INTO roast_series_points (roast_id, sample_seq, elapsed_ms, temperature_milli_c, profile_temperature_milli_c, ror_milli_c_per_min, spot_temperature_milli_c, mean_temperature_milli_c, profile_ror_milli_c_per_min, desired_ror_milli_c_per_min, power_milli_kw, motor_voltage_trace_milli, kp_milli, ki_milli, kd_milli, actual_fan_rpm, values_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")?;
    for sample in &document.samples {
        insert.execute(params![
            roast_id,
            sample.sample_seq as i64,
            sample.elapsed_ms,
            milli(master_temperature(&sample.values)?)?,
            optional_milli(&sample.values, "profile")?,
            optional_milli(&sample.values, "actual_ROR")?,
            optional_milli(&sample.values, "spot_temp")?,
            optional_milli(&sample.values, "mean_temp")?,
            optional_milli(&sample.values, "profile_ROR")?,
            optional_milli(&sample.values, "desired_ROR")?,
            optional_milli(&sample.values, "power_kW")?,
            optional_milli(&sample.values, "volts-9")?,
            optional_milli(&sample.values, "Kp")?,
            optional_milli(&sample.values, "Ki")?,
            optional_milli(&sample.values, "Kd")?,
            sample
                .values
                .get("actual_fan_RPM")
                .map(|value| value.round() as i64),
            serde_json::to_string(&sample.values).unwrap()
        ])?;
    }
    drop(insert);
    let temperature_offset = document
        .channels
        .iter()
        .find(|channel| channel.name == "temp")
        .map(|channel| channel.offset_ms)
        .unwrap_or(0);
    for event in document.events.iter().filter(|event| event.elapsed_ms >= 0) {
        transaction.execute("INSERT INTO roast_events (id, roast_id, event_kind, elapsed_ms, temperature_milli_c, source, created_at_ms) VALUES (?, ?, ?, ?, ?, 'native', ?)", params![new_id(), roast_id, event.kind, event.elapsed_ms, nearest_temperature(&document.samples, event.elapsed_ms, temperature_offset)?, now])?;
    }
    Ok(())
}

fn insert_projection(
    transaction: &Transaction<'_>,
    roast_id: &str,
    serial: i64,
    facts: &Facts,
    profile_revision: Option<&str>,
) -> Result<(), KlogError> {
    let profile = profile_details(transaction, profile_revision)?;
    transaction.execute("INSERT INTO roast_library_rows (roast_id, serial_number, revision, roasted_at_ms, roasted_at_source, coffee_name, provider_name, varieties_json, profile_revision_id, profile_name, profile_revision_number, roast_level_thousandths, green_input_mass_mg, development_basis_points, tags_json, result, status, needs_tasting, native_log_number, duration_ms) VALUES (?, ?, 1, ?, ?, 'Unassigned coffee', NULL, '[]', ?, ?, ?, ?, ?, ?, '[]', ?, ?, 1, ?, ?)", params![roast_id, serial, facts.roasted_at_ms, facts.roasted_at_source, profile_revision, profile.0, profile.1, facts.level_thousandths, facts.green_input_mass_mg, facts.development_basis_points, facts.result, facts.status, facts.native_log_number, facts.duration_ms])?;
    replace_fts(
        transaction,
        roast_id,
        "Unassigned coffee",
        "",
        "",
        "",
        &facts.notes,
    )
}

fn refresh_projection(
    transaction: &Transaction<'_>,
    roast_id: &str,
    facts: &Facts,
    profile_revision: Option<&str>,
) -> Result<(), KlogError> {
    let profile = profile_details(transaction, profile_revision)?;
    transaction.execute("UPDATE roast_library_rows SET revision=revision+1, roasted_at_ms=?, roasted_at_source=?, profile_revision_id=?, profile_name=?, profile_revision_number=?, roast_level_thousandths=?, green_input_mass_mg=?, development_basis_points=?, result=?, status=?, native_log_number=?, duration_ms=? WHERE roast_id=?", params![facts.roasted_at_ms, facts.roasted_at_source, profile_revision, profile.0, profile.1, facts.level_thousandths, facts.green_input_mass_mg, facts.development_basis_points, facts.result, facts.status, facts.native_log_number, facts.duration_ms, roast_id])?;
    let row = transaction.query_row("SELECT coalesce(coffee_name,'Unassigned coffee'), coalesce(provider_name,''), coalesce(farm_producer,''), coalesce(process,''), coalesce(tasting_notes,'') FROM roast_library_rows WHERE roast_id=?", [roast_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?)))?;
    replace_fts(
        transaction,
        roast_id,
        &row.0,
        &row.1,
        &row.2,
        &row.3,
        &format!("{} {}", row.4, facts.notes),
    )
}

fn profile_details(
    transaction: &Transaction<'_>,
    revision: Option<&str>,
) -> Result<(String, i64), KlogError> {
    Ok(if let Some(revision) = revision {
        transaction.query_row("SELECT p.display_name, pr.revision_number FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.id=?", [revision], |row| Ok((row.get(0)?, row.get(1)?)))?
    } else {
        ("Imported profile".into(), 1)
    })
}

fn replace_fts(
    transaction: &Transaction<'_>,
    roast_id: &str,
    coffee: &str,
    provider: &str,
    farm: &str,
    process: &str,
    notes: &str,
) -> Result<(), KlogError> {
    transaction.execute("DELETE FROM roast_library_fts WHERE roast_id=?", [roast_id])?;
    transaction.execute("INSERT INTO roast_library_fts (roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion) VALUES (?, ?, ?, ?, ?, ?, '')", params![roast_id, coffee, provider, farm, process, notes])?;
    Ok(())
}

fn master_temperature(values: &BTreeMap<String, f64>) -> Result<f64, KlogError> {
    [
        "temp",
        "mean_temp",
        "BT",
        "Bean_temp",
        "Bean_temperature",
        "spot_temp",
    ]
    .iter()
    .find_map(|name| values.get(*name).copied())
    .ok_or_else(|| KlogError::Unsafe("master temperature is missing".into()))
}
fn optional_milli(values: &BTreeMap<String, f64>, name: &str) -> Result<Option<i64>, KlogError> {
    values.get(name).map(|value| milli(*value)).transpose()
}
fn milli(value: f64) -> Result<i64, KlogError> {
    scaled_integer(value, 1_000.0)
        .ok_or_else(|| KlogError::Unsafe("scaled number is outside integer range".into()))
}
fn nearest_temperature(
    samples: &[Sample],
    elapsed: i64,
    offset: i64,
) -> Result<Option<i64>, KlogError> {
    samples
        .iter()
        .min_by_key(|sample| (sample.elapsed_ms + offset - elapsed).abs())
        .map(|sample| event_temperature(&sample.values).and_then(milli))
        .transpose()
}
fn event_temperature(values: &BTreeMap<String, f64>) -> Result<f64, KlogError> {
    [
        "mean_temp",
        "temp",
        "BT",
        "Bean_temp",
        "Bean_temperature",
        "spot_temp",
    ]
    .iter()
    .find_map(|name| values.get(*name).copied())
    .ok_or_else(|| KlogError::Unsafe("event temperature is missing".into()))
}
fn native_log_number(value: &str) -> Option<i64> {
    let tail = value.rsplit('/').next()?;
    let digits = tail.strip_prefix("log")?.strip_suffix(".klog")?;
    digits.parse().ok()
}
fn roast_timestamp(document: &Document, input: &ImportInput) -> (i64, &'static str) {
    if let Some(value) = document
        .metadata
        .get("roast_date")
        .and_then(|value| parse_roast_date(value))
    {
        return (value, "metadata");
    }
    if let Some(value) = parse_source_modified(&input.source_modified_at) {
        if value != 978_310_860_000 {
            return (value, "file_modified");
        }
        return (value, "unknown");
    }
    (Utc::now().timestamp_millis(), "unknown")
}
fn parse_roast_date(value: &str) -> Option<i64> {
    NaiveDateTime::parse_from_str(
        value.trim().strip_suffix(" UTC").unwrap_or(value.trim()),
        "%d/%m/%Y %H:%M:%S",
    )
    .ok()
    .map(|value| Utc.from_utc_datetime(&value).timestamp_millis())
}
fn parse_sassi_date(value: &str) -> Option<i64> {
    if value.len() != 15 {
        return None;
    }
    let normalized = format!("{}{}", &value[..8], &value[9..]);
    NaiveDateTime::parse_from_str(&normalized, "%Y%m%d%H%M%S")
        .ok()
        .map(|value| Utc.from_utc_datetime(&value).timestamp_millis())
}
fn parse_source_modified(value: &str) -> Option<i64> {
    parse_sassi_date(value).or_else(|| {
        DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|value| value.timestamp_millis())
    })
}
fn redact_model(value: &str) -> String {
    let mut parts = value.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(model), Some(region), Some(_)) => format!("{model}/{region}/<redacted>"),
        _ => value.into(),
    }
}
fn new_id() -> String {
    Uuid::now_v7().to_string()
}
fn truncate(value: &str, maximum: usize, fallback: &str) -> String {
    let value: String = value.chars().take(maximum).collect();
    if value.is_empty() {
        fallback.into()
    } else {
        value
    }
}
fn end_reason_label(value: i64) -> &'static str {
    match value {
        0 => "level",
        1 => "dtr_user_first_crack",
        2 => "user",
        3 => "studio_user",
        4 => "too_slow",
        5 => "too_fast",
        6 => "too_long",
        7 => "interrupted",
        8 => "thermal_runaway",
        9 => "thermal_dip",
        10 => "dtr_expected_first_crack",
        11 => "dialled_dtr_without_lock",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(level: &str, end: &str) -> Vec<u8> {
        ["log_file_name:kaffelogic/roast-logs/log0013.klog", "profile_file_name:1200-1500m Rest v1.0.kpro", "profile_short_name:1200-1500m Rest", "profile_schema_version:1.4", &format!("roasting_level:{level}"), "boost_load_size:50.0000", "roast_date:18/07/2026 18:37:27 UTC", "model:KN1007B/J/TS00000001", "", "offsets\t-8.5\t-8.75\t-12\t0\t0\t-19.5\t-8.75\t-8.5\t-8.5\t-8.5\t-8.5\t-8.5\t-8.5", "time\t#spot_temp\t#=temp\t=mean_temp\t=profile\tprofile_ROR\t=actual_ROR\t#=desired_ROR\tpower_kW\t#volts-9\t#Kp\t#Ki\t#Kd\t#^actual_fan_RPM", "521\t216.1\t216\t215.9\t218\t6.6\t5.9\t6\t0.71\t4.5\t0.7\t0\t3\t13200\t", &format!("!roast_end:{end}"), "!roast_end_reason:0.00000", "!roast_date:18/07/2026 18:46:17 UTC", "522\t120\t121\t200\t218\t6.6\t-1\t6\t0\t4.4\t0.7\t0\t3\t15000\t", ""].join("\n").into_bytes()
    }

    #[test]
    fn parses_every_channel_and_incidental_metadata() {
        let document = parse(&fixture("2.00000", "521.216")).unwrap();
        assert!(document.safe_to_import);
        assert_eq!(document.channels.len(), 13);
        assert_eq!(document.samples.len(), 2);
        assert_eq!(document.events[0].elapsed_ms, 521_216);
        assert_eq!(document.metadata["roast_date"], "18/07/2026 18:46:17 UTC");
    }

    #[test]
    fn transactionally_imports_and_updates_one_log() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let importer = KlogImporter::new(database.clone());
        let first = importer
            .import(ImportInput {
                bytes: fixture("2.00000", "521.216"),
                device_path: "kaffelogic/roast-logs/log0013.klog".into(),
                filename: "log0013.klog".into(),
                source_modified_at: "202607186184617".into(),
            })
            .unwrap();
        assert!(first.imported);
        let revised = importer
            .import(ImportInput {
                bytes: fixture("2.50000", "530.000"),
                device_path: "kaffelogic/roast-logs/log0013.klog".into(),
                filename: "log0013.klog".into(),
                source_modified_at: "202607186185000".into(),
            })
            .unwrap();
        assert!(revised.updated);
        assert_eq!(revised.roast_id, first.roast_id);
        let connection = database.connection();
        let row: (i64, i64, i64) = connection.query_row("SELECT r.level_thousandths, r.roast_duration_ms, s.stream_version FROM roasts r JOIN roast_sample_streams s ON s.roast_id=r.id", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert_eq!(row, (2_500, 530_000, 2));
        let event_temperature: i64 = connection
            .query_row(
                "SELECT temperature_milli_c FROM roast_events WHERE event_kind='roast_end'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_temperature, 200_000);
    }

    #[test]
    fn accepts_rfc3339_source_dates_for_logs_without_roast_date() {
        assert_eq!(
            parse_source_modified("2000-12-31T17:01:00Z"),
            Some(978_282_060_000)
        );
    }

    #[test]
    fn treats_the_nano_clock_sentinel_as_an_unknown_roast_date() {
        let mut document = parse(&fixture("2.00000", "521.216")).unwrap();
        document.metadata.remove("roast_date");
        let input = ImportInput {
            bytes: Vec::new(),
            device_path: "kaffelogic/roast-logs/log0014.klog".into(),
            filename: "log0014.klog".into(),
            source_modified_at: "200101011010100".into(),
        };

        let facts = facts(&document, &input);

        assert_eq!(facts.roasted_at_ms, 978_310_860_000);
        assert_eq!(facts.roasted_at_source, "unknown");
    }
}
