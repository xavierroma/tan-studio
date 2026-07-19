CREATE TABLE native_files (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  kind TEXT NOT NULL CHECK (kind IN ('klog', 'kpro', 'unknown')),
  filename TEXT NOT NULL,
  device_path TEXT,
  source_modified_at TEXT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  original_bytes BLOB NOT NULL,
  parser_version INTEGER NOT NULL CHECK (parser_version > 0),
  warnings_json TEXT NOT NULL DEFAULT '[]',
  imported_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX native_files_device_path ON native_files(device_path, source_modified_at);

ALTER TABLE coffee_identities ADD COLUMN serial_number INTEGER;
UPDATE coffee_identities SET serial_number = rowid WHERE serial_number IS NULL;
CREATE UNIQUE INDEX coffee_identities_serial_number
  ON coffee_identities(serial_number) WHERE serial_number IS NOT NULL;

ALTER TABLE roasts ADD COLUMN serial_number INTEGER;
ALTER TABLE roasts ADD COLUMN native_log_number INTEGER;
ALTER TABLE roasts ADD COLUMN roast_duration_ms INTEGER;
ALTER TABLE roasts ADD COLUMN cooldown_end_ms INTEGER;
ALTER TABLE roasts ADD COLUMN source_file_id TEXT REFERENCES native_files(id);
ALTER TABLE roasts ADD COLUMN native_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE roasts ADD COLUMN import_warnings_json TEXT NOT NULL DEFAULT '[]';
UPDATE roasts SET serial_number = rowid WHERE serial_number IS NULL;
CREATE UNIQUE INDEX roasts_serial_number
  ON roasts(serial_number) WHERE serial_number IS NOT NULL;
CREATE UNIQUE INDEX roasts_source_file
  ON roasts(source_file_id) WHERE source_file_id IS NOT NULL;
CREATE INDEX roasts_native_log_number ON roasts(native_log_number);

ALTER TABLE roast_series_points ADD COLUMN spot_temperature_milli_c INTEGER;
ALTER TABLE roast_series_points ADD COLUMN mean_temperature_milli_c INTEGER;
ALTER TABLE roast_series_points ADD COLUMN profile_ror_milli_c_per_min INTEGER;
ALTER TABLE roast_series_points ADD COLUMN desired_ror_milli_c_per_min INTEGER;
ALTER TABLE roast_series_points ADD COLUMN power_milli_kw INTEGER;
ALTER TABLE roast_series_points ADD COLUMN motor_voltage_trace_milli INTEGER;
ALTER TABLE roast_series_points ADD COLUMN kp_milli INTEGER;
ALTER TABLE roast_series_points ADD COLUMN ki_milli INTEGER;
ALTER TABLE roast_series_points ADD COLUMN kd_milli INTEGER;
ALTER TABLE roast_series_points ADD COLUMN actual_fan_rpm INTEGER;
ALTER TABLE roast_series_points ADD COLUMN values_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE roast_library_rows ADD COLUMN serial_number INTEGER;
ALTER TABLE roast_library_rows ADD COLUMN native_log_number INTEGER;
ALTER TABLE roast_library_rows ADD COLUMN duration_ms INTEGER;
UPDATE roast_library_rows
   SET serial_number = (SELECT serial_number FROM roasts WHERE roasts.id = roast_library_rows.roast_id),
       native_log_number = (SELECT native_log_number FROM roasts WHERE roasts.id = roast_library_rows.roast_id),
       duration_ms = (SELECT roast_duration_ms FROM roasts WHERE roasts.id = roast_library_rows.roast_id);
CREATE INDEX roast_library_serial_number ON roast_library_rows(serial_number);

CREATE TABLE user_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_roaster_name TEXT NOT NULL DEFAULT 'Kaffelogic Nano 7',
  default_grinder_name TEXT NOT NULL DEFAULT '',
  default_grinder_setting TEXT NOT NULL DEFAULT '',
  default_kettle_name TEXT NOT NULL DEFAULT '',
  default_water_name TEXT NOT NULL DEFAULT '',
  default_brew_method TEXT NOT NULL DEFAULT 'V60',
  default_coffee_mass_mg INTEGER NOT NULL DEFAULT 15000 CHECK (default_coffee_mass_mg > 0),
  default_water_mass_mg INTEGER NOT NULL DEFAULT 250000 CHECK (default_water_mass_mg > 0),
  default_water_temperature_milli_c INTEGER NOT NULL DEFAULT 93000
    CHECK (default_water_temperature_milli_c BETWEEN 0 AND 100000),
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

INSERT INTO user_preferences(id, updated_at_ms)
VALUES (1, CAST(unixepoch('subsec') * 1000 AS INTEGER));

CREATE TABLE brews (
  id TEXT PRIMARY KEY,
  serial_number INTEGER NOT NULL UNIQUE CHECK (serial_number > 0),
  roast_id TEXT NOT NULL REFERENCES roasts(id),
  brewed_at_ms INTEGER NOT NULL,
  source_timezone TEXT NOT NULL,
  method TEXT NOT NULL,
  grinder_name TEXT NOT NULL DEFAULT '',
  grinder_setting TEXT NOT NULL DEFAULT '',
  kettle_name TEXT NOT NULL DEFAULT '',
  water_name TEXT NOT NULL DEFAULT '',
  coffee_mass_mg INTEGER NOT NULL CHECK (coffee_mass_mg > 0),
  water_mass_mg INTEGER NOT NULL CHECK (water_mass_mg > 0),
  water_temperature_milli_c INTEGER CHECK (
    water_temperature_milli_c IS NULL OR water_temperature_milli_c BETWEEN 0 AND 100000
  ),
  bloom_water_mass_mg INTEGER CHECK (bloom_water_mass_mg IS NULL OR bloom_water_mass_mg >= 0),
  bloom_duration_ms INTEGER CHECK (bloom_duration_ms IS NULL OR bloom_duration_ms >= 0),
  brew_duration_ms INTEGER CHECK (brew_duration_ms IS NULL OR brew_duration_ms >= 0),
  score_basis_points INTEGER CHECK (score_basis_points IS NULL OR score_basis_points BETWEEN 0 AND 10000),
  descriptors_json TEXT NOT NULL DEFAULT '[]',
  tasting_notes TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

CREATE INDEX brews_roast ON brews(roast_id, brewed_at_ms DESC, serial_number DESC);

CREATE TABLE label_records (
  id TEXT PRIMARY KEY,
  serial_number INTEGER NOT NULL UNIQUE CHECK (serial_number > 0),
  roast_id TEXT NOT NULL REFERENCES roasts(id),
  roast_serial_number INTEGER NOT NULL CHECK (roast_serial_number > 0),
  qr_payload TEXT NOT NULL,
  copies INTEGER NOT NULL DEFAULT 1 CHECK (copies > 0),
  artifact_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('generated', 'submitted', 'spooled', 'failed', 'unknown')),
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX label_records_roast ON label_records(roast_id, created_at_ms DESC);

UPDATE app_metadata SET schema_version = 2, projection_version = 2 WHERE id = 1;
