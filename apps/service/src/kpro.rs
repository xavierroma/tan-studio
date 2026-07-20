//! Lossless, bounded Kaffelogic `.kpro` parsing and transactional projection.
//! The original file remains the authority; parsed fields power search and UI.

use std::collections::{BTreeMap, HashSet};

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::Database;

const MAX_RETAINED_FILE: usize = 8 * 1024 * 1024;
const MAX_LINES: usize = 4_096;
const MAX_LINE_BYTES: usize = 256 * 1024;
const MAX_CURVE_VALUES: usize = 6_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub key: String,
    pub value: String,
    pub line: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurvePoint {
    pub time_seconds: f64,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub source_hash: String,
    pub entries: Vec<Entry>,
    pub fields: BTreeMap<String, String>,
    pub short_name: String,
    pub designer: String,
    pub description: String,
    pub schema_version: String,
    pub profile_modified: Option<String>,
    pub recommended_level: Option<f64>,
    pub reference_load_grams: Option<f64>,
    pub roast_levels: Vec<f64>,
    pub roast_curve: Vec<CurvePoint>,
    pub fan_curve: Vec<CurvePoint>,
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum KproError {
    #[error("Kaffelogic profile is not valid UTF-8")]
    InvalidUtf8,
    #[error("Kaffelogic profile exceeds parser limits")]
    TooLarge,
    #[error("Kaffelogic profile is malformed: {0}")]
    Malformed(String),
    #[error("Kaffelogic profile database operation failed")]
    Database(#[from] rusqlite::Error),
}

#[derive(Debug, Clone)]
pub struct ImportInput {
    pub bytes: Vec<u8>,
    pub device_path: String,
    pub filename: String,
    pub source_modified_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub profile_id: i64,
    pub revision_number: i64,
    pub imported: bool,
    pub warning_count: usize,
}

#[derive(Clone)]
pub struct KproImporter {
    database: Database,
}

impl KproImporter {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn import(&self, input: ImportInput) -> Result<ImportResult, KproError> {
        validate_input(&input)?;
        let document = match parse(&input.bytes) {
            Ok(document) => document,
            Err(error) => {
                self.quarantine(&input, &error)?;
                return Err(error);
            }
        };
        let document_json = serde_json::to_string(&document)
            .map_err(|_| KproError::Malformed("profile projection is not serializable".into()))?;
        let warnings_json = serde_json::to_string(&document.warnings)
            .map_err(|_| KproError::Malformed("profile warnings are not serializable".into()))?;
        let now = Utc::now().timestamp_millis();
        let mut connection = self.database.connection();

        if let Some(existing) = connection
            .query_row(
                "SELECT id, revision FROM profiles WHERE source_hash=?",
                [&document.source_hash],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?
        {
            return Ok(ImportResult {
                profile_id: existing.0,
                revision_number: existing.1,
                imported: false,
                warning_count: document.warnings.len(),
            });
        }

        let transaction = connection.transaction()?;
        let source_file_id = if let Some((id, kind)) = transaction
            .query_row(
                "SELECT id, kind FROM native_files WHERE sha256=?",
                [&document.source_hash],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if kind != "kpro" {
                return Err(KproError::Malformed(
                    "content hash already belongs to another native format".into(),
                ));
            }
            id
        } else {
            let id = new_id();
            transaction.execute(
                "INSERT INTO native_files
                   (id, sha256, kind, filename, device_path, source_modified_at,
                    byte_length, original_bytes, parser_version, warnings_json, imported_at_ms)
                 VALUES (?, ?, 'kpro', ?, ?, ?, ?, ?, 1, ?, ?)",
                params![
                    id,
                    document.source_hash,
                    input.filename,
                    input.device_path,
                    input.source_modified_at,
                    input.bytes.len() as i64,
                    input.bytes,
                    warnings_json,
                    now
                ],
            )?;
            id
        };

        let profile_id = transaction
            .query_row(
                "SELECT id FROM profiles WHERE lower(name)=?
                 ORDER BY CASE origin WHEN 'official' THEN 0 WHEN 'imported' THEN 1 ELSE 2 END,
                          created_at_ms LIMIT 1",
                [normalize_name(&document.short_name)],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let recommended_level_thousandths = document
            .recommended_level
            .map(|value| (value * 1_000.0).round() as i64);
        let reference_load_mg = document
            .reference_load_grams
            .map(|value| (value * 1_000.0).round() as i64);
        let origin = if is_official_designer(&document.designer) {
            "official"
        } else {
            "imported"
        };
        let (profile_id, revision_number) = if let Some(profile_id) = profile_id {
            transaction.execute(
                "UPDATE profiles
                    SET name=?, description=?, designer=?, origin=?,
                        recommended_level_thousandths=?, reference_load_mg=?,
                        profile_json=?, source_file_id=?, source_hash=?,
                        updated_at_ms=?, revision=revision+1
                  WHERE id=?",
                params![
                    document.short_name,
                    document.description,
                    document.designer,
                    origin,
                    recommended_level_thousandths,
                    reference_load_mg,
                    document_json,
                    source_file_id,
                    document.source_hash,
                    now,
                    profile_id
                ],
            )?;
            let revision = transaction.query_row(
                "SELECT revision FROM profiles WHERE id=?",
                [profile_id],
                |row| row.get(0),
            )?;
            (profile_id, revision)
        } else {
            transaction.execute(
                "INSERT INTO profiles
                   (name, description, designer, origin, recommended_level_thousandths,
                    reference_load_mg, profile_json, source_file_id, source_hash,
                    created_at_ms, updated_at_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    document.short_name,
                    document.description,
                    document.designer,
                    origin,
                    recommended_level_thousandths,
                    reference_load_mg,
                    document_json,
                    source_file_id,
                    document.source_hash,
                    now,
                    now
                ],
            )?;
            (transaction.last_insert_rowid(), 1)
        };
        transaction.commit()?;

        Ok(ImportResult {
            profile_id,
            revision_number,
            imported: true,
            warning_count: document.warnings.len(),
        })
    }

    fn quarantine(&self, input: &ImportInput, error: &KproError) -> Result<(), KproError> {
        let source_hash = hex::encode(Sha256::digest(&input.bytes));
        let now = Utc::now().timestamp_millis();
        let error_code = match error {
            KproError::InvalidUtf8 => "invalid_utf8",
            KproError::TooLarge => "parser_limit",
            KproError::Malformed(_) => "malformed_profile",
            KproError::Database(_) => "database_failure",
        };
        let error_detail = error.to_string();
        let connection = self.database.connection();
        connection.execute(
            "INSERT INTO profile_file_quarantine
               (sha256, filename, device_path, source_modified_at, byte_length,
                original_bytes, parser_version, error_code, error_detail,
                first_seen_at_ms, last_seen_at_ms, attempt_count)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)
             ON CONFLICT(sha256) DO UPDATE SET
               filename=excluded.filename,
               device_path=excluded.device_path,
               source_modified_at=excluded.source_modified_at,
               error_code=excluded.error_code,
               error_detail=excluded.error_detail,
               last_seen_at_ms=excluded.last_seen_at_ms,
               attempt_count=profile_file_quarantine.attempt_count+1",
            params![
                source_hash,
                input.filename,
                input.device_path,
                input.source_modified_at,
                input.bytes.len() as i64,
                input.bytes,
                error_code,
                error_detail,
                now,
                now
            ],
        )?;
        Ok(())
    }
}

pub fn parse(input: &[u8]) -> Result<Document, KproError> {
    if input.len() > MAX_RETAINED_FILE {
        return Err(KproError::TooLarge);
    }
    let source = std::str::from_utf8(input).map_err(|_| KproError::InvalidUtf8)?;
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    if source.contains('\0') {
        return Err(KproError::Malformed("profile contains a NUL byte".into()));
    }

    let mut entries = Vec::new();
    let mut fields = BTreeMap::new();
    let mut duplicate_keys = HashSet::new();
    for (index, raw_line) in source.split(['\r', '\n']).enumerate() {
        if index >= MAX_LINES || raw_line.len() > MAX_LINE_BYTES {
            return Err(KproError::TooLarge);
        }
        if raw_line.trim().is_empty() {
            continue;
        }
        let Some((raw_key, raw_value)) = raw_line.split_once(':') else {
            continue;
        };
        let key = normalized_key(raw_key, index + 1)?;
        let value = raw_value.replace('\t', ",");
        if fields.insert(key.clone(), value).is_some() {
            duplicate_keys.insert(key);
        }
        entries.push(Entry {
            key: raw_key.to_owned(),
            value: raw_value.to_owned(),
            line: index + 1,
        });
    }
    if entries.is_empty() {
        return Err(KproError::Malformed(
            "profile contains no properties".into(),
        ));
    }

    let short_name = required_text(&fields, "profile_short_name", 256)?;
    let designer = optional_text(&fields, "profile_designer", 512)?.unwrap_or_default();
    let description = optional_text(&fields, "profile_description", 128 * 1024)?
        .unwrap_or_default()
        .replace("\\v", "\n");
    let schema_version = required_text(&fields, "profile_schema_version", 32)?;
    let recommended_level = optional_number(&fields, "recommended_level", 0.0, 10.0)?;
    let reference_load_grams = optional_number(&fields, "reference_load_size", 0.0, 10_000.0)?;
    let profile_modified = optional_text(&fields, "profile_modified", 512)?;
    let roast_levels = number_list(&fields, "roast_levels", 1, 256, -500.0, 1_000.0)?;
    let roast_curve = curve(&fields, "roast_profile", -500.0, 1_000.0)?;
    let fan_curve = curve(&fields, "fan_profile", -1_000.0, 100_000.0)?;
    let mut warnings = duplicate_keys
        .into_iter()
        .map(|key| format!("duplicate property retained: {key}"))
        .collect::<Vec<_>>();
    warnings.sort();

    Ok(Document {
        source_hash: hex::encode(Sha256::digest(input)),
        entries,
        fields,
        short_name,
        designer,
        description,
        schema_version,
        profile_modified,
        recommended_level,
        reference_load_grams,
        roast_levels,
        roast_curve,
        fan_curve,
        warnings,
    })
}

pub fn sample_curve(control_points: &[CurvePoint], samples_per_segment: usize) -> Vec<CurvePoint> {
    let segments = control_points.len() / 3;
    if segments < 2 || samples_per_segment == 0 {
        return Vec::new();
    }
    let mut samples = Vec::with_capacity((segments - 1) * samples_per_segment + 1);
    for segment in 0..(segments - 1) {
        let start = control_points[segment * 3];
        let outgoing = control_points[segment * 3 + 2];
        let incoming = control_points[(segment + 1) * 3 + 1];
        let end = control_points[(segment + 1) * 3];
        for step in 0..samples_per_segment {
            let t = step as f64 / samples_per_segment as f64;
            samples.push(CurvePoint {
                time_seconds: cubic(
                    start.time_seconds,
                    outgoing.time_seconds,
                    incoming.time_seconds,
                    end.time_seconds,
                    t,
                ),
                value: cubic(start.value, outgoing.value, incoming.value, end.value, t),
            });
        }
    }
    samples.push(control_points[(segments - 1) * 3]);
    samples
}

fn cubic(p0: f64, p1: f64, p2: f64, p3: f64, t: f64) -> f64 {
    let inverse = 1.0 - t;
    inverse.powi(3) * p0
        + 3.0 * inverse.powi(2) * t * p1
        + 3.0 * inverse * t.powi(2) * p2
        + t.powi(3) * p3
}

fn curve(
    fields: &BTreeMap<String, String>,
    key: &str,
    minimum_value: f64,
    maximum_value: f64,
) -> Result<Vec<CurvePoint>, KproError> {
    let values = number_list(fields, key, 12, MAX_CURVE_VALUES, -1_000_000.0, 1_000_000.0)?;
    if values.len() % 6 != 0 {
        return Err(KproError::Malformed(format!(
            "{key} does not contain complete Bézier control triples"
        )));
    }
    let points = values
        .chunks_exact(2)
        .map(|pair| CurvePoint {
            time_seconds: pair[0],
            value: pair[1],
        })
        .collect::<Vec<_>>();
    for (index, point) in points.iter().enumerate() {
        if !(-3_600.0..=604_800.0).contains(&point.time_seconds) {
            return Err(KproError::Malformed(format!(
                "{key} time at coordinate {} is outside supported limits",
                index + 1
            )));
        }
        let is_unused_endpoint_handle = index == 1 || index + 1 == points.len();
        if !is_unused_endpoint_handle && !(minimum_value..=maximum_value).contains(&point.value) {
            return Err(KproError::Malformed(format!(
                "{key} value at coordinate {} is outside supported limits",
                index + 1
            )));
        }
    }
    let knots = points.iter().step_by(3).collect::<Vec<_>>();
    if knots
        .windows(2)
        .any(|window| window[0].time_seconds >= window[1].time_seconds)
    {
        return Err(KproError::Malformed(format!(
            "{key} knot times are not strictly increasing"
        )));
    }
    Ok(points)
}

fn number_list(
    fields: &BTreeMap<String, String>,
    key: &str,
    minimum_items: usize,
    maximum_items: usize,
    minimum: f64,
    maximum: f64,
) -> Result<Vec<f64>, KproError> {
    let value = fields
        .get(key)
        .ok_or_else(|| KproError::Malformed(format!("missing {key}")))?;
    let tokens = value.split(',').collect::<Vec<_>>();
    if tokens.len() < minimum_items || tokens.len() > maximum_items {
        return Err(KproError::Malformed(format!(
            "{key} has an unsupported number of values"
        )));
    }
    tokens
        .into_iter()
        .map(|token| {
            token
                .trim()
                .parse::<f64>()
                .ok()
                .filter(|number| number.is_finite() && (*number >= minimum && *number <= maximum))
                .ok_or_else(|| KproError::Malformed(format!("{key} contains an invalid number")))
        })
        .collect()
}

fn optional_number(
    fields: &BTreeMap<String, String>,
    key: &str,
    minimum: f64,
    maximum: f64,
) -> Result<Option<f64>, KproError> {
    let Some(value) = fields.get(key).map(|value| value.trim()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    value
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite() && (*number >= minimum && *number <= maximum))
        .map(Some)
        .ok_or_else(|| KproError::Malformed(format!("{key} is not a supported number")))
}

fn required_text(
    fields: &BTreeMap<String, String>,
    key: &str,
    maximum: usize,
) -> Result<String, KproError> {
    optional_text(fields, key, maximum)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| KproError::Malformed(format!("missing {key}")))
}

fn optional_text(
    fields: &BTreeMap<String, String>,
    key: &str,
    maximum: usize,
) -> Result<Option<String>, KproError> {
    let Some(value) = fields.get(key) else {
        return Ok(None);
    };
    if value.len() > maximum {
        return Err(KproError::TooLarge);
    }
    Ok(Some(value.trim().to_owned()))
}

fn normalized_key(key: &str, line: usize) -> Result<String, KproError> {
    let normalized = key.replace(' ', "_");
    if key.is_empty()
        || key.len() > 128
        || normalized
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace() || byte == b':')
    {
        return Err(KproError::Malformed(format!(
            "line {line} has an invalid property name"
        )));
    }
    Ok(normalized)
}

fn validate_input(input: &ImportInput) -> Result<(), KproError> {
    if input.filename.is_empty()
        || input.filename.len() > 512
        || input.device_path.is_empty()
        || input.device_path.len() > 2_048
        || input.source_modified_at.len() > 512
        || !input.filename.to_ascii_lowercase().ends_with(".kpro")
    {
        return Err(KproError::Malformed("invalid profile provenance".into()));
    }
    Ok(())
}

fn normalize_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn is_official_designer(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase().replace('.', " ");
    normalized.split_whitespace().collect::<Vec<_>>().join(" ") == "kaffelogic ltd"
        || normalized == "c j hilder"
}

fn new_id() -> String {
    Uuid::now_v7().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        [
            "profile_short_name:Test profile",
            "profile_designer:Kaffelogic Ltd",
            "profile_description:Line one\\v\\vLine two",
            "profile_schema_version:1.4",
            "recommended_level:2.0",
            "reference_load_size:100",
            "roast_levels:205,215,222",
            "roast_profile:0,20,0,0,20,50,60,110,40,90,80,130",
            "fan_profile:0,14700,0,0,20,14700,60,14000,40,14500,80,13500",
            "unknown_future_property:retained",
        ]
        .join("\r\n")
        .into_bytes()
    }

    #[test]
    fn parses_metadata_and_bezier_curves_losslessly() {
        let bytes = fixture();
        let document = parse(&bytes).unwrap();
        assert_eq!(document.short_name, "Test profile");
        assert_eq!(document.description, "Line one\n\nLine two");
        assert_eq!(document.fields["unknown_future_property"], "retained");
        assert_eq!(document.roast_curve.len(), 6);
        let samples = sample_curve(&document.roast_curve, 10);
        assert_eq!(samples.first().unwrap().time_seconds, 0.0);
        assert_eq!(samples.last().unwrap().time_seconds, 60.0);
        assert_eq!(samples.last().unwrap().value, 110.0);
        assert_eq!(document.source_hash, hex::encode(Sha256::digest(&bytes)));
    }

    #[test]
    fn rejects_incomplete_or_non_monotonic_curves() {
        let incomplete = String::from_utf8(fixture()).unwrap().replace(
            "roast_profile:0,20,0,0,20,50,60,110,40,90,80,130",
            "roast_profile:0,20,0,0,20,50,60,110,40,90",
        );
        assert!(matches!(
            parse(incomplete.as_bytes()),
            Err(KproError::Malformed(_))
        ));
        let non_monotonic = String::from_utf8(fixture()).unwrap().replace(
            "roast_profile:0,20,0,0,20,50,60,110,40,90,80,130",
            "roast_profile:60,20,0,0,80,50,0,110,40,90,20,130",
        );
        assert!(matches!(
            parse(non_monotonic.as_bytes()),
            Err(KproError::Malformed(_))
        ));
    }

    #[test]
    fn accepts_crossed_bezier_handles_used_by_official_profiles() {
        let crossed_handles = String::from_utf8(fixture()).unwrap().replace(
            "roast_profile:0,20,0,0,20,50,60,110,40,90,80,130",
            "roast_profile:0,20,0,0,40,50,60,110,20,90,80,130",
        );
        assert!(parse(crossed_handles.as_bytes()).is_ok());
    }

    #[test]
    fn accepts_studio_line_endings_key_spaces_tabs_and_ignored_lines() {
        let source = String::from_utf8(fixture())
            .unwrap()
            .replace('\n', "\r")
            .replace("profile_short_name:", "profile short name:")
            .replace(
                "roast_levels:205,215,222",
                "ignored line\rroast_levels:205\t215\t222",
            );
        let document = parse(source.as_bytes()).unwrap();
        assert_eq!(document.short_name, "Test profile");
        assert_eq!(document.roast_levels, vec![205.0, 215.0, 222.0]);
        assert!(document
            .entries
            .iter()
            .any(|entry| entry.key == "profile short name"));
    }

    #[test]
    fn imports_idempotently_and_retains_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let importer = KproImporter::new(database.clone());
        let input = ImportInput {
            bytes: fixture(),
            device_path: "kaffelogic/roast-profiles/test.kpro".into(),
            filename: "test.kpro".into(),
            source_modified_at: "2026-07-19T00:00:00Z".into(),
        };
        let first = importer.import(input.clone()).unwrap();
        let second = importer.import(input).unwrap();
        assert!(first.imported);
        assert!(!second.imported);
        assert_eq!(first.profile_id, second.profile_id);
        let connection = database.connection();
        let stored: Vec<u8> = connection
            .query_row(
                "SELECT original_bytes FROM native_files WHERE kind='kpro'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, fixture());
    }

    #[test]
    fn quarantines_incompatible_profiles_without_partial_rows() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let importer = KproImporter::new(database.clone());
        let bytes = b"profile_short_name:broken\nroast_profile:not-numeric".to_vec();
        let result = importer.import(ImportInput {
            bytes: bytes.clone(),
            device_path: "kaffelogic/roast-profiles/broken.kpro".into(),
            filename: "broken.kpro".into(),
            source_modified_at: "unknown".into(),
        });
        assert!(matches!(result, Err(KproError::Malformed(_))));
        let connection = database.connection();
        let retained: Vec<u8> = connection
            .query_row(
                "SELECT original_bytes FROM profile_file_quarantine",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, bytes);
        let revisions: i64 = connection
            .query_row("SELECT count(*) FROM profiles", [], |row| row.get(0))
            .unwrap();
        assert_eq!(revisions, 0);
    }
}
