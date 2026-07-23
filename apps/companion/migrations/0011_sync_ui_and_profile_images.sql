-- Durable UI defaults, synchronization history, and semantic attachment roles.
-- Attachments remain generic resources; the relationship identifies which
-- image is the entity's primary visual.

ALTER TABLE attachment_links
  ADD COLUMN role TEXT NOT NULL DEFAULT 'gallery'
  CHECK(role IN ('gallery', 'profile'));

CREATE UNIQUE INDEX attachment_links_profile_cover
  ON attachment_links(profile_id)
  WHERE profile_id IS NOT NULL AND role = 'profile';
CREATE UNIQUE INDEX attachment_links_coffee_cover
  ON attachment_links(coffee_id)
  WHERE coffee_id IS NOT NULL AND role = 'profile';
CREATE UNIQUE INDEX attachment_links_roast_cover
  ON attachment_links(roast_id)
  WHERE roast_id IS NOT NULL AND role = 'profile';
CREATE UNIQUE INDEX attachment_links_brew_cover
  ON attachment_links(brew_id)
  WHERE brew_id IS NOT NULL AND role = 'profile';

CREATE TABLE ui_preferences (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  default_table_density TEXT NOT NULL DEFAULT 'expanded'
    CHECK(default_table_density IN ('compact', 'expanded')),
  table_preferences_json TEXT NOT NULL DEFAULT '{}'
    CHECK(json_valid(table_preferences_json) AND json_type(table_preferences_json) = 'object'),
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

INSERT INTO ui_preferences(id, default_table_density, table_preferences_json, updated_at_ms)
VALUES (1, 'expanded', '{}', CAST(unixepoch('subsec') * 1000 AS INTEGER));

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL CHECK(trigger IN ('startup', 'manual', 'retry')),
  state TEXT NOT NULL CHECK(state IN ('running', 'completed', 'failed', 'interrupted')),
  transport TEXT NOT NULL DEFAULT '',
  device_model TEXT NOT NULL DEFAULT '',
  imported_log_count INTEGER NOT NULL DEFAULT 0 CHECK(imported_log_count >= 0),
  updated_log_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_log_count >= 0),
  import_warning_count INTEGER NOT NULL DEFAULT 0 CHECK(import_warning_count >= 0),
  quarantined_log_count INTEGER NOT NULL DEFAULT 0 CHECK(quarantined_log_count >= 0),
  imported_profile_count INTEGER NOT NULL DEFAULT 0 CHECK(imported_profile_count >= 0),
  profile_warning_count INTEGER NOT NULL DEFAULT 0 CHECK(profile_warning_count >= 0),
  quarantined_profile_count INTEGER NOT NULL DEFAULT 0 CHECK(quarantined_profile_count >= 0),
  error_code TEXT,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  CHECK(
    (state = 'running' AND completed_at_ms IS NULL) OR
    (state <> 'running' AND completed_at_ms IS NOT NULL)
  )
) STRICT;

CREATE INDEX sync_runs_started ON sync_runs(started_at_ms DESC, id DESC);
CREATE INDEX sync_runs_running ON sync_runs(state) WHERE state = 'running';

UPDATE app_metadata SET schema_version = 11 WHERE id = 1;
