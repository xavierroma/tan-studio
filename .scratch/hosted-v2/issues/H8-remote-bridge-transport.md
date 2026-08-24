# H8: Let Tan Bridge reach the hosted origin from the operator's home LAN

**What to build:** An Atom on home wifi keeps an authenticated, encrypted session to `studio.tan.coffee`, and the hosted notebook can read the Nano over it. Today it cannot — hosted mode has no bridge listener, and the LAN listener would drop the connection on sight.

**Blocked by:** H6 (a verified hosted deployment must exist first)

**Status:** ready-for-human

This is a firmware project, not a configuration change, and it ends at a device an agent cannot flash. Do not hand it to an AFK agent.

## Why this is not a small change

ADR-0005 records the shipping transport: the Atom dials out over plaintext TCP to port 8081, sends one newline-delimited JSON handshake, then tunnels SASSI in length-prefixed frames. Every blocker below is a consequence of that being designed for a trusted LAN.

Size this before committing to it. It is plausibly larger than everything H1–H7 cost together, and the notebook is fully useful without it.

## The blockers, each of which is load-bearing

- [ ] **The private-IP rejection.** `apps/service/src/lan_bridge.rs:122-135` drops any peer that is not private, loopback, or link-local, before the handshake is read. A device on home wifi reaching a GCP VM arrives with a public source address, so it is refused. This single check is why the hosted bridge cannot work today. Removing it is not the fix — it is the only thing currently standing between the bridge port and the open internet.
- [ ] **Hosted mode runs no listener.** `bridge_port` is `Some` only in `ServiceConfig::headless` (`apps/service/src/config.rs:189-199`); `ServiceConfig::hosted` sets it to `None` (`config.rs:261`) and `main.rs:95` binds only when it is `Some`. There is nothing listening to reach.
- [ ] **No TLS in the firmware at all.** `firmware/tan-bridge-setup/` has no TLS stack — no mbedTLS/esp-tls use, no trust store, no certificate pinning, no clock to validate `notAfter` against. Over the internet the session must be encrypted and server-authenticated, so this is new firmware work, not a flag.
- [ ] **Raw TCP on 8081 cannot pass through Caddy.** `deploy/hosted/Caddyfile` terminates TLS and reverse-proxies HTTP. A length-prefixed binary stream is not HTTP. Pick one: a real WebSocket upgrade on the existing 443 route (then implement the client side in C on the Atom), or a second TLS port opened in the OpenTofu firewall and terminated separately. Note the Caddyfile already has a `handle /device/v1/session` block for the route ADR-0003 imagined; it proxies to a path the service does not serve.
- [ ] **Three hardcoded `xrc.local` sites.** `apps/service/src/api.rs:801` (the claim response tells the device where to dial), `firmware/tan-bridge-setup/main/setup_main.c:36-37`, and `packages/api-contract/src/tan-bridge-setup.ts:8-9`. The contract constant is worse than a default: it is enforced by `z.literal` at `tan-bridge-setup.ts:113-116`, as a union of `xrc.local` and the stale `bridge.tanstudio.xroma.dev`. The web setup UI will **refuse to parse** a status frame naming any other host, so the backend host must become configurable through the contract before provisioning against `studio.tan.coffee` can even be attempted.
- [ ] **No reconnect, heartbeat, or backoff.** The LAN session assumes a stable local link and a nearby backend. A WAN session drops: needs keepalives, bounded exponential backoff, and resumption that does not burn a claim (claims are single-use and expire in ten minutes).
- [ ] **No per-operator ownership.** `tan_bridges` has no owner column (`apps/companion/migrations/0009_tan_bridge.sql`), and `bridge_claim_create` (`api.rs:790-793`) takes only `State` — nothing binds a minted claim to the operator who minted it. Acceptable on a LAN with one operator; on a public origin, decide deliberately who may enrol a device and record it against them.
- [ ] **It ends in a physical reflash.** No OTA path exists. Whatever is built, the operator has to plug the Atom into a machine and flash it. That gates iteration speed for the whole ticket.

## Also clean up while here

- [ ] `firmware/tan-bridge-esp32s3/components/tan_bridge_api/openapi.json:108` still documents an "Authenticated WebSocket" that does not exist. Same fiction ADR-0005 retired; it survived in the firmware contract.
- [ ] `apps/service/src/tan_bridge.rs` is an in-memory simulator for an abandoned pull-based design, declared in `lib.rs` and referenced by no other module. Delete it rather than mistake it for the plan.

## The one piece of good news

**Web Serial provisioning needs no work.** It requires only a secure context, which a hosted HTTPS origin satisfies, so `browserSerial` (`apps/web/src/lib/tan-bridge-setup.ts:221-224`) works unchanged from `https://studio.tan.coffee`. The operator can already provision an Atom's wifi credentials from the hosted UI over USB. Only the bridge's own backend connection is LAN-bound.

## Definition of done

With the Atom on home wifi and nothing but a hosted origin to talk to: it completes a session against `studio.tan.coffee` over an encrypted, server-authenticated transport; the hosted notebook reads a live Nano over it; the session survives a wifi drop and reconnects without a fresh claim; and no listener anywhere accepts an unauthenticated plaintext peer.
