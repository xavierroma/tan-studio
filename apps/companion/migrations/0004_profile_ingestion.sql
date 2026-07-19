ALTER TABLE profile_revisions ADD COLUMN source_file_id TEXT REFERENCES native_files(id);
ALTER TABLE profile_revisions ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE profile_revisions ADD COLUMN designer TEXT NOT NULL DEFAULT '';
ALTER TABLE profile_revisions ADD COLUMN modified_at TEXT;
ALTER TABLE profile_revisions ADD COLUMN recommended_level_thousandths INTEGER
  CHECK (recommended_level_thousandths IS NULL OR recommended_level_thousandths BETWEEN 0 AND 10000);
ALTER TABLE profile_revisions ADD COLUMN reference_load_mg INTEGER
  CHECK (reference_load_mg IS NULL OR reference_load_mg BETWEEN 0 AND 10000000);

CREATE UNIQUE INDEX profile_revisions_source_file
  ON profile_revisions(source_file_id) WHERE source_file_id IS NOT NULL;

UPDATE app_metadata SET schema_version = 4 WHERE id = 1;
