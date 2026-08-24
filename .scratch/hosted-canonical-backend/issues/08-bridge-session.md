# 08: Claims, bootstrap, bridge WebSocket

**What to build:** A signed-in operator can mint a one-time claim. A device that holds the matching signing key can bootstrap and open `wss://studio.tan.coffee/device/v1/session`. Tests use a fake device; no Nano required. Google login is not proof for this socket.

**Blocked by:** 03 (Hosted mode + Google operator session)

**Status:** completed

- [x] Operator session can create a one-time claim (short TTL, single successful use) via `/api/v1`.
- [x] `POST /device/v1/bootstrap` accepts a device-signed request, consumes the claim, and binds `bridgeId` + public key to this notebook.
- [x] Replaying a consumed claim with different identity is rejected; the documented retry-same-identity case holds.
- [x] A fake device completes the WebSocket handshake (prelude, challenge, signed authentication, session accepted) with subprotocol `tan-bridge.v1.protobuf`.
- [x] Heartbeat / idle rules from the bridge spec are encoded so a 20 s heartbeat keeps the session (proxy idle ≥ 90 s is a Caddy concern in ticket 05).
- [x] Operator cookie is neither required nor sufficient to open the device session.
- [x] Hostname pinned in product constants is `studio.tan.coffee` (replaces `bridge.tanstudio.xroma.dev`).
- [x] No hardware, no second process.

## Comments

Landed on `hosted/08-bridge-session` (`f56cb51`). Operator mints `POST /api/v1/claims`; device bootstrap + protobuf WebSocket handshake with a fake client. Bindings are in-memory until a later ticket. Not merged to `main`.
