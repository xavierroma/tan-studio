# H3: Retire the WSS bridge fiction from the docs

**What to build:** The repo's docs describe a bridge transport that does not exist. Make the written record match the code, and record the remote-bridge work honestly as future scope.

**Blocked by:** nothing

**Status:** completed

## The problem

`CONTEXT.md:28` describes "the authenticated WebSocket conversation between Tan Bridge and the canonical backend", and `docs/adr/0003-gcp-e2-micro-sqlite.md:7` names `wss://studio.tan.coffee/device/v1/session` as though it ships. Neither is true: there is no WebSocket anywhere in the service (`WebSocketUpgrade`, `tokio-tungstenite`, `axum::extract::ws` all return zero hits).

What actually ships is `apps/service/src/lan_bridge.rs`: the Atom dials out over **plaintext TCP on port 8081** with a length-prefixed binary frame protocol, and the service **rejects any non-private peer IP** at `lan_bridge.rs:122-135`. It is deliberately LAN-only; `firmware/tan-bridge-setup/README.md:20-25` says so outright.

Separately, `apps/service/src/tan_bridge.rs` is an in-memory simulator for an abandoned pull-based design. It is declared in `lib.rs` but referenced by no other module.

- [x] `CONTEXT.md` describes the real transport, not the WebSocket one.
- [x] A new ADR supersedes the transport claim in ADR 0003, recording: the bridge is LAN-only today; hosted mode runs with no bridge listener; the remote path is future work with a named cost.
- [x] ADR 0003 links forward to the superseding ADR. Do not rewrite its history — supersede it.
- [x] The remote-bridge work is captured as a future ticket, not silently dropped. It must name the real blockers: the private-IP rejection, no TLS in firmware, raw TCP cannot pass through Caddy, three hardcoded `xrc.local` sites (`api.rs:572`, `firmware/tan-bridge-setup/main/setup_main.c:36-37`, and a `z.literal` in `packages/api-contract/src/tan-bridge-setup.ts:8-9`), no reconnect/heartbeat, no per-operator ownership on `tan_bridges`, and that it needs a physical device reflash.
- [x] Note the one piece of good news: Web Serial provisioning works from a hosted HTTPS origin unchanged.
- [x] `bun run check` stays green.

Docs only. Do not change service or firmware code.

## Comments

- 2026-08-24 — Done in [ADR-0005](../../../docs/adr/0005-lan-only-bridge-transport.md), a forward link appended to ADR-0003, `CONTEXT.md` (bridge session, Tan Bridge, studio origin), and `H8-remote-bridge-transport.md`. No code touched.

  Two line refs above had rotted and are corrected in H8: the `xrc.local` in the service is `api.rs:801`, not `:572`. And `tan-bridge-setup.ts:8-9` is a plain `as const`; the enforcement that makes the web UI refuse a non-matching host is the `z.literal` union at `tan-bridge-setup.ts:113-116` — which also still carries the stale `bridge.tanstudio.xroma.dev` that ADR-0003 claimed to have replaced.

  Two further sites of the same fiction were found and recorded in H8 rather than fixed, since both are outside a docs-only change: `deploy/hosted/Caddyfile` has a live `handle /device/v1/session` block proxying to a route the service does not serve, and `firmware/tan-bridge-esp32s3/components/tan_bridge_api/openapi.json:108` still documents an "Authenticated WebSocket". Those two are the only remaining `WebSocket` hits in the repo.
