-- Tan Studio's public model is deliberately small: profiles, coffees, roasts,
-- brews, notes, labels and settings. Native source files and telemetry remain
-- internal so imports stay lossless.

CREATE TABLE migration_profile_map (
  legacy_id TEXT PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
) STRICT;

INSERT INTO migration_profile_map(legacy_id, new_id)
SELECT id, row_number() OVER (ORDER BY created_at_ms, id)
FROM profiles;

CREATE TABLE profiles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_profile_id INTEGER REFERENCES profiles_new(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  designer TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'user' CHECK(origin IN ('official', 'imported', 'user', 'extracted')),
  recommended_level_thousandths INTEGER CHECK(
    recommended_level_thousandths IS NULL OR recommended_level_thousandths BETWEEN 0 AND 10000
  ),
  reference_load_mg INTEGER CHECK(reference_load_mg IS NULL OR reference_load_mg BETWEEN 0 AND 10000000),
  profile_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(profile_json) AND json_type(profile_json) = 'object'),
  source_file_id TEXT REFERENCES native_files(id),
  source_hash TEXT CHECK(source_hash IS NULL OR length(source_hash) = 64),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

INSERT INTO profiles_new(
  id, name, description, designer, origin, recommended_level_thousandths,
  reference_load_mg, profile_json, source_file_id, source_hash,
  created_at_ms, updated_at_ms, revision
)
SELECT m.new_id,
       p.display_name,
       coalesce(pr.description, ''),
       coalesce(pr.designer, ''),
       p.origin,
       pr.recommended_level_thousandths,
       pr.reference_load_mg,
       coalesce(pr.document_json, '{}'),
       pr.source_file_id,
       nf.sha256,
       p.created_at_ms,
       p.updated_at_ms,
       p.revision
FROM profiles p
JOIN migration_profile_map m ON m.legacy_id = p.id
LEFT JOIN profile_revisions pr ON pr.id = (
  SELECT candidate.id FROM profile_revisions candidate
  WHERE candidate.profile_id = p.id
  ORDER BY candidate.revision_number DESC, candidate.created_at_ms DESC
  LIMIT 1
)
LEFT JOIN native_files nf ON nf.id = pr.source_file_id;

CREATE TABLE migration_coffee_map (
  new_id INTEGER PRIMARY KEY,
  legacy_coffee_id TEXT NOT NULL,
  legacy_lot_id TEXT
) STRICT;

INSERT INTO migration_coffee_map(new_id, legacy_coffee_id, legacy_lot_id)
SELECT row_number() OVER (ORDER BY source_order, legacy_coffee_id, coalesce(legacy_lot_id, '')),
       legacy_coffee_id,
       legacy_lot_id
FROM (
  SELECT 0 AS source_order, pl.coffee_id AS legacy_coffee_id, l.id AS legacy_lot_id
  FROM green_lots l
  JOIN purchase_lines pl ON pl.id = l.purchase_line_id
  UNION ALL
  SELECT 1, c.id, NULL
  FROM coffee_identities c
  WHERE NOT EXISTS (
    SELECT 1 FROM purchase_lines pl
    JOIN green_lots l ON l.purchase_line_id = pl.id
    WHERE pl.coffee_id = c.id
  )
);

CREATE TABLE coffees_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  provider TEXT NOT NULL DEFAULT '',
  provider_url TEXT NOT NULL DEFAULT '',
  provider_product_id TEXT NOT NULL DEFAULT '',
  purchase_reference TEXT NOT NULL DEFAULT '',
  purchased_at_ms INTEGER,
  price_minor INTEGER,
  currency_code TEXT CHECK(currency_code IS NULL OR length(currency_code) = 3),
  purchased_mass_mg INTEGER NOT NULL DEFAULT 0 CHECK(purchased_mass_mg >= 0),
  remaining_mass_mg INTEGER NOT NULL DEFAULT 0 CHECK(remaining_mass_mg >= 0),
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  farm TEXT NOT NULL DEFAULT '',
  producer TEXT NOT NULL DEFAULT '',
  washing_station TEXT NOT NULL DEFAULT '',
  process TEXT NOT NULL DEFAULT '',
  variety TEXT NOT NULL DEFAULT '',
  altitude_min_m INTEGER,
  altitude_max_m INTEGER,
  harvest TEXT NOT NULL DEFAULT '',
  storage_location TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  archived_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

INSERT INTO coffees_new(
  id, name, provider, provider_url, provider_product_id, purchase_reference,
  purchased_at_ms, price_minor, currency_code, purchased_mass_mg, remaining_mass_mg,
  country, region, farm, producer, washing_station, process, variety,
  altitude_min_m, altitude_max_m, harvest, storage_location, metadata_json,
  archived_at_ms, created_at_ms, updated_at_ms, revision
)
SELECT m.new_id,
       c.display_name,
       coalesce(p.display_name, ''),
       coalesce(json_extract(p.contact_json, '$.websiteUrl'), ''),
       coalesce(l.supplier_code, ''),
       coalesce(gp.supplier_reference, ''),
       gp.purchased_at_ms,
       pl.cost_minor,
       gp.currency_code,
       coalesce(l.received_mass_mg, pl.received_mass_mg, 0),
       coalesce(l.on_hand_mass_mg, pl.received_mass_mg, 0),
       coalesce(c.country_code, ''),
       coalesce(c.region, ''),
       coalesce(c.farm_producer, ''),
       coalesce(c.farm_producer, ''),
       coalesce(c.station_cooperative, ''),
       coalesce(c.process, ''),
       coalesce((SELECT group_concat(value, ', ') FROM json_each(c.varieties_json)), ''),
       c.altitude_min_m,
       c.altitude_max_m,
       coalesce(c.harvest_label, ''),
       coalesce(l.storage_location, ''),
       json_object(
         'legacyCoffeeId', c.id,
         'legacyLotId', m.legacy_lot_id,
         'lotCode', l.internal_code,
         'storageNotes', l.storage_notes,
         'supplierReference', gp.supplier_reference
       ),
       coalesce(l.archived_at_ms, c.archived_at_ms),
       c.created_at_ms,
       max(c.updated_at_ms, coalesce(l.updated_at_ms, c.updated_at_ms)),
       max(c.revision, coalesce(l.revision, c.revision))
FROM migration_coffee_map m
JOIN coffee_identities c ON c.id = m.legacy_coffee_id
LEFT JOIN green_lots l ON l.id = m.legacy_lot_id
LEFT JOIN purchase_lines pl ON pl.id = l.purchase_line_id
LEFT JOIN green_purchases gp ON gp.id = pl.purchase_id
LEFT JOIN providers p ON p.id = gp.provider_id;

CREATE TABLE roasts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES profiles_new(id),
  coffee_id INTEGER REFERENCES coffees_new(id),
  roasted_at_ms INTEGER NOT NULL,
  roasted_at_source TEXT NOT NULL DEFAULT 'unknown' CHECK(roasted_at_source IN ('metadata', 'file_modified', 'unknown')),
  source_timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'unknown',
  level_thousandths INTEGER CHECK(level_thousandths IS NULL OR level_thousandths BETWEEN 0 AND 10000),
  green_input_mass_mg INTEGER CHECK(green_input_mass_mg IS NULL OR green_input_mass_mg >= 0),
  roasted_yield_mass_mg INTEGER CHECK(roasted_yield_mass_mg IS NULL OR roasted_yield_mass_mg >= 0),
  development_basis_points INTEGER CHECK(development_basis_points IS NULL OR development_basis_points BETWEEN 0 AND 10000),
  duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
  cooldown_end_ms INTEGER,
  end_reason TEXT NOT NULL DEFAULT '',
  native_log_number INTEGER,
  profile_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(profile_snapshot_json) AND json_type(profile_snapshot_json) = 'object'),
  adjustments_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(adjustments_json) AND json_type(adjustments_json) = 'object'),
  roaster_parameters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(roaster_parameters_json) AND json_type(roaster_parameters_json) = 'object'),
  native_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(native_metadata_json) AND json_type(native_metadata_json) = 'object'),
  import_warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(import_warnings_json) AND json_type(import_warnings_json) = 'array'),
  source_file_id TEXT REFERENCES native_files(id),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

INSERT INTO roasts_new(
  id, profile_id, coffee_id, roasted_at_ms, roasted_at_source, source_timezone,
  status, result, level_thousandths, green_input_mass_mg, roasted_yield_mass_mg,
  development_basis_points, duration_ms, cooldown_end_ms, end_reason, native_log_number,
  profile_snapshot_json, adjustments_json, roaster_parameters_json, native_metadata_json,
  import_warnings_json, source_file_id, created_at_ms, updated_at_ms, revision
)
SELECT r.serial_number,
       pm.new_id,
       coalesce(
         (SELECT cm.new_id FROM migration_coffee_map cm WHERE cm.legacy_lot_id = r.green_lot_id LIMIT 1),
         (SELECT min(cm.new_id) FROM migration_coffee_map cm WHERE cm.legacy_coffee_id = r.coffee_id)
       ),
       r.roasted_at_ms,
       r.roasted_at_source,
       r.source_timezone,
       r.status,
       coalesce(r.result, 'unknown'),
       r.level_thousandths,
       r.green_input_mass_mg,
       r.roasted_yield_mass_mg,
       r.development_basis_points,
       r.roast_duration_ms,
       r.cooldown_end_ms,
       coalesce(r.end_reason, ''),
       r.native_log_number,
       coalesce(pr.document_json, '{}'),
       json_object('levelThousandths', r.level_thousandths),
       '{}',
       r.native_metadata_json,
       r.import_warnings_json,
       r.source_file_id,
       r.created_at_ms,
       r.updated_at_ms,
       r.revision
FROM roasts r
LEFT JOIN profile_revisions pr ON pr.id = r.profile_revision_id
LEFT JOIN migration_profile_map pm ON pm.legacy_id = pr.profile_id;

CREATE INDEX roasts_new_date ON roasts_new(roasted_at_ms DESC, id DESC);
CREATE INDEX roasts_new_profile ON roasts_new(profile_id, id DESC);
CREATE INDEX roasts_new_coffee ON roasts_new(coffee_id, id DESC);

CREATE TABLE roast_sample_streams_new (
  roast_id INTEGER PRIMARY KEY REFERENCES roasts_new(id) ON DELETE CASCADE,
  stream_version INTEGER NOT NULL DEFAULT 1 CHECK(stream_version > 0),
  channel_schema_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count >= 0),
  first_elapsed_ms INTEGER NOT NULL,
  last_elapsed_ms INTEGER NOT NULL,
  reconciliation_state TEXT NOT NULL CHECK(reconciliation_state IN ('provisional', 'reconciled'))
) STRICT;

INSERT INTO roast_sample_streams_new
SELECT r.serial_number, s.stream_version, s.channel_schema_json, s.row_count,
       s.first_elapsed_ms, s.last_elapsed_ms, s.reconciliation_state
FROM roast_sample_streams s JOIN roasts r ON r.id = s.roast_id;

CREATE TABLE roast_series_points_new (
  roast_id INTEGER NOT NULL REFERENCES roasts_new(id) ON DELETE CASCADE,
  sample_seq INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  temperature_milli_c INTEGER NOT NULL,
  profile_temperature_milli_c INTEGER,
  ror_milli_c_per_min INTEGER,
  spot_temperature_milli_c INTEGER,
  mean_temperature_milli_c INTEGER,
  profile_ror_milli_c_per_min INTEGER,
  desired_ror_milli_c_per_min INTEGER,
  power_milli_kw INTEGER,
  motor_voltage_trace_milli INTEGER,
  kp_milli INTEGER,
  ki_milli INTEGER,
  kd_milli INTEGER,
  actual_fan_rpm INTEGER,
  values_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(roast_id, sample_seq)
) STRICT;

INSERT INTO roast_series_points_new
SELECT r.serial_number, p.sample_seq, p.elapsed_ms, p.temperature_milli_c,
       p.profile_temperature_milli_c, p.ror_milli_c_per_min,
       p.spot_temperature_milli_c, p.mean_temperature_milli_c,
       p.profile_ror_milli_c_per_min, p.desired_ror_milli_c_per_min,
       p.power_milli_kw, p.motor_voltage_trace_milli, p.kp_milli, p.ki_milli,
       p.kd_milli, p.actual_fan_rpm, p.values_json
FROM roast_series_points p JOIN roasts r ON r.id = p.roast_id;

CREATE INDEX roast_series_points_new_range ON roast_series_points_new(roast_id, elapsed_ms, sample_seq);

CREATE TABLE roast_events_new (
  id TEXT PRIMARY KEY,
  roast_id INTEGER NOT NULL REFERENCES roasts_new(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms >= 0),
  temperature_milli_c INTEGER,
  source TEXT NOT NULL CHECK(source IN ('native', 'device', 'user', 'derived')),
  created_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO roast_events_new
SELECT e.id, r.serial_number, e.event_kind, e.elapsed_ms, e.temperature_milli_c, e.source, e.created_at_ms
FROM roast_events e JOIN roasts r ON r.id = e.roast_id;

CREATE INDEX roast_events_new_roast ON roast_events_new(roast_id, elapsed_ms, id);

CREATE TABLE brews_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roast_id INTEGER NOT NULL REFERENCES roasts_new(id),
  brewed_at_ms INTEGER NOT NULL,
  source_timezone TEXT NOT NULL DEFAULT 'UTC',
  method TEXT NOT NULL DEFAULT 'V60',
  grinder TEXT NOT NULL DEFAULT '',
  grinder_setting TEXT NOT NULL DEFAULT '',
  kettle TEXT NOT NULL DEFAULT '',
  water TEXT NOT NULL DEFAULT '',
  coffee_mass_mg INTEGER NOT NULL CHECK(coffee_mass_mg > 0),
  water_mass_mg INTEGER NOT NULL CHECK(water_mass_mg > 0),
  water_temperature_milli_c INTEGER CHECK(water_temperature_milli_c IS NULL OR water_temperature_milli_c BETWEEN 0 AND 100000),
  recipe_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(recipe_json) AND json_type(recipe_json) = 'object'),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

INSERT INTO brews_new(
  id, roast_id, brewed_at_ms, source_timezone, method, grinder, grinder_setting,
  kettle, water, coffee_mass_mg, water_mass_mg, water_temperature_milli_c,
  recipe_json, created_at_ms, updated_at_ms, revision
)
SELECT b.serial_number, r.serial_number, b.brewed_at_ms, b.source_timezone, b.method,
       b.grinder_name, b.grinder_setting, b.kettle_name, b.water_name,
       b.coffee_mass_mg, b.water_mass_mg, b.water_temperature_milli_c,
       json_object(
         'bloomWaterMassMg', b.bloom_water_mass_mg,
         'bloomDurationMs', b.bloom_duration_ms,
         'brewDurationMs', b.brew_duration_ms,
         'descriptors', json(b.descriptors_json)
       ),
       b.created_at_ms, b.updated_at_ms, b.revision
FROM brews b JOIN roasts r ON r.id = b.roast_id;

CREATE INDEX brews_new_roast ON brews_new(roast_id, brewed_at_ms DESC, id DESC);

CREATE TABLE notes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'general' CHECK(kind IN ('observation', 'tasting', 'annotation', 'recommendation', 'general')),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 100000),
  rating_basis_points INTEGER CHECK(rating_basis_points IS NULL OR rating_basis_points BETWEEN 0 AND 10000),
  attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json) AND json_type(attributes_json) = 'object'),
  source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user', 'import', 'device', 'agent')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

CREATE TABLE note_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes_new(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES profiles_new(id) ON DELETE CASCADE,
  coffee_id INTEGER REFERENCES coffees_new(id) ON DELETE CASCADE,
  roast_id INTEGER REFERENCES roasts_new(id) ON DELETE CASCADE,
  brew_id INTEGER REFERENCES brews_new(id) ON DELETE CASCADE,
  CHECK((profile_id IS NOT NULL) + (coffee_id IS NOT NULL) + (roast_id IS NOT NULL) + (brew_id IS NOT NULL) = 1)
) STRICT;

CREATE UNIQUE INDEX note_links_new_profile ON note_links_new(note_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX note_links_new_coffee ON note_links_new(note_id, coffee_id) WHERE coffee_id IS NOT NULL;
CREATE UNIQUE INDEX note_links_new_roast ON note_links_new(note_id, roast_id) WHERE roast_id IS NOT NULL;
CREATE UNIQUE INDEX note_links_new_brew ON note_links_new(note_id, brew_id) WHERE brew_id IS NOT NULL;

CREATE TABLE migration_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  rating_basis_points INTEGER,
  attributes_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO migration_notes(source_kind, source_id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT 'roast', id, 'observation', notes, NULL, '{}', 'import', created_at_ms, updated_at_ms
FROM roasts WHERE trim(notes) != '';

INSERT INTO migration_notes(source_kind, source_id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT 'tasting', id, 'tasting',
       trim(notes || CASE WHEN trim(conclusion) = '' THEN '' ELSE char(10) || char(10) || conclusion END || CASE WHEN trim(next_action) = '' THEN '' ELSE char(10) || char(10) || 'Next: ' || next_action END),
       score_basis_points,
       json_object('descriptors', json(descriptors_json), 'tastedAtMs', tasted_at_ms),
       'import', created_at_ms, created_at_ms
FROM tastings
WHERE trim(notes) != '' OR trim(conclusion) != '' OR trim(next_action) != '';

INSERT INTO migration_notes(source_kind, source_id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT 'annotation', id, 'annotation', text, NULL,
       json_object('elapsedMs', elapsed_ms, 'temperatureMilliC', temperature_milli_c, 'annotationType', annotation_type),
       'import', created_at_ms, updated_at_ms
FROM annotations WHERE trim(text) != '';

INSERT INTO migration_notes(source_kind, source_id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT 'brew_tasting', id, 'tasting', tasting_notes, score_basis_points,
       json_object('descriptors', json(descriptors_json)), 'import', created_at_ms, updated_at_ms
FROM brews WHERE trim(tasting_notes) != '';

INSERT INTO migration_notes(source_kind, source_id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT 'brew_general', id, 'general', notes, NULL, '{}', 'import', created_at_ms, updated_at_ms
FROM brews WHERE trim(notes) != '';

INSERT INTO migration_notes(source_kind, source_id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT 'coffee', id, 'general', notes, NULL, '{}', 'import', created_at_ms, updated_at_ms
FROM coffee_identities WHERE trim(coalesce(notes, '')) != '';

INSERT INTO notes_new(id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms)
SELECT id, kind, body, rating_basis_points, attributes_json, source, created_at_ms, updated_at_ms
FROM migration_notes;

INSERT INTO note_links_new(note_id, roast_id)
SELECT n.id, r.serial_number
FROM migration_notes n JOIN roasts r ON r.id = n.source_id
WHERE n.source_kind = 'roast';

INSERT INTO note_links_new(note_id, roast_id)
SELECT n.id, r.serial_number
FROM migration_notes n JOIN tastings t ON t.id = n.source_id JOIN roasts r ON r.id = t.roast_id
WHERE n.source_kind = 'tasting';

INSERT INTO note_links_new(note_id, roast_id)
SELECT n.id, r.serial_number
FROM migration_notes n JOIN annotations a ON a.id = n.source_id JOIN roasts r ON r.id = a.roast_id
WHERE n.source_kind = 'annotation';

INSERT INTO note_links_new(note_id, brew_id)
SELECT n.id, b.serial_number
FROM migration_notes n JOIN brews b ON b.id = n.source_id
WHERE n.source_kind IN ('brew_tasting', 'brew_general');

INSERT INTO note_links_new(note_id, roast_id)
SELECT n.id, r.serial_number
FROM migration_notes n JOIN brews b ON b.id = n.source_id JOIN roasts r ON r.id = b.roast_id
WHERE n.source_kind IN ('brew_tasting', 'brew_general');

INSERT INTO note_links_new(note_id, coffee_id)
SELECT n.id, min(m.new_id)
FROM migration_notes n JOIN migration_coffee_map m ON m.legacy_coffee_id = n.source_id
WHERE n.source_kind = 'coffee'
GROUP BY n.id;

CREATE TABLE labels_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roast_id INTEGER NOT NULL REFERENCES roasts_new(id),
  copies INTEGER NOT NULL DEFAULT 1 CHECK(copies > 0),
  width_micrometers INTEGER,
  height_micrometers INTEGER,
  content_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(content_json) AND json_type(content_json) = 'object'),
  artifact_sha256 TEXT CHECK(artifact_sha256 IS NULL OR length(artifact_sha256) = 64),
  printer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated', 'submitted', 'spooled', 'deviceAccepted', 'physicallyConfirmed', 'failed', 'unknown')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO labels_new(id, roast_id, copies, content_json, artifact_sha256, status, created_at_ms, updated_at_ms)
SELECT l.serial_number, r.serial_number, l.copies,
       json_object('qrPayload', l.qr_payload, 'roastId', l.roast_serial_number),
       l.artifact_sha256, l.status, l.created_at_ms, l.created_at_ms
FROM label_records l JOIN roasts r ON r.id = l.roast_id;

CREATE INDEX labels_new_roast ON labels_new(roast_id, created_at_ms DESC);

CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  values_json TEXT NOT NULL CHECK(json_valid(values_json) AND json_type(values_json) = 'object'),
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

INSERT INTO settings_new(id, values_json, updated_at_ms, revision)
SELECT 1,
       json_object(
         'defaultRoaster', default_roaster_name,
         'defaultGrinder', default_grinder_name,
         'defaultGrinderSetting', default_grinder_setting,
         'defaultKettle', default_kettle_name,
         'defaultWater', default_water_name,
         'defaultBrewMethod', default_brew_method,
         'defaultCoffeeMassMg', default_coffee_mass_mg,
         'defaultWaterMassMg', default_water_mass_mg,
         'defaultWaterTemperatureMilliC', default_water_temperature_milli_c,
         'defaultRestDays', 7,
         'defaultPeakDays', 21,
         'defaultLabelWidthMicrometers', 50000,
         'defaultLabelHeightMicrometers', 30000
       ),
       updated_at_ms,
       revision
FROM user_preferences WHERE id = 1;

DROP TABLE roast_library_fts;
DROP TABLE roast_library_rows;
DROP TABLE annotations;
DROP TABLE tastings;
DROP TABLE label_records;
DROP TABLE brews;
DROP TABLE roast_events;
DROP TABLE roast_series_points;
DROP TABLE roast_sample_streams;
DROP TABLE inventory_transactions;
DROP TABLE roasts;
DROP TABLE profile_revisions;
DROP TABLE profiles;
DROP TABLE green_lots;
DROP TABLE purchase_lines;
DROP TABLE green_purchases;
DROP TABLE coffee_identities;
DROP TABLE providers;
DROP TABLE user_preferences;

ALTER TABLE profiles_new RENAME TO profiles;
ALTER TABLE coffees_new RENAME TO coffees;
ALTER TABLE roasts_new RENAME TO roasts;
ALTER TABLE roast_sample_streams_new RENAME TO roast_sample_streams;
ALTER TABLE roast_series_points_new RENAME TO roast_series_points;
ALTER TABLE roast_events_new RENAME TO roast_events;
ALTER TABLE brews_new RENAME TO brews;
ALTER TABLE notes_new RENAME TO notes;
ALTER TABLE note_links_new RENAME TO note_links;
ALTER TABLE labels_new RENAME TO labels;
ALTER TABLE settings_new RENAME TO settings;

DROP TABLE migration_notes;
DROP TABLE migration_coffee_map;
DROP TABLE migration_profile_map;

CREATE VIRTUAL TABLE studio_fts USING fts5(
  resource_type UNINDEXED,
  resource_id UNINDEXED,
  name,
  provider,
  origin,
  process,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO studio_fts(resource_type, resource_id, name, provider, origin, process, body)
SELECT 'coffee', id, name, provider, trim(country || ' ' || region || ' ' || farm || ' ' || producer), process, ''
FROM coffees;

INSERT INTO studio_fts(resource_type, resource_id, name, provider, origin, process, body)
SELECT 'note', id, '', '', '', '', body FROM notes;

UPDATE app_metadata SET schema_version = 7, projection_version = 4 WHERE id = 1;
