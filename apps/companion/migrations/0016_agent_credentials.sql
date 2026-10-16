CREATE TABLE agent_credentials (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE CHECK(length(token_sha256)=64),
  audience TEXT NOT NULL,
  can_write INTEGER NOT NULL CHECK(can_write IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER,
  revoked_at_ms INTEGER,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;

UPDATE app_metadata SET schema_version = 16 WHERE id = 1;
