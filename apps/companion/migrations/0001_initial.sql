CREATE TABLE app_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  projection_version INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_clean_shutdown_ms INTEGER
) STRICT;

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  contact_json TEXT NOT NULL DEFAULT '{"websiteUrl":null,"email":null,"phone":null}',
  reference_notes TEXT,
  default_currency_code TEXT,
  notes TEXT,
  archived_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (default_currency_code IS NULL OR length(default_currency_code) = 3)
) STRICT;

CREATE UNIQUE INDEX providers_normalized_name_active
  ON providers(normalized_name) WHERE archived_at_ms IS NULL;

CREATE TABLE coffee_identities (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country_code TEXT,
  region TEXT,
  farm_producer TEXT,
  station_cooperative TEXT,
  process TEXT,
  varieties_json TEXT NOT NULL DEFAULT '[]',
  altitude_min_m INTEGER,
  altitude_max_m INTEGER,
  harvest_label TEXT,
  notes TEXT,
  archived_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (country_code IS NULL OR length(country_code) = 2),
  CHECK (altitude_min_m IS NULL OR altitude_min_m >= -500),
  CHECK (altitude_max_m IS NULL OR altitude_max_m >= altitude_min_m)
) STRICT;

CREATE INDEX coffee_identities_normalized_name ON coffee_identities(normalized_name);

CREATE TABLE green_purchases (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  supplier_reference TEXT,
  purchased_at_ms INTEGER,
  received_at_ms INTEGER,
  source_timezone TEXT NOT NULL,
  total_mass_mg INTEGER NOT NULL CHECK (total_mass_mg >= 0),
  currency_code TEXT,
  total_cost_minor INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

CREATE INDEX green_purchases_provider ON green_purchases(provider_id, received_at_ms DESC);

CREATE TABLE purchase_lines (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES green_purchases(id),
  coffee_id TEXT NOT NULL REFERENCES coffee_identities(id),
  ordered_mass_mg INTEGER NOT NULL CHECK (ordered_mass_mg >= 0),
  received_mass_mg INTEGER NOT NULL CHECK (received_mass_mg >= 0),
  cost_minor INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

CREATE INDEX purchase_lines_purchase ON purchase_lines(purchase_id);
CREATE INDEX purchase_lines_coffee ON purchase_lines(coffee_id);

CREATE TABLE green_lots (
  id TEXT PRIMARY KEY,
  purchase_line_id TEXT NOT NULL REFERENCES purchase_lines(id),
  supplier_code TEXT,
  internal_code TEXT NOT NULL,
  received_mass_mg INTEGER NOT NULL CHECK (received_mass_mg >= 0),
  on_hand_mass_mg INTEGER NOT NULL CHECK (on_hand_mass_mg >= 0),
  received_at_ms INTEGER NOT NULL,
  source_timezone TEXT NOT NULL,
  storage_location TEXT,
  storage_notes TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('active', 'depleted', 'archived')),
  archived_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

CREATE UNIQUE INDEX green_lots_internal_code ON green_lots(internal_code);
CREATE INDEX green_lots_purchase_line ON green_lots(purchase_line_id);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  family TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('official', 'imported', 'user', 'extracted')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

CREATE TABLE profile_revisions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  schema_version INTEGER NOT NULL,
  short_name TEXT NOT NULL,
  document_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL,
  UNIQUE(profile_id, revision_number)
) STRICT;

CREATE INDEX profile_revisions_profile ON profile_revisions(profile_id, revision_number DESC);

CREATE TABLE roasts (
  id TEXT PRIMARY KEY,
  green_lot_id TEXT REFERENCES green_lots(id),
  coffee_id TEXT REFERENCES coffee_identities(id),
  profile_revision_id TEXT REFERENCES profile_revisions(id),
  roasted_at_ms INTEGER NOT NULL,
  source_timezone TEXT NOT NULL,
  level_thousandths INTEGER,
  development_basis_points INTEGER,
  green_input_mass_mg INTEGER,
  roasted_yield_mass_mg INTEGER,
  end_reason TEXT,
  result TEXT CHECK (result IN ('success', 'aborted', 'fault', 'unknown')),
  status TEXT NOT NULL CHECK (status IN (
    'provisional', 'reconciling', 'awaiting_finalization', 'completed', 'interrupted', 'recovery_required'
  )),
  notes TEXT NOT NULL DEFAULT '',
  promoted_tasting_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (level_thousandths IS NULL OR level_thousandths BETWEEN 0 AND 10000),
  CHECK (development_basis_points IS NULL OR development_basis_points BETWEEN 0 AND 10000),
  CHECK (green_input_mass_mg IS NULL OR green_input_mass_mg >= 0),
  CHECK (roasted_yield_mass_mg IS NULL OR roasted_yield_mass_mg >= 0)
) STRICT;

CREATE INDEX roasts_roasted_at ON roasts(roasted_at_ms DESC, id DESC);
CREATE INDEX roasts_lot_date ON roasts(green_lot_id, roasted_at_ms DESC, id DESC);

CREATE TABLE inventory_transactions (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES green_lots(id),
  transaction_kind TEXT NOT NULL CHECK (transaction_kind IN (
    'receipt', 'roast_consumption', 'adjustment', 'transfer_in', 'transfer_out', 'write_off'
  )),
  delta_mg INTEGER NOT NULL CHECK (delta_mg != 0),
  occurred_at_ms INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_roast_id TEXT REFERENCES roasts(id),
  transfer_id TEXT,
  idempotency_key TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX inventory_transactions_lot
  ON inventory_transactions(lot_id, occurred_at_ms, id);

CREATE TABLE roast_sample_streams (
  roast_id TEXT PRIMARY KEY REFERENCES roasts(id) ON DELETE CASCADE,
  stream_version INTEGER NOT NULL DEFAULT 1 CHECK (stream_version > 0),
  channel_schema_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  first_elapsed_ms INTEGER NOT NULL,
  last_elapsed_ms INTEGER NOT NULL,
  reconciliation_state TEXT NOT NULL CHECK (reconciliation_state IN ('provisional', 'reconciled'))
) STRICT;

-- Development cache for the first vertical slice. It is derived and can be rebuilt.
CREATE TABLE roast_series_points (
  roast_id TEXT NOT NULL REFERENCES roasts(id) ON DELETE CASCADE,
  sample_seq INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  temperature_milli_c INTEGER NOT NULL,
  profile_temperature_milli_c INTEGER,
  ror_milli_c_per_min INTEGER,
  PRIMARY KEY (roast_id, sample_seq)
) STRICT;

CREATE INDEX roast_series_points_range ON roast_series_points(roast_id, elapsed_ms, sample_seq);

CREATE TABLE tastings (
  id TEXT PRIMARY KEY,
  roast_id TEXT NOT NULL REFERENCES roasts(id),
  tasted_at_ms INTEGER NOT NULL,
  source_timezone TEXT NOT NULL,
  score_basis_points INTEGER,
  descriptors_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  conclusion TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  CHECK (score_basis_points IS NULL OR score_basis_points BETWEEN 0 AND 10000)
) STRICT;

CREATE INDEX tastings_roast ON tastings(roast_id, tasted_at_ms DESC, id DESC);

CREATE TABLE roast_events (
  id TEXT PRIMARY KEY,
  roast_id TEXT NOT NULL REFERENCES roasts(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
  temperature_milli_c INTEGER,
  source TEXT NOT NULL CHECK (source IN ('native', 'device', 'user', 'derived')),
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX roast_events_roast ON roast_events(roast_id, elapsed_ms, id);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  roast_id TEXT NOT NULL REFERENCES roasts(id) ON DELETE CASCADE,
  elapsed_ms INTEGER,
  temperature_milli_c INTEGER,
  annotation_type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
) STRICT;

CREATE INDEX annotations_roast ON annotations(roast_id, elapsed_ms, id);

CREATE TABLE roast_library_rows (
  roast_id TEXT PRIMARY KEY REFERENCES roasts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  roasted_at_ms INTEGER NOT NULL,
  coffee_id TEXT,
  coffee_name TEXT,
  provider_id TEXT,
  provider_name TEXT,
  purchase_id TEXT,
  purchase_reference TEXT,
  green_lot_id TEXT,
  lot_code TEXT,
  country_code TEXT,
  region TEXT,
  farm_producer TEXT,
  process TEXT,
  varieties_json TEXT NOT NULL DEFAULT '[]',
  profile_revision_id TEXT,
  profile_name TEXT,
  profile_revision_number INTEGER,
  roast_level_thousandths INTEGER,
  green_input_mass_mg INTEGER,
  roasted_yield_mass_mg INTEGER,
  roast_loss_basis_points INTEGER,
  development_basis_points INTEGER,
  tasting_score_basis_points INTEGER,
  tasting_descriptors_json TEXT,
  tasting_notes TEXT,
  tasting_conclusion TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  status TEXT,
  needs_tasting INTEGER NOT NULL CHECK (needs_tasting IN (0, 1)),
  ready_plan_status TEXT
) STRICT;

CREATE INDEX roast_library_date ON roast_library_rows(roasted_at_ms DESC, roast_id DESC);
CREATE INDEX roast_library_coffee_date ON roast_library_rows(coffee_id, roasted_at_ms DESC, roast_id DESC);
CREATE INDEX roast_library_provider_date ON roast_library_rows(provider_id, roasted_at_ms DESC, roast_id DESC);
CREATE INDEX roast_library_score ON roast_library_rows(tasting_score_basis_points DESC, roast_id DESC);

CREATE VIRTUAL TABLE roast_library_fts USING fts5(
  roast_id UNINDEXED,
  coffee_name,
  provider_name,
  farm_producer,
  process,
  tasting_notes,
  tasting_conclusion,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO app_metadata(id, schema_version, projection_version, created_at_ms)
VALUES (1, 1, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER));
