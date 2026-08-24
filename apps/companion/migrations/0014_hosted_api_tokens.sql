-- Hosted API tokens: the credential an MCP client or plain HTTP client presents
-- to the studio origin instead of the operator's browser session. Secrets are
-- retained only as SHA-256 digests; the plaintext exists once, in the mint
-- response the operator reads.

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 64),
  token_sha256 TEXT NOT NULL UNIQUE CHECK(length(token_sha256) = 64),
  created_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER,
  revoked_at_ms INTEGER,
  CHECK(last_used_at_ms IS NULL OR last_used_at_ms >= created_at_ms),
  CHECK(revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms)
) STRICT;

CREATE INDEX api_tokens_active
  ON api_tokens(token_sha256)
  WHERE revoked_at_ms IS NULL;

UPDATE app_metadata SET schema_version = 14 WHERE id = 1;
