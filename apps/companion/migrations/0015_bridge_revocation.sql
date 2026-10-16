-- A bridge's durable device token remains valid across reconnects until the
-- operator explicitly revokes that enrolled device.

ALTER TABLE tan_bridges
  ADD COLUMN revoked_at_ms INTEGER
  CHECK(revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms);

CREATE INDEX tan_bridges_active_token
  ON tan_bridges(bridge_id, device_token_sha256)
  WHERE revoked_at_ms IS NULL;

UPDATE app_metadata SET schema_version = 15 WHERE id = 1;
