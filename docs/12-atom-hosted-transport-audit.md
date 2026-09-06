# AtomS3 Lite to hosted Tan Studio: implementation audit and plan

> Historical audit: this document records the pre-implementation evidence and
> the plan that followed from it. The hosted WSS transport is now implemented;
> [ADR-0008](./adr/0008-hosted-bridge-websocket.md) is the current decision and
> `firmware/tan-bridge-setup/README.md` is the physical update runbook.

**Audit baseline:** repository `HEAD` `6c4af912173dcad06221139ce6838fd6b938a2fc`
on 30 August 2026. The authentication-redirect edits already present in the
working tree are unrelated to the bridge transport. This note treats source,
tests, build scripts, and deployment manifests as authoritative. H8 and the
ADRs are compared against that evidence rather than assumed current.

## Conclusion

An AtomS3 Lite cannot connect to the hosted notebook today. The image that
actually runs the local bridge dials plaintext TCP at the compile-time address
`xrc.local:8081`; hosted mode deliberately starts no bridge listener; and the
hosted HTTP service has no WebSocket route or WebSocket server dependency
([setup firmware constants](../firmware/tan-bridge-setup/main/setup_main.c#L30-L48),
[hosted configuration](../apps/service/src/config.rs#L284-L302),
[listener startup](../apps/service/src/main.rs#L95-L109),
[service dependencies](../apps/service/Cargo.toml#L9-L35)). Caddy exposes the
single HTTP service on HTTPS and does not expose port 8081
([Caddyfile](../deploy/hosted/Caddyfile#L7-L14),
[hosted environment](../deploy/hosted/install.sh#L191-L210)).

WSS is therefore **not the current transport**. It is still the best target for
this implementation: it preserves the existing full-duplex session, uses the
already exposed outbound port 443 and Caddy TLS boundary, and avoids publishing
the LAN-only raw TCP listener. The proposed endpoint is
`wss://studio.tan.coffee/device/v1/session`. This is a design recommendation,
not a claim that the route exists.

The shortest safe route is to evolve `firmware/tan-bridge-setup`, because that
is the only image that currently combines setup, Wi-Fi, device authentication,
USB tunnelling, and the tested SASSI transmit allowlist. The nominal
`firmware/tan-bridge-esp32s3` workspace is currently a receive-only safety
foundation with networking and SASSI transmit compile-time disabled, not the
image used for local operation
([local image README](../firmware/tan-bridge-setup/README.md#L1-L24),
[foundation policy](../firmware/tan-bridge-esp32s3/components/tan_board/include/tan_build_config.h#L4-L25),
[foundation runtime wiring](../firmware/tan-bridge-esp32s3/main/app_main.c#L43-L85)).

## What ships now

### Firmware and provisioning

The operational local image is version `0.2.7-local`, build
`local-lan-v8-heap-tunnel`, from `firmware/tan-bridge-setup`
([runtime identity](../firmware/tan-bridge-setup/main/setup_main.c#L36-L46),
[reproducible build version](../script/build_tan_bridge_setup_firmware.sh#L4-L9)).
Its ESP-IDF application directly requires Wi-Fi, lwIP, NVS, JSON, TinyUSB, and
core-dump support; it has no HTTP, WebSocket, TLS, or OTA component in its build
manifest
([component manifest](../firmware/tan-bridge-setup/main/CMakeLists.txt#L1-L12),
[managed dependencies](../firmware/tan-bridge-setup/main/idf_component.yml#L1-L5)).

Setup is strict JSON Lines over USB CDC at 115,200 baud. The browser can issue
only `setup.getStatus`, `setup.scanWifi`, and `setup.configure`; configure sends
SSID, Wi-Fi credential, and a 64-hex-character claim token. It does **not** send
a backend URL or transport selection
([browser serial client](../apps/web/src/lib/tan-bridge-setup.ts#L52-L121),
[shared request schema](../packages/api-contract/src/tan-bridge-setup.ts#L177-L212),
[firmware configure handler](../firmware/tan-bridge-setup/main/setup_main.c#L705-L789)).
The setup panel first mints a backend claim, insists that the returned endpoint
is exactly `xrc.local:8081`, and then sends only the claim token to the Atom
([setup panel](../apps/web/src/components/tan-bridge-setup-panel.tsx#L149-L180)).
The shared status schema also constrains the backend host to `xrc.local` or the
obsolete `bridge.tanstudio.xroma.dev`
([backend constants and schema](../packages/api-contract/src/tan-bridge-setup.ts#L5-L9),
[status backend field](../packages/api-contract/src/tan-bridge-setup.ts#L109-L118)).

Consequently, Web Serial itself remains usable from the hosted HTTPS page, but
the **provisioning contract and UI do require changes** for hosted transport.
H8's statement that provisioning needs no work is too broad.

### Wire transport

After Wi-Fi association the Atom resolves IPv4 `xrc.local`, opens a plain
`SOCK_STREAM` connection to port 8081, and performs no TLS or HTTP handshake
([backend connection](../firmware/tan-bridge-setup/main/setup_main.c#L1007-L1082)).
It first writes one newline-delimited JSON hello containing schema version,
bridge identity, firmware/build identity, and exactly one of a claim token or a
device token
([Atom hello](../firmware/tan-bridge-setup/main/setup_main.c#L1108-L1158),
[service hello validation](../apps/service/src/lan_bridge.rs#L149-L196)).

After authentication the connection is a small binary tunnel. Every record is
`kind:u8`, `length:u16` big-endian, then payload; kind 1 carries Nano USB bytes
to the backend and kind 2 carries allowed SASSI frames to the Nano. Both ends
cap payloads at 8 KiB
([Atom framing](../firmware/tan-bridge-setup/main/setup_main.c#L938-L948),
[Atom receive loop](../firmware/tan-bridge-setup/main/setup_main.c#L1160-L1199),
[service decoder](../apps/service/src/lan_bridge.rs#L339-L385),
[service writer](../apps/service/src/lan_bridge.rs#L417-L438)).

The LAN listener rejects non-private, non-loopback, and non-link-local source
addresses before device authentication
([peer gate](../apps/service/src/lan_bridge.rs#L114-L146)). That gate is an
important LAN safety property, but it is not the sole hosted blocker: hosted
mode never binds the listener in the first place.

### Claim and device authentication lifecycle

`POST /api/v1/bridges/claims` creates a random 32-byte claim, stores only its
SHA-256 digest, and expires it after ten minutes
([claim creation](../apps/service/src/lan_bridge.rs#L51-L87),
[schema](../apps/companion/migrations/0009_tan_bridge.sql#L1-L17)). The current
API response always advertises `xrc.local` even when called on a hosted service
([claim route](../apps/service/src/api.rs#L833-L850)).

On first tunnel connection the service consumes the claim and creates or
updates the bridge with a new random device token, again retaining only a
SHA-256 digest. The Atom persists the plaintext device token in NVS and erases
the claim; later reconnects authenticate with that durable token
([service exchange](../apps/service/src/lan_bridge.rs#L230-L336),
[Atom token persistence](../firmware/tan-bridge-setup/main/setup_main.c#L1084-L1105),
[Atom NVS load](../firmware/tan-bridge-setup/main/setup_main.c#L1282-L1326)).
Claims are single use, but device tokens currently have no expiry, rotation,
or revocation column/API
([bridge table](../apps/companion/migrations/0009_tan_bridge.sql#L19-L35),
[bridge HTTP routes](../apps/service/src/api.rs#L163-L174)).

Because the local database was migrated to hosted Tan Studio, an existing
Atom's preserved device token can be reused **if** its matching `tan_bridges`
row was included in that migration. The first hosted firmware should try the
preserved token before asking the operator to claim again. A fresh claim remains
the recovery path when that row or token does not match.

### Reconnect, buffering, and spool behavior

H8 is stale when it says there is no reconnect or backoff. The Atom continuously
reassociates Wi-Fi and reconnects: Wi-Fi/backend failures wait 3 seconds and a
closed authenticated tunnel waits 1.5 seconds
([network task](../firmware/tan-bridge-setup/main/setup_main.c#L1202-L1228)).
Those are fixed delays, not bounded exponential backoff with jitter. There is
also no application heartbeat, WebSocket ping/pong, TCP keepalive setup, or
deadline around the tunnel's blocking receive, so a half-open WAN connection
can remain undetected
([socket receive](../firmware/tan-bridge-setup/main/setup_main.c#L905-L935),
[tunnel loop](../firmware/tan-bridge-setup/main/setup_main.c#L1174-L1199)).

The operational image has an 8 KiB **RAM bootstrap buffer**, not a durable
spool. It captures early Nano bytes until the first validated response reaches
the Nano and replays the retained bootstrap after reconnect; it is lost on
power failure
([buffer state](../firmware/tan-bridge-setup/main/setup_main.c#L91-L100),
[capture and replay](../firmware/tan-bridge-setup/main/setup_main.c#L950-L1005)).
The separate receive-only foundation has a tested record-spool model and a
flash partition, but `app_main` does not instantiate that component or mount
the partition
([spool API](../firmware/tan-bridge-esp32s3/components/tan_spool/include/tan_spool.h#L27-L62),
[foundation partitions](../firmware/tan-bridge-esp32s3/partitions.csv#L1-L8),
[actual foundation wiring](../firmware/tan-bridge-esp32s3/main/app_main.c#L43-L85)).

A durable Atom spool is not required for the first hosted read path. The Nano
filesystem remains the source of profiles and roast logs, and the Rust service
re-lists and re-reads that library whenever a bridge session becomes ready
([automatic synchronization](../apps/service/src/device.rs#L259-L283),
[directory/file reads](../apps/service/src/device.rs#L617-L726)). Resilient
session detection and retry are required; a general offline upload queue can be
deferred until evidence shows the Nano filesystem is insufficient.

### Read versus write capability

The current product is read-only at the application level even though SASSI
requires the backend to transmit protocol frames. The service and Atom both
allow only types 1 (chunk acknowledgement), 3 (time handshake), 5 (directory
list), 7 (file read), and 13 (information query)
([service allowlist](../apps/service/src/lan_bridge.rs#L417-L477),
[Atom allowlist](../firmware/tan-bridge-setup/main/tunnel_policy.c#L1-L32),
[allowlist host test](../firmware/tan-bridge-setup/host-tests/test_tunnel_policy.c#L15-L33)).
The service uses those frames to read `.kpro` profiles and `.klog` roast logs
into the hosted database
([SASSI encoders](../apps/service/src/sassi.rs#L344-L395),
[sync implementation](../apps/service/src/device.rs#L634-L712)).

Thus “Atom pushes directly” can mean that a newly completed roast becomes
available in hosted Tan Studio without a Mac or Pi. It cannot mean pushing a
profile from hosted Tan Studio into the Nano, starting/stopping a roast, or
issuing arbitrary serial commands. Those remain outside this plan.

### Hosted routes and deployment boundary

The hosted router exposes health, Google auth, `/api/v1`, and the SPA; there is
no `/device/v1/session` route
([router construction](../apps/service/src/api.rs#L163-L319)). Axum is compiled
without its `ws` feature, and no WebSocket crate is a service dependency
([Cargo manifest](../apps/service/Cargo.toml#L9-L35)). Hosted configuration sets
`bridge_port` to `None`, while `main` starts the raw listener only for a
configured bridge port
([hosted mode](../apps/service/src/config.rs#L284-L317),
[listener startup](../apps/service/src/main.rs#L95-L109)).

Caddy redirects HTTP to HTTPS and reverse-proxies all HTTPS HTTP traffic to
`127.0.0.1:8080`; contrary to H8, the current Caddyfile has no special
`handle /device/v1/session` block
([Caddyfile](../deploy/hosted/Caddyfile#L7-L14)). The deployment unit binds the
service only to loopback port 8080
([generated environment](../deploy/hosted/install.sh#L191-L210)). The repository
contains no OpenTofu/Terraform firewall configuration to change or validate.
The recommended WSS route stays on existing 443, so it should not require a new
public firewall port.

### Physical flash and OTA

There is no device OTA implementation. The foundation explicitly compiles OTA
out, and the operational setup image has no OTA component
([foundation OTA stub](../firmware/tan-bridge-esp32s3/components/tan_update/tan_update.c#L1-L13),
[setup component list](../firmware/tan-bridge-setup/main/CMakeLists.txt#L1-L12)).

The existing update path is physical USB in ESP32-S3 ROM download mode, with
the Nano disconnected. A full recovery flash erases the chip and writes
bootloader, partition table, and app
([full flash script](../script/flash_tan_bridge_setup_firmware.sh#L4-L42)). The
guarded application-only updater writes only offset `0x10000`, deliberately
preserving the NVS bridge identity, Wi-Fi credential, and device token
([update script](../script/update_tan_bridge_setup_firmware.sh#L4-L31)). That is
the correct first hosted update mechanism because retaining the token may avoid
a new claim after the database migration.

## Corrections to H8

H8 was added by commit `767c4ae` on 24 August 2026. Its central conclusion—no
shipping cloud transport—is correct, but these details must not drive the new
work unchanged:

1. **Not one blocker:** the private-source-IP rejection is not “the single
   check” preventing hosted operation. Hosted mode also starts no listener,
   and the Atom dials a different host over a transport Caddy does not proxy
   ([peer gate](../apps/service/src/lan_bridge.rs#L114-L146),
   [hosted config](../apps/service/src/config.rs#L284-L302)).
2. **Caddy drift:** H8 says Caddy already has a device-session handle. The
   current file does not
   ([Caddyfile](../deploy/hosted/Caddyfile#L7-L14)).
3. **Reconnect exists:** fixed-delay Wi-Fi/backend reconnect and bootstrap
   replay ship today. The missing WAN pieces are heartbeat, dead-peer
   detection, exponential backoff, jitter, and connection deadlines
   ([network loop](../firmware/tan-bridge-setup/main/setup_main.c#L1202-L1228)).
4. **Provisioning needs contract work:** Web Serial transport works on HTTPS,
   but the request carries no endpoint and both UI and firmware enforce the
   LAN address
   ([configure schema](../packages/api-contract/src/tan-bridge-setup.ts#L196-L212),
   [UI endpoint check](../apps/web/src/components/tan-bridge-setup-panel.tsx#L149-L172)).
5. **Ownership needs context:** this hosted deployment is a single-operator
   notebook. A multi-tenant owner model is not a prerequisite, but public
   device enrollment should be restricted to the operator session, recorded
   for audit, and paired with device-token revocation. Today any credential
   accepted by the API security layer can reach the claim route, because the
   handler has no operator-session-only check
   ([claim route](../apps/service/src/api.rs#L833-L850),
   [operator-only precedent](../apps/service/src/api.rs#L752-L819)).

## Recommended target protocol

Keep the current application semantics and replace only the public transport:

1. The Atom associates Wi-Fi, obtains trustworthy wall time, and opens
   `wss://studio.tan.coffee/device/v1/session` with normal public-PKI hostname
   validation. That production URI is a build-time invariant, not an arbitrary
   value accepted from Web Serial or NVS. A development build may use a
   separately identified compile-time override for a test server.
2. Its first text message is the existing strict `BridgeHello`; the server
   replies with the existing accepted/rejected JSON result and issues a device
   token when a one-time claim was presented.
3. Thereafter, each WebSocket binary message contains exactly one existing
   three-byte-header tunnel record. This keeps direction and size validation
   shared with the LAN implementation while making WebSocket message bounds
   explicit.
4. Both sides use WebSocket ping/pong and an application session deadline.
   The Atom reconnects with its durable device token using bounded exponential
   backoff plus jitter. A reconnect never consumes another claim.
5. The backend-to-Nano SASSI allowlist remains enforced independently on both
   sides. Cloud transport must not widen device capabilities.

WSS is preferred over HTTPS polling because the Nano session is interactive and
full duplex: the Nano initiates the SASSI handshake, the service answers, and
file transfers alternate chunks and acknowledgements. It is preferred over a
new public TLS/TCP port because port 443 and the Caddy TLS boundary already
exist, whereas a second listener would add certificate termination, firewall,
and public-service hardening work.

### Implementation shape

Create one deep `bridge_session` **Module** whose **Interface** is an
authenticated, bounded `Read + Write + Send` Nano byte stream plus bridge
identity. The raw LAN transport and hosted WSS transport are separate
**Implementations** behind that Interface. Move the existing concrete
`BridgeTransport` attachment to a boxed transport **Seam** in
`NanoDeviceManager`; a bounded channel-backed WebSocket **Adapter** translates
Axum's asynchronous messages to the synchronous device worker.

This gives the protocol validator **Depth**: hello authentication, direction,
payload bounds, read-only SASSI policy, session replacement, and database state
updates stay hidden behind one small Interface. It gives **Leverage** because
the same tests protect LAN and WSS, and preserves **Locality** by keeping
WebSocket scheduling out of the Nano/SASSI state machine.

## Implementation plan

### 1. Freeze the protocol in tests

- Extract the hello/result and binary record codecs from
  `apps/service/src/lan_bridge.rs` so raw TCP and WSS use one validator.
- Add tests for claim exchange, durable-token reconnect, wrong message type,
  oversized payload, malformed direction, unauthenticated timeout, duplicate
  live session, ping timeout, and revoked token.
- Extend the virtual Nano simulator with the hosted transport so the complete
  SASSI synchronization can run without hardware. The existing simulator and
  E2E establish the local reference behavior
  ([simulator bridge client](../apps/service/src/bin/tan-nano-simulator.rs#L71-L138),
  [existing E2E](../script/test_simulated_nano_e2e.py#L94-L163)).

### 2. Add the hosted session endpoint

- Enable Axum WebSocket support and add `GET /device/v1/session` outside the
  human `/api/v1` authentication middleware but inside host validation.
- Authenticate the device in the first WebSocket message; do not accept an
  operator cookie, client-supplied identity header, or unauthenticated binary
  data as device identity.
- Refactor `NanoDeviceManager` away from the concrete `BridgeTransport` so a
  bounded channel-backed WSS transport can implement its synchronous
  `Read + Write + Send` session boundary
  ([current concrete attachment](../apps/service/src/device.rs#L44-L52),
  [manager attach](../apps/service/src/device.rs#L124-L129),
  [TCP-only transport](../apps/service/src/lan_bridge.rs#L339-L451)).
- Keep hosted `bridge_port=None` and the private-peer gate on the LAN listener.
  Do not expose or repurpose raw port 8081.
- Add token revocation and make hosted claim minting operator-session-only.
  Record claim creation/consumption without logging plaintext tokens.

### 3. Make the provisioning contract hosted-aware without accepting arbitrary endpoints

- Version the USB status schema and replace the host/port literals with a
  constrained backend descriptor for the reviewed production WSS origin.
  Remove the obsolete bridge hostname. `setup.configure` can remain Wi-Fi plus
  claim only; it must not accept an arbitrary URL.
- Change the claim response to describe the canonical WSS session in hosted
  mode while retaining the current LAN descriptor only for the explicitly
  local build. The UI may verify this descriptor, but production firmware still
  pins its own URI.
- Compile the production firmware for `studio.tan.coffee`. Preserve existing
  NVS unchanged during the application update so the first connection tries
  the migrated device token automatically. A separately labelled development
  build may pin a test URI; there is no runtime endpoint switch.
- Update the setup panel to show Hosted versus Local LAN explicitly. A fresh
  `setup.configure` remains the recovery path when the preserved token does not
  match; it deliberately erases that token before storing the new claim
  ([current erase](../firmware/tan-bridge-setup/main/setup_main.c#L730-L770)).

### 4. Replace the Atom network transport

- Add the ESP-IDF WebSocket/TLS client component to
  `firmware/tan-bridge-setup`; validate the public certificate chain and exact
  hostname, and fail closed on certificate or time failure.
- Synchronize wall time before certificate validation. The current Atom has no
  SNTP or other clock initialization in its network path
  ([Wi-Fi and connection path](../firmware/tan-bridge-setup/main/setup_main.c#L1007-L1082)).
- Preserve the current hello/token exchange, binary bounds, bootstrap capture,
  and independent SASSI allowlist. Clear or age stale bootstrap state according
  to a tested reconnect rule.
- Add ping/pong, receive deadlines, bounded exponential backoff with jitter,
  Wi-Fi event handling, and explicit diagnostic states for TLS, WebSocket,
  authentication, and retry.
- Keep durable flash spooling out of the first increment unless a test proves
  the Nano library cannot recover after transport loss.

### 5. Deploy and verify before touching hardware

- Run Rust unit/integration tests, hosted deployment tests, firmware contract
  tests, setup host tests, the virtual Nano WSS E2E, and the full repository
  gate.
- Deploy the service/UI first. Verify HTTPS remains authenticated, WSS rejects
  unauthenticated and revoked devices, and the VM still exposes no raw 8081
  listener.
- Generate the reviewed firmware image with the pinned ESP-IDF build
  ([build script](../script/build_tan_bridge_setup_firmware.sh#L17-L47)). Record
  its version, size, partition capacity, and SHA-256 before asking for the Atom.
  If TLS/WSS makes the image exceed the existing 1 MiB factory partition, add a
  reviewed partition-table migration that keeps NVS at its existing offset and
  writes the application at `0x10000`; do not fall back silently to erase-flash.

### 6. One supervised physical update

1. Disconnect the Nano and plug the Atom into the Mac.
2. Read and save redacted setup status and reset counters before flashing.
3. Put the Atom in ROM download mode and identify the explicit
   `/dev/cu.usbmodem...` port.
4. Use the application-only updater so NVS identity, Wi-Fi, and device token
   survive. Use the erase-and-full-flash script only as a documented recovery
   path.
5. After reboot, let the production firmware try its pinned hosted origin and
   preserved token. If authentication fails, mint one fresh hosted claim and
   repeat Wi-Fi setup once; no endpoint is entered or stored.
6. Reconnect the Atom's single USB-C port to the powered Nano. Confirm the
   hosted `/api/v1/device` reports `tan-bridge`, completes startup sync, imports
   the expected Nano files, and records the bridge online.
7. Exercise Wi-Fi loss and service restart. Confirm the same device token
   reconnects, no new claim is consumed, synchronization recovers, and
   brownout/watchdog counters do not increase. The existing hardware harness
   shows the evidence pattern to preserve
   ([Atom HIL setup](../script/test_bridge_atom_hil.py#L29-L110),
   [HIL assertions](../script/test_bridge_atom_hil.py#L139-L164)).

## Readiness gate for the operator

Do **not** ask the operator to plug in the Atom merely because the backend code
compiles. Say “ready to plug in” only after all of these are true:

- the hosted WSS endpoint is deployed and its negative authentication tests
  pass;
- the virtual Nano completes a full hosted WSS sync;
- the firmware build and host tests pass from the pinned ESP-IDF image;
- an application binary version, size, partition capacity, and digest have been
  recorded;
- the application-only updater has been checked against the generated flash
  arguments, or an explicit NVS-preserving partition migration has been tested;
  and
- the exact supervised commands and recovery path are prepared.

Until that gate passes, plugging in the Atom creates no useful evidence and
risks spending the only physical iteration before the server side is ready.
