ALTER TABLE roasts ADD COLUMN roasted_at_source TEXT NOT NULL DEFAULT 'metadata'
  CHECK (roasted_at_source IN ('metadata', 'file_modified', 'unknown'));

ALTER TABLE roast_library_rows ADD COLUMN roasted_at_source TEXT NOT NULL DEFAULT 'metadata'
  CHECK (roasted_at_source IN ('metadata', 'file_modified', 'unknown'));

UPDATE roasts
   SET roasted_at_source = CASE
     WHEN source_file_id IS NULL THEN 'metadata'
     WHEN json_type(native_metadata_json, '$.roast_date') = 'text'
          AND trim(json_extract(native_metadata_json, '$.roast_date')) != ''
       THEN 'metadata'
     WHEN roasted_at_ms = 978310860000 THEN 'unknown'
     ELSE 'file_modified'
   END;

UPDATE roast_library_rows
   SET roasted_at_source = coalesce(
     (SELECT r.roasted_at_source FROM roasts r WHERE r.id = roast_library_rows.roast_id),
     'unknown'
   );

UPDATE app_metadata
   SET schema_version = 6,
       projection_version = 3
 WHERE id = 1;
