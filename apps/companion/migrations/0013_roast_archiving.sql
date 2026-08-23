ALTER TABLE roasts ADD COLUMN archived_at_ms INTEGER;

CREATE INDEX roasts_pantry_idx
  ON roasts(status, archived_at_ms, id DESC);

UPDATE app_metadata SET schema_version = 13 WHERE id = 1;
