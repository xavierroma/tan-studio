CREATE TABLE profile_file_quarantine (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 512),
  device_path TEXT NOT NULL CHECK (length(device_path) BETWEEN 1 AND 2048),
  source_modified_at TEXT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  original_bytes BLOB NOT NULL,
  parser_version INTEGER NOT NULL CHECK (parser_version > 0),
  error_code TEXT NOT NULL CHECK (length(error_code) BETWEEN 1 AND 64),
  error_detail TEXT NOT NULL CHECK (length(error_detail) BETWEEN 1 AND 2048),
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  CHECK (length(original_bytes) = byte_length)
) STRICT;

CREATE INDEX profile_file_quarantine_device_path
  ON profile_file_quarantine(device_path, last_seen_at_ms DESC);

CREATE TRIGGER profile_revisions_native_validate_insert
BEFORE INSERT ON profile_revisions
WHEN NEW.source_file_id IS NOT NULL AND (
  json_valid(NEW.document_json) != 1
  OR json_type(NEW.document_json) != 'object'
  OR length(NEW.document_json) > 16777216
  OR NOT EXISTS (
    SELECT 1 FROM native_files
     WHERE id = NEW.source_file_id AND kind = 'kpro'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid native profile projection');
END;

CREATE TRIGGER profile_revisions_native_validate_update
BEFORE UPDATE OF source_file_id, document_json ON profile_revisions
WHEN NEW.source_file_id IS NOT NULL AND (
  json_valid(NEW.document_json) != 1
  OR json_type(NEW.document_json) != 'object'
  OR length(NEW.document_json) > 16777216
  OR NOT EXISTS (
    SELECT 1 FROM native_files
     WHERE id = NEW.source_file_id AND kind = 'kpro'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid native profile projection');
END;

UPDATE app_metadata SET schema_version = 5 WHERE id = 1;
