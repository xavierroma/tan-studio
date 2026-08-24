# H3: Retire the WSS bridge fiction from the docs

**What to build:** The repo's docs describe a bridge transport that does not exist. Make the written record match the code, and record the remote-bridge work honestly as future scope.

**Blocked by:** nothing

**Status:** ready-for-agent

## The problem

`CONTEXT.md:28` describes "the authenticated WebSocket conversation between Tan Bridge and the canonical backend", and `docs/adr/0003-gcp-e2-micro-sqlite.md:7` names `wss://studio.tan.coffee/device/v1/session` as though it ships. Neither is true: there is no WebSocket anywhere in the service (`WebSocketUpgrade`, `tokio-tungstenite`, `axum::extract::ws` all return zero hits).

What actually ships is `apps/service/src/lan_bridge.rs`: the Atom dials out over **plaintext TCP on port 8081** with a length-prefixed binary frame protocol, and the service **rejects any non-private peer IP** at `lan_bridge.rs:122-135`. It is deliberately LAN-only; `firmware/tan-bridge-setup/README.md:20-25` says so outright.

Separately, `apps/service/src/tan_bridge.rs` is an in-memory simulator for an abandoned pull-based design. It is declared in `lib.rs` but referenced by no other module.

- [ ] `CONTEXT.md` describes the real transport, not the WebSocket one.
- [ ] A new ADR supersedes the transport claim in ADR 0003, recording: the bridge is LAN-only today; hosted mode runs with no bridge listener; the remote path is future work with a named cost.
- [ ] ADR 0003 links forward to the superseding ADR. Do not rewrite its history — supersede it.
- [ ] The remote-bridge work is captured as a future ticket, not silently dropped. It must name the real blockers: the private-IP rejection, no TLS in firmware, raw TCP cannot pass through Caddy, three hardcoded `xrc.local` sites (`api.rs:572`, `firmware/tan-bridge-setup/main/setup_main.c:36-37`, and a `z.literal` in `packages/api-contract/src/tan-bridge-setup.ts:8-9`), no reconnect/heartbeat, no per-operator ownership on `tan_bridges`, and that it needs a physical device reflash.
- [ ] Note the one piece of good news: Web Serial provisioning works from a hosted HTTPS origin unchanged.
- [ ] `bun run check` stays green.

Docs only. Do not change service or firmware code.
