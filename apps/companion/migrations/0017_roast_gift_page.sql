-- An externally authored gift page; Studio stores only its HTTPS association.
ALTER TABLE roasts ADD COLUMN deployed_page_url TEXT;
UPDATE app_metadata SET schema_version = 17 WHERE id = 1;
