-- Local Tan Bridge identities and one-time claims. Secrets are retained only
-- as SHA-256 digests; the plaintext claim/device token exists only at the
-- controller boundary that returns it to the browser or bridge.

CREATE TABLE bridge_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_sha256 TEXT NOT NULL UNIQUE CHECK(length(token_sha256) = 64),
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  CHECK(expires_at_ms > created_at_ms),
  CHECK(consumed_at_ms IS NULL OR consumed_at_ms >= created_at_ms)
) STRICT;

CREATE INDEX bridge_claims_active
  ON bridge_claims(expires_at_ms)
  WHERE consumed_at_ms IS NULL;

CREATE TABLE tan_bridges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bridge_id TEXT NOT NULL UNIQUE
    CHECK(length(bridge_id) = 26 AND bridge_id NOT GLOB '*[^a-z2-7]*'),
  device_token_sha256 TEXT NOT NULL CHECK(length(device_token_sha256) = 64),
  firmware_version TEXT NOT NULL DEFAULT '' CHECK(length(firmware_version) <= 64),
  build_id TEXT NOT NULL DEFAULT '' CHECK(length(build_id) <= 64),
  state TEXT NOT NULL DEFAULT 'offline'
    CHECK(state IN ('offline', 'connected')),
  last_seen_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;

CREATE INDEX tan_bridges_last_seen
  ON tan_bridges(last_seen_at_ms DESC, id DESC);

UPDATE app_metadata SET schema_version = 9 WHERE id = 1;
