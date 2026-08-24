# Spec: Hosted canonical backend on studio.tan.coffee

Status: ready-for-agent

ADRs: `docs/adr/0001-hosted-canonical-backend.md`, `0002-operator-google-oidc.md`, `0003-gcp-e2-micro-sqlite.md`.
Protocol: `docs/10-tan-bridge-native-protocol.md`.
Glossary: `CONTEXT.md`.
Tickets: `issues/01`–`14` in this directory.

## Problem Statement

The operator cannot use the notebook away from home without leaving a LAN appliance running. That appliance is cumbersome, is HTTP with a token in the HTML, and ties the Nano USB port to the same process that owns the notebook. Taking the notebook off the LAN must not create a second backend, must not lose roast history, and must not require a computer left on next to the roaster.

## Solution

One canonical backend, hosted. The operator opens `https://studio.tan.coffee`, signs in with Google (their email only), and uses the same notebook from anywhere. SQLite stays the notebook store and is continuously replicated to GCS. Attachments live in GCS. Tan Bridge (AtomS3 Lite) plugs into the Nano USB-C port and opens a device-authenticated WebSocket on the **same** service:

```text
wss://studio.tan.coffee/device/v1/session
```

There is no LAN daemon, no separate bridge deployment, and no second notebook. Apex `tan.coffee` remains the future public site and is not this product.

## User Stories

1. As the operator, I want to open `https://studio.tan.coffee` on a phone or laptop off my LAN, so that I can read and edit the notebook on the go.
2. As the operator, I want to sign in with Google, so that I use an industry-standard login instead of a LAN token in the page.
3. As the operator, I want only my Google email to succeed, so that a random Google account cannot see roast 15.
4. As the operator, I want a rejected login to tell me I am not the operator, so that I am not looking at a blank app or a generic OAuth error.
5. As the operator, I want to sign out, so that a shared browser is not a live session.
6. As the operator, I want my session to expire and require Google again, so that a stolen laptop is not a forever key.
7. As the operator, I want `/api/v1` to refuse unauthenticated calls, so that the public origin is not a writable notebook.
8. As the operator, I want the HTML of the app to contain no bearer token, so that viewing source is not owning the API.
9. As the operator, I want Host and Origin checks to accept only `studio.tan.coffee`, so that a hostile Host header cannot use the service.
10. As the operator, I want `tan.coffee` to stay unused by this service, so that the public site can exist later without colliding with the notebook.
11. As the operator, I want the same Profile / Coffee / Roast / Brew / Note / Attachment / Label / Settings model as today, so that hosting is not a new product.
12. As the operator, I want existing short integer IDs to survive cutover, so that “roast 15” is still roast 15.
13. As the operator, I want my current Mac/Pi notebook copied once onto the host, so that I do not start from an empty database.
14. As the operator, I want the home copy to stop being canonical after cutover, so that I never wonder which roast 15 is real.
15. As the operator, I want to upload a photo or PDF of up to 512 MiB as an attachment, so that hosting does not shrink the product.
16. As the operator, I want that file to live in the object store, so that a VM disk death does not delete the photo.
17. As the operator, I want native KLOG/KPRO bytes to remain lossless evidence, so that imports stay reversible.
18. As the operator, I want a disk death or a bad deploy to be recoverable from the object store, so that I do not lose the notebook.
19. As the operator, I want a documented restore I have actually run (or can run), so that “we have backups” is not a hope.
20. As the operator, I want budget alerts on the GCP project, so that free-tier egress does not become a surprise bill.
21. As the operator, I want to leave the Raspberry Pi and Mac LAN daemon off, so that I am not running a host on the LAN.
22. As the operator, I want the Nano to keep roasting at home without a computer left on, so that the only home hardware is the roaster plus Tan Bridge.
23. As the operator, I want to set up Tan Bridge from the signed-in studio UI over Web Serial, so that I never type a backend URL into the device.
24. As the operator, I want Wi-Fi credentials to go from the browser to the bridge only, so that the canonical backend never sees my home Wi-Fi password.
25. As the operator, I want a one-time claim that binds this bridge’s signing key to my notebook, so that a random Atom cannot upload into my roasts.
26. As the operator, I want the bridge to dial `wss://studio.tan.coffee/device/v1/session` by itself, so that I do not open inbound ports on my router.
27. As the operator, I want that session to prove the device key, so that a stolen cookie or LAN token cannot impersonate the bridge.
28. As the operator, I want Google login to be useless to the bridge, so that a dongle is not a fake user.
29. As the operator, I want `/device/v1` not to be a React route, so that the SPA cannot steal the WebSocket path.
30. As the operator, I want the bridge to keep a durable spool when the internet drops, so that a roast during an outage is not lost.
31. As the operator, I want a finished KLOG to reconcile into the planned roast on the hosted notebook, so that roasting at home still updates the canonical notebook.
32. As the operator, I want to watch device status from the studio UI while I am not at home, so that I know the bridge is online.
33. As the operator, I want write operations to the Nano to stay capability-gated as in the bridge spec, so that hosting does not silently enable format/delete/firmware.
34. As the operator, I want the official Kaffelogic Wireless Connect Module unused, so that I am not exposing TCP 9056.
35. As a future restorer, I want OpenTofu in the repo to recreate the VM, disk, firewall, bucket, DNS, and service account, so that leaving GCP is a weekend of primitives plus restore, not archaeology.
36. As a future restorer, I want the app to talk SQLite and the S3 API (GCS HMAC), so that the code is not glued to Cloud Run or App Platform.
37. As the operator, I want desktop loopback mode to keep working for development, so that `bun run dev` does not require GCP.
38. As the operator, I want the LAN appliance path to remain in the tree until cutover is done, so that I can still work locally during the build.
39. As the operator, I want `/healthz` to stay unauthenticated but Host-restricted, so that install and uptime checks do not need Google.
40. As the operator, I want secrets out of git, so that the OIDC client secret and HMAC keys are not in the repo.
41. As the operator, I want MCP/CLI against the hosted origin later, so that agents can use the same notebook — but that can wait until browser + bridge work.
42. As the operator, I want the USB-role hardware gate respected, so that production bridge firmware is not flashed onto a live Nano before the probe passes.
43. As the operator, I want firmware that still cannot talk to the Nano as a host until that gate passes, so that a hosted backend cannot skip the electrical work.
44. As a single-operator product, I want no accounts table and no tenants, so that “user” does not leak into the public model.
45. As the operator, I want Caddy (or equivalent) on the VM to terminate TLS, so that the Rust service can stay HTTP/1 as it is today.
46. As the operator, I want WebSocket idle long enough for the specified 20 s heartbeat / 90 s proxy floor, so that the bridge does not drop while idle.
47. As the operator, I want a cold VM reboot to bring SQLite, replica, Caddy, and the service back via systemd, so that I do not SSH in after every GCP maintenance.
48. As the operator, I want attachment GET to stream from the object store, so that the e2-micro does not need the whole 512 MiB in memory.
49. As the operator, I want Litestream (or equivalent) outside the Rust process, so that replication cannot corrupt in-process WAL locking.
50. As the operator, I want native file BLOBs to stay in SQLite until they hurt, so that the first hosted cutover does not rewrite evidence storage.

## Implementation Decisions

### Shape

- There is still **one** canonical backend: the existing Rust service. Hosting is a new launch mode of that service, not a second backend, not PostgREST, not Supabase.
- `LaunchMode::Hosted` (name may vary) binds a public address, serves the built UI, allows Host/Origin `studio.tan.coffee`, and does **not** inject a LAN token into HTML.
- Desktop and current Headless/LAN modes stay. They are not canonical after cutover.
- The hosted process does **not** own the Nano USB port. The in-process device manager stays idle. The Nano is reached only through the bridge session.
- UI, `/api/v1`, claim creation, bootstrap, and `wss://studio.tan.coffee/device/v1/session` are one process behind one certificate.

### Operator session (ADR 0002)

- Sign in with Google (OpenID Connect authorization code). One allowlisted email in config.
- Session is an HttpOnly, Secure, SameSite cookie. No password database. No user table.
- Logout clears the cookie.
- `/api/v1` on hosted requires this session (or, for non-browser clients later, a separate operator credential — **out of scope** for the first cut).
- Desktop keeps the per-launch bearer token. Headless LAN keeps the LAN token until that topology is retired.
- Middleware remains the auth seam: Host check on the whole router; API auth on `/api/v1`; device bootstrap/session use the bridge key, not the operator cookie.
- Google client ID/secret live in environment / secret manager, not in the binary.

### Device session (`docs/10`)

- Follow the written protocol: one-time claim (operator session required), `POST /device/v1/bootstrap` (device signed), WebSocket subprotocol `tan-bridge.v1.protobuf`, challenge/response with the device P-256 key.
- Operator-facing claim creation is under `/api/v1` so it uses the operator session. Device-facing bootstrap and session stay under `/device/v1` as specified, with **no** operator cookie required or accepted as proof.
- Replace the constant `bridge.tanstudio.xroma.dev` with `studio.tan.coffee`. Firmware and setup UI pin that hostname. No user-entered backend URL.
- Wi-Fi password never hits the backend.
- The existing hardware-free `tan_bridge` contract simulator is the typed starting point for capabilities and spool; the live transport is new. Do not implement a second HTTP “bridge API” as the production path.
- Production firmware must grow Wi-Fi, TLS, the protobuf session, and outbound connect. The current image is receive-only USB and must keep its hardware gate.
- Capability-gated Nano writes stay gated. Hosting does not enable unverified device mutations.

### Notebook storage (ADR 0003)

- SQLite remains the notebook (rusqlite, WAL, existing migrations). No Postgres rewrite.
- Attachment **bytes** go through a content-addressed object-store port (key = SHA-256). Local disk remains the adapter for desktop/dev. Hosted uses GCS (S3-compatible HMAC) in the same project.
- Attachment **metadata** stays in SQLite.
- Native KLOG/KPRO evidence stays in SQLite BLOBs for this effort.
- Continuous SQLite replica to the same bucket via Litestream (or equivalent) as a **sidecar**, not in-process.
- Restore is a documented, scripted procedure: stop service, restore DB from replica, confirm attachments in the bucket, start service.

### Infrastructure (ADR 0003)

- GCP `us-west1` (zone `us-west1-a`), one always-free e2-micro, 30 GB standard disk cap respected, GCS bucket, public HTTPS. Always-free e2-micro is also valid in `us-central1` and `us-east1`; Oregon was picked because it is closer to the operator.
- OpenTofu in-repo provisions: VM, disk, VPC firewall (80/443; SSH via IAP or locked key), bucket, service account, DNS for `studio.tan.coffee`.
- Caddy on the VM: Let’s Encrypt, HTTP→HTTPS, WebSocket upgrade for `/device/v1/session`, idle ≥ 90 s, no response buffering on that route.
- systemd: `tan-studio-service`, Caddy, Litestream. Reboot-safe.
- Apex `tan.coffee` is not created as an app route here. DNS for the apex may exist later for the public site.
- Budget alerts on the billing account. Free egress is 1 GB/month; overage is acceptable but visible.
- No Pulumi. No multi-cloud modules. Weekend migrate = new primitives + restore replica + bucket + DNS.

### Cutover

- One copy of the current notebook SQLite plus local attachment objects onto the host / bucket.
- After a verified hosted `/healthz` and a logged-in read of roast history, LAN/desktop stop being canonical.
- Do not run two writers.

### Public notebook contract

- `/api/v1` resources do not grow user/tenant fields.
- OpenAPI regenerates if auth/error documents change; do not invent parallel clients.

## Testing Decisions

Good tests assert **observable HTTP and protocol behaviour**: status codes, cookies, Host rejection, object bytes round-trip, WebSocket handshake success/failure, claim consume-once. They do not assert GCS SDK internals, Caddy config string equality, or Google’s token-endpoint wiring beyond a fake OIDC.

### Seams (prefer existing; add as few as possible)

1. **HTTP security middleware** (already on the router). Operator session, LAN/desktop bearer, Host/Origin, and “no token in HTML” are tested here. Highest seam for login and hardening.
2. **Content-addressed object store port** behind attachment upload/download. Local adapter in tests; GCS adapter is a thin S3 PUT/GET. Do not leak paths into `core_api` beyond the port.
3. **Bridge session transport** as specified in `docs/10`: bootstrap + WebSocket envelopes. Drive it with a fake device client in-process. Do not require hardware. Reuse the hardware-free contract types already in the service.
4. **Launch config**. Hosted vs desktop vs headless are config, not a second crate.

Firmware keeps its existing host-test seam (no Nano in CI). OpenTofu is validated with `tofu plan` / format, not by booting GCP from CI.

### Prior art

- Service unit tests around config tokens, Host/API security, attachments, and `tan_bridge` types.
- Headless HTML bootstrap tests (must invert: hosted HTML must **not** contain the session secret).
- Firmware host-tests and USB-role probe procedure remain the hardware evidence path.

### CI constraints

- No real Google login, no real GCS, no paid network. Fake OIDC issuer and a local/in-memory object store.
- Restore drill and live provision are manual/scripted, not CI.

## Out of Scope

- Public landing page on `tan.coffee`
- Multi-operator accounts, passwords, passkeys, Supabase Auth
- Postgres / Cloud SQL / Supabase as the notebook store
- Live multi-cloud or Pulumi
- Kaffelogic official Wireless Connect Module and TCP 9056
- A home device agent or keeping the LAN appliance as production
- MCP/CLI hosted credentials (same API later; not this effort’s done definition)
- Enabling unverified Nano writes, firmware update, format, or delete
- Skipping the USB-role probe hardware gate
- Horizontal scale, multiple service replicas, LiteFS
- Moving native file BLOBs out of SQLite
- Desktop Tauri becoming a USB client of the host (Tan Bridge is the USB path)
- Custom email, billing, or a public roast-sharing site

## Further Notes

- Always-free e2-micro is US-only (`us-west1`, `us-central1`, `us-east1`); the operator picked Oregon (`us-west1-a`) because it is closer.
- e2-micro is 1 GB RAM; the service + Caddy + Litestream must fit. Stream attachments; do not buffer 512 MiB.
- Definition of done for **this** effort includes the bridge path, not only a logged-in browser. Firmware today cannot open the session; backend today has no WSS handler. Both are in scope.
- `docs/03` listed “cloud dependence” as a non-goal; ADR 0001 supersedes that for the canonical backend.
- Human steps (GCP billing account, OAuth client, domain at the registrar, first `tofu apply`, USB-role probe on real hardware) are `ready-for-human` tickets, not agent-guessable.
