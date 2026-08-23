ALTER TABLE roasts ADD COLUMN end_temperature_milli_c INTEGER
  CHECK(end_temperature_milli_c IS NULL OR end_temperature_milli_c BETWEEN -100000 AND 500000);

UPDATE app_metadata SET schema_version = 12 WHERE id = 1;
