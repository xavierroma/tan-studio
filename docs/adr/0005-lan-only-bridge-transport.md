# The Tan Bridge transport is LAN-only plaintext TCP

Tan Bridge reaches the canonical backend by dialling **out over plaintext TCP** to the service's bridge listener (default port 8081). One newline-delimited JSON handshake carries either a single-use claim token or a durable device token; after that, a 3-byte-header length-prefixed frame protocol tunnels SASSI bytes in both directions (`apps/service/src/lan_bridge.rs`). Enrolment mints a claim that is good for ten minutes and stored only as a SHA-256 digest, exchanged on first connection for a device token (`bridge_claims` and `tan_bridges` in `apps/companion/migrations/0009_tan_bridge.sql`).

This is LAN-only by construction: the accept loop drops any peer whose source address is not private, loopback, or link-local before the handshake is even read (`accept_bridge_connections` in `lan_bridge.rs`). `firmware/tan-bridge-setup/README.md` scopes the unencrypted transport to a trusted-LAN milestone deliberately.

**This supersedes the transport claim in ADR-0003.** There is no WebSocket anywhere in the service — `WebSocketUpgrade`, `tokio-tungstenite`, and `axum::extract::ws` all return zero hits — and `wss://studio.tan.coffee/device/v1/session` was never built. It was recorded as though it shipped, and hosted planning was then done against a route that does not exist. The written record is the fix.

**Hosted mode runs with no bridge listener at all.** `bridge_port` is `Some` only in `ServiceConfig::headless`; `ServiceConfig::hosted` sets it to `None`, and `main.rs` binds a listener only when it is `Some`. A hosted notebook is therefore for the notebook, not for live roasting — the Nano stays on a LAN placement until the remote path is built.

The remote path is **future work with a named cost**, not a route to enable — tracked as `.scratch/hosted-v2/issues/H8-remote-bridge-transport.md`. The Atom has no TLS stack, raw TCP cannot pass through Caddy, the backend host is hardcoded to `xrc.local` in three places, and it ends in a physical reflash. Naming that cost is the point of this ADR: the old wording implied a configuration change where the truth is a firmware project.

**Unaffected:** Web Serial provisioning needs only a secure context, so it works from `https://studio.tan.coffee` unchanged (`browserSerial` in `apps/web/src/lib/tan-bridge-setup.ts`). Only the bridge's own backend connection is LAN-bound.

`apps/service/src/tan_bridge.rs` is not the plan of record either. It is an in-memory simulator for an abandoned pull-based `/bridge/v1/*` design: declared in `lib.rs`, referenced by no other module, exercised only by its own tests. Treat it as dead weight to delete, not as a design to build on.
