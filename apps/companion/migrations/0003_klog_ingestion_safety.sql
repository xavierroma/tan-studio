CREATE TABLE native_file_quarantine (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  kind TEXT NOT NULL CHECK (kind IN ('klog', 'unknown')),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 512),
  device_path TEXT CHECK (device_path IS NULL OR length(device_path) <= 2048),
  source_modified_at TEXT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  original_bytes BLOB,
  parser_version INTEGER NOT NULL CHECK (parser_version > 0),
  error_code TEXT NOT NULL CHECK (length(error_code) BETWEEN 1 AND 64),
  error_detail TEXT NOT NULL CHECK (length(error_detail) BETWEEN 1 AND 2048),
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  CHECK (original_bytes IS NULL OR length(original_bytes) = byte_length)
) STRICT;

CREATE INDEX native_file_quarantine_device_path
  ON native_file_quarantine(device_path, last_seen_at_ms DESC);

CREATE TRIGGER native_files_validate_insert
BEFORE INSERT ON native_files
WHEN NEW.byte_length != length(NEW.original_bytes)
  OR length(NEW.filename) NOT BETWEEN 1 AND 512
  OR (NEW.device_path IS NOT NULL AND length(NEW.device_path) > 2048)
  OR json_valid(NEW.warnings_json) != 1
  OR json_type(NEW.warnings_json) != 'array'
  OR length(NEW.warnings_json) > 262144
BEGIN
  SELECT RAISE(ABORT, 'invalid native file projection');
END;

CREATE TRIGGER roast_sample_streams_validate_insert
BEFORE INSERT ON roast_sample_streams
WHEN json_valid(NEW.channel_schema_json) != 1
  OR json_type(NEW.channel_schema_json) != 'array'
  OR length(NEW.channel_schema_json) > 262144
  OR NEW.first_elapsed_ms NOT BETWEEN -3600000 AND 604800000
  OR NEW.last_elapsed_ms NOT BETWEEN -3600000 AND 604800000
  OR NEW.first_elapsed_ms > NEW.last_elapsed_ms
BEGIN
  SELECT RAISE(ABORT, 'invalid roast sample stream');
END;

CREATE TRIGGER roast_series_points_validate_insert
BEFORE INSERT ON roast_series_points
WHEN NEW.sample_seq < 0
  OR NEW.elapsed_ms NOT BETWEEN -3600000 AND 604800000
  OR NEW.temperature_milli_c NOT BETWEEN -500000 AND 1000000
  OR (NEW.profile_temperature_milli_c IS NOT NULL AND NEW.profile_temperature_milli_c NOT BETWEEN -500000 AND 1000000)
  OR (NEW.spot_temperature_milli_c IS NOT NULL AND NEW.spot_temperature_milli_c NOT BETWEEN -500000 AND 1000000)
  OR (NEW.mean_temperature_milli_c IS NOT NULL AND NEW.mean_temperature_milli_c NOT BETWEEN -500000 AND 1000000)
  OR (NEW.ror_milli_c_per_min IS NOT NULL AND NEW.ror_milli_c_per_min NOT BETWEEN -10000000 AND 10000000)
  OR (NEW.profile_ror_milli_c_per_min IS NOT NULL AND NEW.profile_ror_milli_c_per_min NOT BETWEEN -10000000 AND 10000000)
  OR (NEW.desired_ror_milli_c_per_min IS NOT NULL AND NEW.desired_ror_milli_c_per_min NOT BETWEEN -10000000 AND 10000000)
  OR (NEW.power_milli_kw IS NOT NULL AND NEW.power_milli_kw NOT BETWEEN -1000000 AND 1000000)
  OR (NEW.actual_fan_rpm IS NOT NULL AND NEW.actual_fan_rpm NOT BETWEEN -1000000 AND 1000000)
  OR json_valid(NEW.values_json) != 1
  OR json_type(NEW.values_json) != 'object'
  OR length(NEW.values_json) > 262144
BEGIN
  SELECT RAISE(ABORT, 'invalid roast series point');
END;

CREATE TRIGGER roasts_native_json_validate_insert
BEFORE INSERT ON roasts
WHEN json_valid(NEW.native_metadata_json) != 1
  OR json_type(NEW.native_metadata_json) != 'object'
  OR length(NEW.native_metadata_json) > 1048576
  OR json_valid(NEW.import_warnings_json) != 1
  OR json_type(NEW.import_warnings_json) != 'array'
  OR length(NEW.import_warnings_json) > 262144
BEGIN
  SELECT RAISE(ABORT, 'invalid roast native projection');
END;

CREATE TRIGGER roasts_native_json_validate_update
BEFORE UPDATE OF native_metadata_json, import_warnings_json ON roasts
WHEN json_valid(NEW.native_metadata_json) != 1
  OR json_type(NEW.native_metadata_json) != 'object'
  OR length(NEW.native_metadata_json) > 1048576
  OR json_valid(NEW.import_warnings_json) != 1
  OR json_type(NEW.import_warnings_json) != 'array'
  OR length(NEW.import_warnings_json) > 262144
BEGIN
  SELECT RAISE(ABORT, 'invalid roast native projection');
END;

UPDATE app_metadata SET schema_version = 3 WHERE id = 1;
