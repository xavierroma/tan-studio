# Tan Bridge native provisioning and device protocol

Status: proposed canonical product specification, 21 July 2026

This document defines the behavior of the Tan Bridge as a Tan Studio product.
It supersedes the earlier LAN-pull bridge API and pairing design in
[`06-wireless-bridge-and-agent-interface.md`](06-wireless-bridge-and-agent-interface.md)
and sections 4.4-4.5 of
[`08-atoms3-lite-implementation-handoff.md`](08-atoms3-lite-implementation-handoff.md).
The offline-safe firmware and hardware evidence in those documents remains
valid.

The production backend authority is:

```text
bridge.tanstudio.xroma.dev
```

The hostname initially resolves through a reverse proxy to a backend hosted at
home. It may later resolve to hosted infrastructure without changing bridge
configuration or requiring users to provision devices again.

Normative terms such as **must**, **must not**, **should**, and **may** describe
product requirements. Numeric bounds are part of the protocol unless explicitly
marked provisional.

## 1. Product decision

The bridge is a stateful USB-to-network appliance, not a remote serial cable.
It:

- is provisioned from the Tan Studio HTTPS frontend over USB Web Serial;
- joins the configured 2.4 GHz Wi-Fi network;
- initiates an authenticated outbound connection to the fixed backend domain;
- owns the local Nano USB/SASSI session and its timing-sensitive ACK behavior;
- exposes typed Nano capabilities and operations to the backend;
- buffers ordered observations and operation results during network outages;
- supports verified reads and writes through explicit operations; and
- leaves the Tan Studio backend as the canonical owner of application data.

The first usable bridge does not require the backend and bridge to share a LAN.
No inbound port, router configuration, public Atom endpoint, or user-entered
backend URL is required.

## 2. Explicit non-goals

The native product does not:

- emulate or advertise another vendor's wireless module;
- expose TCP port 9056;
- expose raw USB, raw serial, or arbitrary SASSI frames;
- let a caller supply a numerical SASSI message or action code;
- accept an arbitrary production backend URL from the setup UI;
- host the Tan Studio database or product business logic;
- silently overwrite, delete, format, restart, stop, or update a Nano; or
- report a write as complete before its postcondition is reconciled.

Protocol research about the Nano remains an implementation input, but it is not
part of the bridge's public contract.

## 3. System topology and trust boundaries

```text
Tan Studio HTTPS frontend
    | explicit Web Serial permission; setup only
    v
AtomS3 Lite Tan Bridge
    | USB CDC + local SASSI actor
    v
Kaffelogic Nano

AtomS3 Lite Tan Bridge
    | outbound TLS + WebSocket; device authenticated
    v
bridge.tanstudio.xroma.dev
    | application services
    v
Tan Studio database, web UI, CLI, and MCP
```

Trust boundaries:

1. The browser origin is authenticated by normal HTTPS. Browser permission and
   physical USB selection authorize one provisioning session.
2. The bridge authenticates `bridge.tanstudio.xroma.dev` with normal TLS
   hostname and certificate-chain validation.
3. The backend authenticates the bridge with a per-device signing key and a
   signed session challenge.
4. The bridge validates the attached Nano identity and negotiated SASSI limits
   locally before exposing device capabilities.
5. Every backend operation is authorized by a typed capability and, when
   required, a short-lived human-confirmation grant.

DNS routes traffic but is not a trust anchor. TLS hostname validation remains
required even when the hostname resolves to a private or home address.

## 4. Stable identifiers and persisted state

### 4.1 Identifiers

| Identifier | Lifetime | Definition |
| --- | --- | --- |
| `bridgeId` | factory reset | Random 128-bit value encoded as lowercase unpadded base32. |
| `bootId` | one boot | Random 128-bit value. |
| `sessionId` | one accepted backend connection | Backend-assigned random 128-bit value. |
| `messageId` | one sent envelope | Random 128-bit value. |
| `requestId` | one logical backend request | Backend-assigned random 128-bit value; stable across retries. |
| `cursor` | bridge lifetime | Strictly increasing unsigned 64-bit durable-event position. |
| `nanoId` | one physical Nano paired with a bridge | Stable pseudonymous digest derived locally from verified Nano identity. |

Raw Nano serial numbers must not appear in discovery, routine status, event
logs, or diagnostics. The bridge retains the raw value only where the local
SASSI protocol requires it.

### 4.2 Persisted configuration

The bridge persists:

- `bridgeId` and its private signing key;
- Wi-Fi SSID bytes and credential;
- claim generation and claimed backend identity;
- the fixed production backend hostname and backend-issued session policy;
- the highest backend-acknowledged durable cursor;
- bounded idempotency receipts;
- spool metadata; and
- firmware/update recovery state.

Wi-Fi credentials, private keys, claim tokens, raw Nano identifiers, and file
contents must never enter routine logs or status responses. A claim token is
erased immediately after successful redemption or expiry.

Development builds may initially use ordinary NVS. Production hardening must
add encrypted NVS only after recovery and key rotation are proven.

## 5. Cooperating state machines

One aggregate enum cannot represent independent USB, Wi-Fi, backend, and spool
changes without invalid combinations. Firmware uses cooperating actors with
bounded queues.

### 5.1 Lifecycle

```text
booting
  -> unprovisioned
  -> provisioning
  -> claiming
  -> operational
  -> recovery
```

- A bridge with no valid Wi-Fi and claim configuration enters `unprovisioned`.
- A button-held boot may enter `provisioning` even when configuration exists.
- An ordinary Wi-Fi or backend outage must not reopen provisioning.
- `recovery` exposes only signed firmware recovery, redacted diagnostics, and
  factory reset requiring physical interaction.

### 5.2 Wi-Fi

```text
disabled -> scanning -> associating -> obtainingAddress -> online -> backoff
```

Wi-Fi retries continue independently of Nano observation. Backoff starts near
one second, doubles to at most 60 seconds, and applies plus or minus 20 percent
jitter. A credential rejection is distinguished from transient loss.

### 5.3 Backend

```text
offline -> resolving -> connecting -> authenticating -> synchronizing -> online
                                                        \-> backoff
```

Only one backend session may be authoritative. An accepted replacement session
closes the older session.

### 5.4 Nano

```text
detached -> enumerated -> negotiating -> ready -> busy
                              \-> recovering -> faulted
```

The Nano actor owns all SASSI frames and deadlines. It permits only one
response-bearing SASSI request at a time. Incoming live-log notifications and
their required local acknowledgements take priority over backend operations.

### 5.5 Spool

```text
empty -> pending -> nearCapacity -> retentionGap
```

Command results and mutation receipts have higher retention priority than
telemetry. If capacity pressure forces telemetry loss, the bridge commits one
durable `retention.gap` event describing the lost cursor interval. It never
fills a gap with invented samples.

## 6. Browser provisioning over Web Serial

### 6.1 Browser requirements

Provisioning is initiated by an explicit user action from an authorized Tan
Studio HTTPS page. The page calls `navigator.serial.requestPort()` and filters
for reviewed Tan Bridge USB identifiers where the browser supports filters.
The user must select the port in the browser chooser.

Only one process may own the CDC interface. Tan Studio desktop, serial readers,
and firmware tools must close it before the browser opens it.

The frontend opens the port as 115,200 baud, eight data bits, no parity, one
stop bit, no flow control, with DTR asserted. Native USB CDC may ignore the
nominal bit rate, but fixing the settings keeps browser, firmware, and recovery
behavior deterministic.

Web Serial is the primary v1 setup path. A native desktop or protected SoftAP
flow may be added as a fallback without changing the claim or cloud session
protocol.

### 6.2 Setup transport

The provisioning transport is UTF-8 JSON Lines over USB CDC:

- one JSON object per LF-terminated line;
- maximum encoded line length: 4,096 bytes including LF;
- maximum eight in-flight browser requests;
- malformed, oversized, duplicated, or unknown requests receive a typed error;
- unknown object properties are rejected; and
- passwords and claim tokens are never returned in responses.

Every request has:

```json
{
  "schemaVersion": 1,
  "requestId": "018fb4c2-7d4e-7a92-9f4b-0d7ce3af9891",
  "type": "setup.getStatus",
  "payload": {}
}
```

Every response has the same `requestId` and exactly one of `result` or `error`.
The schema is a discriminated union keyed by `type`; `payload` is never an
untyped arbitrary object in generated code.

### 6.3 Setup operations

| Type | Request | Result |
| --- | --- | --- |
| `setup.getStatus` | empty | identity, firmware, lifecycle, Wi-Fi and claim states; no secrets |
| `setup.scanWifi` | empty | bounded visible 2.4 GHz network list |
| `setup.configure` | selected network, credential, one-time claim token | configuration generation |
| `setup.watch` | last observed progress sequence and timeout up to 30 seconds | next bounded progress batch or unchanged timeout |
| `setup.resetNetwork` | explicit confirmation value | clears Wi-Fi configuration only |
| `setup.factoryReset` | physical-button proof plus explicit confirmation | schedules complete reset and reboot |

Each scanned network contains an opaque scan-lifetime `networkId`, sanitized
display SSID, authentication mode, channel, and RSSI. `setup.configure` uses
the opaque `networkId` so a non-UTF-8 SSID is not rewritten by the browser. A
separate hidden-network form carries bounded base64 SSID bytes.

`setup.configure` is atomic from the browser's perspective. Firmware first
stores a pending generation, attempts association, obtains an address, redeems
the claim, and then promotes it to active. Failure retains the prior active
generation if one exists.

`setup.watch` is bounded long polling, not an uncorrelated serial event stream.
Each progress item has an increasing setup-session sequence and one typed state:
`associating`, `obtainingAddress`, `bootstrapping`, `authenticating`, `ready`, or
`failed`. The browser repeats the request after a result or timeout.

### 6.4 End-to-end setup sequence

1. The signed-in frontend creates a one-time claim at the backend.
2. The user clicks **Set up Tan Bridge** and selects the Atom.
3. The frontend requests `setup.getStatus` and `setup.scanWifi`.
4. The user selects a network and supplies its credential.
5. The bridge generates its `bridgeId` and signing key locally if absent.
6. The frontend sends the Wi-Fi selection and one-time claim token directly to
   the bridge with `setup.configure`.
7. While still powered by the computer, the bridge joins Wi-Fi and contacts
   the backend.
8. The backend binds the claim to the bridge public key and user/account.
9. `setup.watch` reports `ready` only after the authenticated backend session
   is accepted.
10. The UI instructs the user to move the bridge to the Nano.

The Wi-Fi credential never passes through the Tan Studio backend. The frontend
may discard it as soon as the serial write completes.

## 7. Claim and bootstrap protocol

The backend exposes these HTTPS resources:

```text
POST /v1/claims
POST /device/v1/bootstrap
```

`POST /v1/claims` requires an authenticated Tan Studio user. It returns an
opaque 256-bit claim token with a ten-minute lifetime and one successful use.

`POST /device/v1/bootstrap` accepts:

- claim token;
- `bridgeId`;
- bridge P-256 public signing key;
- firmware/build identity;
- protocol version range; and
- a signature over the claim-token digest, `bridgeId`, public key, build
  identity, and protocol range.

The backend verifies the signature with the submitted public key and consumes
the claim token transactionally. It returns:

- claim generation;
- account/device assignment;
- accepted protocol range;
- session URL;
- backend time;
- minimum supported firmware; and
- backend session policy.

The private key never leaves the bridge. Retrying an already consumed bootstrap
with the same `bridgeId`, public key, and claim generation returns the same
assignment. A token replay with different identity material is rejected.

## 8. Backend session transport

### 8.1 Connection

The bridge initiates:

```text
wss://bridge.tanstudio.xroma.dev/device/v1/session
```

The required WebSocket subprotocol is:

```text
tan-bridge.v1.protobuf
```

The reverse proxy must support WebSocket upgrades, disable response buffering
for this route, and permit an idle interval of at least 90 seconds. The bridge
sends a heartbeat at least every 20 seconds; either side treats 60 seconds
without valid traffic as disconnected.

TLS must validate the public hostname and certificate chain. Disabling hostname
verification, accepting arbitrary certificates, or using plain WebSocket is
forbidden outside a deliberately isolated test build.

### 8.2 Authentication handshake

1. Bridge sends an untrusted `ClientPrelude` containing `bridgeId`, `bootId`,
   supported protocol range, and a random client nonce.
2. Backend replies with `ServerChallenge` containing a random 256-bit nonce,
   backend time, accepted protocol version, and session policy digest.
3. Bridge sends `ClientAuthentication`, signing the full handshake transcript
   and TLS server-name context with its device key.
4. Backend verifies the registered public key and claim generation.
5. Backend sends `SessionAccepted` with `sessionId`, the highest durable cursor
   already stored, authorized capabilities, heartbeat interval, and limits.
6. Bridge replays durable events after that cursor, sends its current snapshot,
   and enters `online` after replay acknowledgement.

No long-lived bearer token is sufficient to authenticate a production bridge.
The signing key proves every new session.

### 8.3 Framing and limits

- Each WebSocket binary message contains exactly one Protobuf `Envelope`.
- Maximum encoded envelope size is 65,536 bytes.
- File data is carried as native Protobuf `bytes`, not Base64.
- Maximum file chunk payload is 32,768 bytes.
- Control messages must not exceed 16,384 bytes.
- Receivers reject an envelope before allocating from an untrusted declared
  length that exceeds the negotiated limit.
- Protobuf definitions generate concrete C, Rust, and TypeScript unions. No
  generic map or unconstrained JSON payload appears in the wire contract.

## 9. Common envelope

The authoritative `.proto` file must model this logical structure:

```text
Envelope
  protocolVersion: uint32
  messageId: 16 bytes
  correlationId: optional 16 bytes
  bridgeId: 16 bytes
  bootId: 16 bytes
  monotonicMs: uint64
  body: oneof
    clientPrelude
    serverChallenge
    clientAuthentication
    sessionAccepted
    bridgeSnapshot
    durableEvent
    eventAcknowledgement
    operationRequest
    operationProgress
    operationResult
    fileTransfer
    heartbeat
    protocolError
```

Unknown `oneof` variants are unsupported, not ignored as successful. Additive
fields in a recognized variant follow normal Protobuf compatibility rules.

Wall time is optional on the bridge. `monotonicMs` is always present and resets
with `bootId`. The backend records receipt time and supplies trusted wall time
after authentication.

## 10. Snapshots and capabilities

`BridgeSnapshot` contains:

- bridge/build identity;
- lifecycle, Wi-Fi, backend, Nano, and spool states;
- uptime, reset reason, heap high-water mark, and flash usage;
- pseudonymous `nanoId`, model, firmware, protocol, packet limits and busy state;
- durable cursor bounds and acknowledged cursor; and
- explicitly enabled operation capabilities.

Capabilities are concrete enum values:

```text
DEVICE_READ
FILES_LIST
FILES_READ
FILES_WRITE
FILES_DELETE
PROFILES_ACTIVATE
ROAST_OBSERVE
ROAST_EVENTS_WRITE
ROAST_STOP
PREFERENCES_WRITE
FIRMWARE_INSTALL
DEVICE_RESTART
```

An operation is allowed only when the backend grant, bridge firmware, observed
Nano model/firmware, and current Nano state all enable its capability. Absence
means denial.

## 11. Native operations

The backend never asks the bridge to send an arbitrary SASSI type or action.
`OperationRequest` is a generated discriminated union with the operations below.

### 11.1 Read operations

| Operation | Required capability | Result |
| --- | --- | --- |
| `GetDeviceSnapshot` | `DEVICE_READ` | current normalized snapshot |
| `GetDeviceInformation` | `DEVICE_READ` | typed system, filesystem, technical or operational data |
| `ListFiles` | `FILES_LIST` | cursor-paginated bounded manifest |
| `ReadFile` | `FILES_READ` | metadata followed by checksummed chunks |
| `Synchronize` | `FILES_LIST`, `FILES_READ` | idempotent manifest and changed-file reconciliation |

Allowed remote roots are enumerated by firmware. Paths are normalized relative
paths, at most the negotiated Nano filename limit, with no empty segment, `.`,
`..`, NUL, leading slash, backslash, or control character.

### 11.2 File mutation

| Operation | Required capability | Postcondition |
| --- | --- | --- |
| `WriteFile` | `FILES_WRITE` | exact path contains exact expected SHA-256 and modification evidence |
| `DeleteFile` | `FILES_DELETE` | exact preconditioned file no longer exists |

`WriteFile` is a staged transaction:

1. Backend sends metadata: destination, length, SHA-256, modification evidence,
   idempotency key, and `mustNotExist` or `expectedCurrentSha256` precondition.
2. Bridge reserves bounded staging space or rejects before touching the Nano.
3. Backend sends ordered chunks; bridge commits each staging record and verifies
   the complete SHA-256.
4. Bridge rechecks the destination precondition.
5. Bridge performs the local SASSI write and consumes local ACKs.
6. Bridge lists and reads the result back when the Nano supports it.
7. Success is reported only after path, size, content hash, and modification
   evidence satisfy the postcondition.

If the object exceeds safe staging capacity, the bridge returns
`RESOURCE_EXHAUSTED`; it does not start a partially verifiable write. Firmware
updates use their dedicated OTA/staging partition rather than the event spool.

`DeleteFile` requires an expected current hash except when replaying an already
completed command. Directory deletion, recursive deletion, wildcard paths, and
filesystem formatting are not `DeleteFile` variants.

### 11.3 Device operations

| Operation | Required capability | Additional requirement |
| --- | --- | --- |
| `ActivateProfile` | `PROFILES_ACTIVATE` | exact profile hash already verified on Nano |
| `RecordRoastEvent` | `ROAST_EVENTS_WRITE` | active roast and typed event |
| `StopRoast` | `ROAST_STOP` | short-lived human-confirmation grant |
| `SetPreference` | `PREFERENCES_WRITE` | named, model/version-gated preference schema |
| `InstallFirmware` | `FIRMWARE_INSTALL` | official compatible image, verified hash, confirmation grant |
| `RestartNano` | `DEVICE_RESTART` | named safe restart reason and confirmation grant |

Licensed-feature mutation, calibration, rescue, bootloader entry, formatting,
and arbitrary preference keys are absent until separately specified. A new
operation variant and capability are required; a generic escape hatch is never
added.

## 12. Operation execution semantics

Every operation request contains:

- `requestId` and idempotency key;
- target `bridgeId` and `nanoId`;
- required capability;
- creation and expiry time from the backend;
- expected device/config generation;
- typed precondition; and
- operation-specific input.

The Nano actor queue holds at most eight backend operations. Excess work is
rejected with `BUSY`; it is not accepted into unbounded memory.

Execution is at-least-once transport with idempotent application semantics:

- replaying a completed idempotency key returns the stored result;
- replaying an in-progress key returns current progress;
- a key reused with different input returns `CONFLICT`;
- a power loss after an irreversible local action but before durable result
  commit returns `OUTCOME_UNKNOWN` until reconciliation establishes a result;
- the backend must not retry an `OUTCOME_UNKNOWN` mutation under a new key.

The bridge retains a bounded durable ledger of recent mutation keys and results.
Eviction never turns a known uncertain mutation into permission to repeat it.

Filesystem mutation is rejected while the Nano reports its filesystem locked.
During an active roast, only observation, live event recording, and explicitly
confirmed roast stop operations may bypass the ordinary file-work queue.

## 13. Live processing and log synchronization

Live roast observation and historical file synchronization share the Nano's
native KLOG representation but have different lifecycles:

- live observation delivers provisional KLOG bytes with low latency while a
  roast is running; and
- synchronization fetches complete immutable files and makes them canonical.

The bridge does not implement a second semantic KLOG parser. It validates and
decodes bounded SASSI file-notification chunks, durably forwards the original
KLOG bytes, and leaves metadata/header/row parsing to the canonical Rust
backend. Unknown future channels therefore survive the bridge unchanged.

### 13.1 End-to-end live dataflow

```text
Nano type-32 file notification
  -> bridge validates SASSI sequence/CRC and decodes Base64
  -> bridge commits native KLOG bytes to its bounded spool
  -> bridge sends the Nano's required local ACK
  -> bridge sends durable live-log events over the backend session
  -> backend commits provisional bytes and acknowledges bridge cursor
  -> backend incremental KLOG parser buffers partial lines
  -> backend emits typed sample batches to the Tan Studio UI
  -> final Nano KLOG is fetched, hashed, imported, and reconciled
```

The bridge must never delay the Nano's local chunk acknowledgement while
waiting for DNS, Wi-Fi, TLS, the reverse proxy, the backend, or a browser. It
acknowledges only after the decoded bytes are accepted into a bounded durable
record or an explicit retention failure has been recorded.

The bridge may coalesce adjacent decoded chunks for network efficiency, but a
coalesced live batch is bounded by 32,768 bytes and 250 milliseconds. It
preserves byte order, source offsets, and notification boundaries.

### 13.2 Live-session lifecycle

The bridge and backend refer to one observed roast with a random 128-bit
`liveSessionId` generated when the first valid KLOG notification arrives.

```text
idle
  -> candidateBusy
  -> streaming
  -> temporarilyDisconnected
  -> awaitingFinalLog
  -> reconciling
  -> complete
              \-> incomplete
```

- Nano busy status creates `candidateBusy`; it does not by itself prove a roast.
- The first recognized incremental KLOG bytes create `streaming` and a durable
  `roast.streamStarted` event.
- Loss of Wi-Fi/backend changes only delivery state. The bridge continues local
  Nano observation and spooling.
- Loss of the Nano changes the session to `temporarilyDisconnected` and records
  the exact last native byte offset and durable cursor.
- Nano not-busy status after a live stream moves the session to
  `awaitingFinalLog` and schedules synchronization as soon as the filesystem is
  unlocked.
- `complete` means the final full KLOG has been fetched, verified, imported, and
  linked to the live session.
- `incomplete` is explicit when a final file cannot yet be found or a retention
  gap cannot be repaired. Future synchronization may still complete it.

A type-32 final bit closes one SASSI notification fragment, not the roast or the
live session. Only device state plus final-file reconciliation may complete the
session.

### 13.3 Live wire messages

Live messages are typed durable-event bodies:

| Event | Required fields | Meaning |
| --- | --- | --- |
| `roast.streamStarted` | `liveSessionId`, `nanoId`, first cursor, optional device path | first valid native KLOG bytes observed |
| `roast.logChunk` | `liveSessionId`, `byteOffset`, raw bytes, chunk SHA-256, source notification sequence/final flag | ordered native KLOG content |
| `roast.streamState` | `liveSessionId`, state, last byte offset, optional reason | connection/finalization transition |
| `roast.finalLogAvailable` | `liveSessionId`, device path, size, modification evidence, SHA-256 | verified complete log ready for import |

`byteOffset` starts at zero and is contiguous within a `liveSessionId`. A replay
of the same offset and identical bytes is idempotent. Different bytes at an
already committed offset are `INTEGRITY_FAILED`, never last-write-wins.

The source notification sequence is diagnostic only because Nano notification
sequences may restart at one for later fragments. Backend byte offsets and
durable cursors are the cross-reconnect ordering authorities.

### 13.4 Backend live processing

For each live session, the Rust backend owns:

- an append-only provisional native-byte journal keyed by `liveSessionId` and
  byte offset;
- an incremental KLOG parser with explicit metadata, header, row, incidentals,
  and partial-line states;
- typed sample batches for the existing application event/WebSocket layer;
- association with the active planned roast, if one exists; and
- reconciliation status and diagnostics.

The parser buffers an incomplete trailing line until later bytes arrive. It
does not coerce a malformed line into a sample, discard unknown channels, or
duplicate a previously committed byte range. The UI receives only complete
typed samples, while the provisional native bytes remain available for replay
and final comparison.

The target is for a complete row received by the backend to reach its connected
UI within 500 milliseconds under normal LAN/internet conditions. This latency
target never takes priority over local Nano ACK deadlines or durable ordering.

### 13.5 Manifest and historical-file synchronization

The bridge synchronizes the allowed profile and roast-log roots:

```text
kaffelogic/roast-profiles
kaffelogic/roast-logs
```

Synchronization is scheduled:

- after Nano negotiation reaches ready and its filesystem is unlocked;
- after an authenticated backend session is established;
- after a busy-to-not-busy transition;
- after a file-updated notification;
- after finalizing a live session; and
- on an explicit idempotent `Synchronize` request.

The bridge first produces a bounded manifest. Each entry contains device path,
kind, byte length, modification evidence, and content-hash state. Content
SHA-256 may be `unknown` until the file has been read; it becomes authoritative
only after a complete transfer.

The backend compares manifest entries with its immutable native-file store and
requests every missing or changed profile/log. An unchanged path, size, and
modification value may avoid a read only when prior content at that exact
evidence has already been verified. Path alone is never identity.

### 13.6 Full-file fetch protocol

A `ReadFile` operation produces:

```text
FileReadStarted
  requestId, devicePath, expectedLength, preReadModificationEvidence

FileReadChunk(s)
  requestId, byteOffset, raw bytes, chunkSha256

FileReadCompleted
  requestId, totalBytes, contentSha256, postReadModificationEvidence
```

Rules:

1. The bridge streams SASSI file chunks through bounded buffers; it does not
   allocate or retain a complete log in RAM.
2. `byteOffset` is contiguous from zero. Duplicate identical chunks are safe;
   overlap with different bytes fails integrity validation.
3. The backend writes chunks to a temporary content-addressed object and does
   not import or expose a canonical file until length and SHA-256 verify.
4. The bridge rechecks modification evidence after the read. A changed file is
   `CONFLICT` and is fetched again after it stabilizes.
5. If a connection drops, a verified bridge flash cache may resume at a chunk
   boundary. Otherwise the bridge restarts the Nano read at zero and the
   backend deduplicates the already verified prefix.
6. Completed KLOG/KPRO imports are transactional. A malformed file is retained
   in quarantine with diagnostics rather than partially projected.
7. Background manifests and full-file reads pause while the Nano filesystem is
   busy. Live notifications and their ACKs continue.

Synchronization continues page by page until every eligible profile and log is
either verified, unchanged by verified evidence, quarantined, or reported with
a typed error. A successful synchronization receipt includes counts for each
outcome and the manifest generation it covered.

### 13.7 Final-log reconciliation

After a live session leaves `streaming`:

1. the bridge waits for the Nano filesystem to unlock;
2. it refreshes the roast-log manifest;
3. the backend matches a candidate using the native `log_file_name` observed in
   the provisional stream; ambiguous fallback matches are not guessed;
4. the backend requests and verifies the complete KLOG;
5. the ordinary KLOG importer transactionally creates or updates the canonical
   roast and sample stream;
6. the importer links the canonical file and roast to `liveSessionId` and any
   active planned roast;
7. provisional rows are compared with the final native rows and then replaced
   by the final authoritative projection; and
8. the bridge/backend emit `roast.finalLogAvailable` followed by the canonical
   application-level roast completion event.

If provisional and final data diverge, the final verified KLOG is authoritative
but the divergence and affected offsets/sample range remain visible in
diagnostics. The backend does not create a second roast for the same final log,
discard a planned-roast association, or silently conceal a missing live range.

If the final file is not yet present, the backend retains the provisional
session and retries on later synchronization. An interrupted roast may remain
`incomplete` with its received bytes and samples intact.

### 13.8 Scheduling and backpressure priority

The Nano actor services work in this priority order:

1. inbound SASSI parsing and required live-notification ACKs;
2. device status and disconnect handling;
3. active-roast event recording or explicitly confirmed stop;
4. durable spooling and replay of live bytes;
5. final-log synchronization;
6. ordinary manifest/file reads; and
7. non-roast file mutations.

Slow backend delivery must increase spool usage rather than block Nano reads.
If the spool crosses its retention floor, the bridge emits exact lost cursor
and live-byte ranges. A later final KLOG fetch is the preferred repair path.

## 14. Events, replay, and recovery

Durable event variants are:

```text
bridge.status
nano.status
roast.streamStarted
roast.logChunk
roast.streamState
roast.event
roast.finalLogAvailable
file.changed
operation.progress
operation.completed
retention.gap
bridge.fault
firmware.progress
```

Every durable event contains `cursor`, `bootId`, boot-relative monotonic time,
type, and a typed body. Cursors are assigned only after the spool record is
committed.

The backend acknowledges the highest contiguous durable cursor stored in its
canonical database. The bridge may reclaim records at or below that cursor
subject to its retention floor. An ACK above the highest sent cursor or across
an unreported gap is a protocol error.

After reconnect:

1. backend supplies its highest durable cursor;
2. bridge replays later committed records in order;
3. if the requested cursor predates the retention floor, bridge first sends a
   `retention.gap` with exact lost bounds;
4. bridge sends a fresh snapshot;
5. backend reconciles final Nano files, which may repair live-telemetry gaps
   without inventing observations.

Heartbeats and transient signal-strength changes need not be durable.

## 15. Error contract

Errors use a closed code enum:

```text
INVALID_ARGUMENT
UNAUTHENTICATED
UNAUTHORIZED
UNSUPPORTED
NOT_FOUND
CONFLICT
BUSY
DEADLINE_EXCEEDED
RESOURCE_EXHAUSTED
INTEGRITY_FAILED
NANO_DISCONNECTED
NANO_PROTOCOL_ERROR
RETENTION_GAP
OUTCOME_UNKNOWN
INTERNAL
```

An error includes `code`, `retryable`, optional `retryAfterMs`, and typed
operation-specific details. Human-readable text is diagnostic only and must not
be parsed. Raw Nano frames, credentials, file contents, and serials are excluded.

## 16. Versioning

- Web Serial setup has independent `schemaVersion: 1`.
- Cloud protocol major version is selected by the WebSocket subprotocol and
  repeated in every envelope.
- Minor evolution is additive within existing Protobuf messages.
- Removing or changing field meaning requires a new major version.
- Operation capabilities are negotiated, never inferred from protocol version.
- Backend may advertise a minimum firmware but must allow recovery/bootstrap
  paths for an outdated device.
- Firmware must keep the last known compatible backend assignment across DNS
  and infrastructure changes.

## 17. LED and physical interaction

The LED is normally off. The central indicator derives one signal using this
priority:

| Priority | Signal | Meaning |
| ---: | --- | --- |
| 1 | repeating red | recovery or persistent fault |
| 2 | slow amber | unacknowledged recovery data or uncertain operation |
| 3 | blue pulse | provisioning, Wi-Fi association, or backend authentication |
| 4 | green pulse | first transition to authenticated online state |
| 5 | off | healthy idle or ordinary operation |

A brief network retry does not continuously illuminate the LED. Physical-button
flows must distinguish provisioning, network reset, and factory reset and must
require a visible confirmation pattern before destructive reset.

## 18. Reverse-proxy deployment requirements

`bridge.tanstudio.xroma.dev` may initially terminate at the home reverse proxy.
The deployment must provide:

- a publicly valid certificate for the exact hostname;
- HTTP/1.1 WebSocket upgrade support on `/device/v1/session`;
- at least 90 seconds of connection idle allowance;
- no buffering or body transformation of binary WebSocket frames;
- a request-body limit compatible with the 65,536-byte envelope maximum;
- forwarding of the original TLS hostname and a trusted client address chain;
- rate limits on bootstrap, authentication failures, and unclaimed devices; and
- durable backend storage before emitting event acknowledgements.

The application must not trust a user-supplied header as bridge identity. Device
identity comes from the signed session handshake.

## 19. Acceptance tests

### 19.1 Provisioning

- From a clean Atom, a supported desktop Chromium browser completes setup from
  an HTTPS Tan Studio page after one explicit port selection.
- The Atom scans Wi-Fi, joins the selected network while still computer-powered,
  redeems a one-time claim, and reaches authenticated `online`.
- Reload, duplicate requests, expired claims, wrong credentials, disconnects,
  and an occupied serial port produce recoverable typed errors.
- Browser, backend, device status, and logs never echo the Wi-Fi password.

### 19.2 Session and recovery

- The bridge connects through the home reverse proxy using only outbound 443.
- DNS target changes do not require reprovisioning.
- Invalid server certificates, wrong hostname, unknown bridge identity, invalid
  signature, revoked claim, and replayed handshake are rejected.
- Network loss, proxy restart, backend restart, DNS failure, and Atom reboot
  resume from the last durable cursor or report an exact retention gap.

### 19.3 Reads and observation

- Snapshot, information, manifest, file read, and synchronization are bounded
  and match direct Nano evidence.
- Live samples remain ordered through fragmentation and reconnect.
- Final KLOG reconciliation either repairs a live gap or preserves it visibly.
- Partial lines, duplicate chunks, replayed offsets, backend restart, Wi-Fi loss,
  Atom reboot, Nano reconnect, spool pressure, and a missing or divergent final
  log produce the specified live-session outcomes.
- A fresh backend can synchronize every eligible historical profile and roast
  log, verify content hashes, and import them without buffering a full file on
  the Atom.

### 19.4 Writes

- A uniquely named test profile can be staged, hashed, written, read back, and
  matched byte-for-byte.
- Replaying the same idempotency key does not write twice.
- Wrong precondition, changed destination, corrupted chunk, full staging area,
  busy Nano, disconnect, timeout, and power loss yield specified results.
- The same test profile can be preconditioned and deleted without affecting any
  other file.
- High-impact operations require the exact capability and confirmation grant.

### 19.5 Resource bounds

- No operation allocates from a device-provided length before checking it.
- Queues, frames, staging, spool, idempotency ledger, and logs have measured
  fixed bounds.
- A 24-hour connection/roast/reconnect soak shows no unbounded heap or task
  growth.

## 20. Implementation sequence

1. Add the normative Protobuf schema and generated C/Rust/TypeScript contract
   checks.
2. Implement the Web Serial setup protocol against a browser mock and firmware
   host tests.
3. Implement backend claim/bootstrap and a simulated bridge session through the
   real reverse proxy route.
4. Extract the Rust `RoasterLink` boundary and implement `TanBridgeRoasterLink`
   against the simulated outbound session.
5. Implement Wi-Fi, DNS, TLS, signed session authentication, heartbeat and
   reconnect on the Atom while it is computer-powered.
6. Add the flash spool adapter and replay it through power-loss tests.
7. Connect the existing verified read-only Nano operations to the native
   operation actor.
8. Implement lossless live KLOG chunk delivery, backend incremental parsing,
   provisional UI samples, outage replay, and final-log reconciliation.
9. Complete manifest-driven historical profile/log synchronization and verify a
   fresh backend can fetch the entire device corpus through bounded chunks.
10. Add staged file write, read-back verification, idempotency and the harmless
   profile write/delete conformance test.
11. Add remaining named capabilities one at a time with fixtures and explicit
   authorization.
12. Harden key storage, recovery, signed OTA, rollback, resource measurements,
    and soak behavior.

The passive Nano hardware validation remains required before claiming a working
one-cable appliance, but it does not block provisioning, backend, simulator,
state-machine, security, contract, or flash-recovery implementation.

## 21. Verified implementation checkpoint: computer-powered setup

The first setup slice was implemented and physically verified on 21 July 2026
with an M5Stack AtomS3 Lite C124 powered by the development Mac. It intentionally
stops before accepting credentials or claiming a backend device.

Implemented artifacts:

- strict TypeScript schemas in `@tan-studio/api-contract` for
  `setup.getStatus` and `setup.scanWifi`;
- a Web Serial client with deterministic 115,200 8N1 settings, DTR assertion,
  response correlation, bounded framing, exclusive port ownership, and cleanup;
- a Tan Studio **Connect Atom** / **Scan Wi-Fi** panel on the Devices screen;
- a separate `firmware/tan-bridge-setup` ESP-IDF development image so this
  computer-facing transmit path does not weaken the receive-only Nano image;
- a persistent random bridge identity in ordinary development NVS;
- strict JSON Lines parsing, 4,096-byte framing, rejection of unknown fields,
  rejection of reused request identifiers, and typed unsupported-operation
  errors; and
- a bounded active 2.4 GHz scan returning no more than 12 sanitized display
  SSIDs with opaque scan-lifetime network identifiers.

Physical evidence for the corrected image:

```text
USB product: Tan Bridge Setup Development
USB manufacturer: Tan Studio
USB serial descriptor: tan-bridge-setup
firmware version/build: 0.1.0-dev / setup-v1
application bytes: 784032
application SHA-256: 229162ddc429865c86895cb4d1e0fbbe904d54998a30bb6e370c515b68654f44
lifecycle after boot: unprovisioned
Wi-Fi state after scan: disabled
visible networks in final scan: 12 (SSID values redacted)
unknown properties rejected: yes
duplicate request identifiers rejected: yes
unsupported operations rejected: yes
oversized lines rejected: yes
```

The firmware and browser constants are checked against each other, the browser
client is tested with fragmented mock serial frames, the production web build
succeeds, and the ESP-IDF build is pinned to the same reviewed 5.5.5 image used
by the offline foundation.

Not yet implemented or claimed by this checkpoint:

- `setup.configure`, `setup.watch`, network reset, or factory reset;
- Wi-Fi credential storage or association;
- backend claim creation/redemption, P-256 device identity, DNS, TLS, or WSS;
- spool, live-session, historical synchronization, or remote operations; and
- any Nano connection, SASSI transmission, profile/log access, or write path.

The next vertical slice is backend claim creation plus simulated bootstrap,
followed by `setup.configure` and real Wi-Fi association while the Atom remains
computer-powered. It must report `ready` only after the authenticated backend
session exists.
