# AtomS3 Lite Tan Bridge implementation handoff

Status: the offline-safe receive-only foundation and the computer-powered Web
Serial status/Wi-Fi-scan slice are implemented. The Nano power/enumeration gate
and every credential, cloud-claim, backend-session, and Nano operation remain
pending.

Target board: **M5Stack AtomS3 Lite, SKU C124**. Do not substitute the older
Atom Lite, the AtomS3 display model, or a board that puts native USB behind a
USB-to-UART converter.

This document is the execution handoff for developing the bridge on another
computer before the board can be tested with the Kaffelogic Nano. The broader
architecture and protocol evidence remain in
[`06-wireless-bridge-and-agent-interface.md`](06-wireless-bridge-and-agent-interface.md)
and [`02-usb-protocol-and-file-formats.md`](02-usb-protocol-and-file-formats.md).

Product-direction update, 21 July 2026: the offline-safe implementation and
hardware gates in this handoff remain valid. The post-probe product transport,
browser provisioning, state machines, remote backend session, and typed
read/write behavior are superseded by
[`10-tan-bridge-native-protocol.md`](10-tan-bridge-native-protocol.md).

## 1. Intended result

The finished AtomS3 Lite becomes one small, always-on dongle connected to the
Nano's USB port. It joins the home Wi-Fi network and makes the roaster available
to the Tan Studio Rust backend without moving the canonical database onto the
microcontroller.

```text
Kaffelogic Nano
    │ one USB-C data/power connection
    ▼
AtomS3 Lite "Tan Bridge"
    │ paired HTTPS + WebSocket on the home LAN
    ▼
Tan Studio Rust backend
    │ the same application services and OpenAPI API used everywhere else
    ▼
Web UI, CLI, and MCP
```

The bridge owns only USB/SASSI transport, a bounded recovery spool, network
pairing, and device diagnostics. The Rust backend remains the authority for
profiles, coffees, roasts, brews, notes, attachments, labels, and SQLite. MCP
and the browser never connect directly to the Atom.

## 2. What is known and what is not

Known from the published AtomS3 Lite documentation and schematic:

- the C124 uses an ESP32-S3FN8 with 8 MB flash and no PSRAM;
- its single USB-C port reaches the ESP32-S3 native USB D-/D+ pins;
- the connector advertises a USB sink/device with CC pull-downs;
- it has 2.4 GHz Wi-Fi, a button, and an RGB status LED;
- ESP-IDF and the Espressif TinyUSB device stack support CDC-ACM on ESP32-S3.

Known from direct Nano testing on the Mac:

- direct USB is CDC-ACM carrying SASSI frames;
- the Nano emits spontaneous type-2 capability frames;
- model `KN1007B`, platform `1`, capability `128`, SASSI version `1`, maximum
  packet `4064`, and maximum filename `192` have been observed;
- Tan Studio can read the connected device's profiles and logs directly.

The decisive remaining hypothesis is that the Nano recognizes and powers an
accessory-side USB CDC **device**, as the official wireless module design
suggests. That is plausible, not yet proven on the C124. Production bridge work
must remain read-only and fail-closed until the passive physical test in section
7 succeeds.

## 3. Non-negotiable safety rules

1. Never guess or transmit a SASSI write, roast-control, firmware, delete, or
   format command.
2. The first Nano connection uses only `firmware/usb-role-probe`; Wi-Fi is off
   and the firmware never replies to roaster traffic.
3. Measure VBUS voltage, current, inrush, and backfeed with a USB-C meter that
   preserves CC and USB 2 data before enabling Wi-Fi while Nano-powered.
4. Resolve the Atom's exact serial port before flashing. Disconnect the Nano
   and every other serial board so the flash script cannot target the roaster.
5. Do not expose the bridge through ngrok, router port forwarding, or an
   unauthenticated LAN endpoint.
6. Do not log raw SASSI payloads, device serials, Wi-Fi passwords, pairing
   secrets, or file contents. Redacted replay fixtures belong in the repository;
   captures containing private identifiers do not.
7. Do not enable secure boot or flash encryption during development. Add them
   only after recovery, OTA rollback, and production key handling are proven.

## 4. Work that can be completed away from the Nano

### 4.1 Prepare and prove the passive probe

Clone the exact repository and build the existing probe:

```sh
git clone git@github.com:xavierroma/tan-studio.git
cd tan-studio
git switch main
git pull --ff-only
./script/build_usb_role_probe.sh
```

Docker is the only firmware build prerequisite. The script pins ESP-IDF 5.5.5
by image digest and `esp_tinyusb` 2.2.1 through the component lock. Record the
commit and artifact hash:

```sh
git rev-parse HEAD
shasum -a 256 firmware/usb-role-probe/build/tan_usb_role_probe.bin
```

With the Nano disconnected and only the C124 connected, hold the Atom reset
button for roughly two seconds until the internal green LED appears, release
it, and identify the newly appearing `/dev/cu.usbmodem...` device. Then flash:

```sh
./script/flash_usb_role_probe.sh /dev/cu.usbmodemXXXX
```

The script asks for the literal confirmation `FLASH`, erases the Atom, and
refuses any path that is not a macOS USB modem device. This overwrites the
factory program. After the board reboots on the development computer, this
command should return a valid JSON document and report that no previous Nano
session exists yet:

```sh
uv run script/read_usb_role_probe.py /dev/cu.usbmodemXXXX
```

Exit status `2` is expected before the Nano test. A malformed response or no
response is not expected and must be fixed before proceeding.

### 4.2 Scaffold the production firmware

Create `firmware/tan-bridge-esp32s3` as a second ESP-IDF application. Do not
turn the passive probe into the bridge: keeping them separate makes it
impossible for a later bridge feature to silently weaken the first test.

Use this module layout:

```text
firmware/tan-bridge-esp32s3/
  CMakeLists.txt
  README.md
  dependencies.lock
  sdkconfig.defaults
  partitions.csv
  main/
    CMakeLists.txt
    app_main.c                  composition root only
  components/
    tan_board/                  button, LED, reset reason, build identity
    tan_usb_device/             ESP TinyUSB CDC transport only
    tan_sassi/                  pure incremental codec and CRC
    tan_roaster_session/        deadlines, retries, capabilities, one command
    tan_spool/                  append-only checksummed recovery journal
    tan_wifi/                   provisioning, reconnect, mDNS
    tan_bridge_api/             paired HTTPS and WebSocket controller
    tan_identity/               pairing keys and authorization
    tan_update/                 signed OTA and rollback, initially disabled
  host-tests/                   codec, state machine, spool, and API tests
```

Keep dependencies pointing inward:

```text
pure SASSI codec and session model
                 ↑
      USB, flash, Wi-Fi ports
                 ↑
        ESP-IDF adapters
                 ↑
          app_main wiring
```

No codec code imports TinyUSB, Wi-Fi, HTTP, flash, or FreeRTOS. No HTTP handler
implements roaster logic. The bridge API and direct USB backend both ultimately
implement Tan Studio's `RoasterLink` boundary; the public Tan Studio REST API
does not fork into a separate product model.

### 4.3 Implement only the offline-testable foundation

The first development pass may implement:

- the same incremental SASSI framing, escaping, length limits, and seeded
  CRC-16/CCITT-XMODEM rules used by the Rust backend;
- fragmented reads, multiple frames per read, malformed-frame recovery, and
  bounded input buffers;
- a `UsbDeviceTransport` adapter using ESP TinyUSB CDC-ACM, with its transmit
  function disabled by default;
- session states `booting`, `usbDetached`, `usbEnumerated`, `observing`,
  `readOnlyReady`, `recovering`, and `faulted`;
- a mock transport and fake monotonic clock for host-side tests;
- an append-only spool model with record version, boot ID, sequence, monotonic
  timestamp, payload length, CRC, and commit marker;
- corruption, torn-write, capacity, retention-gap, and power-loss recovery
  tests for the spool;
- bounded memory accounting: never buffer a full log file and never allocate
  based only on a device-provided length;
- JSON/OpenAPI schemas for the native bridge contract below;
- a mock server or host simulator so the Rust `TanBridgeRoasterLink` can be
  developed without hardware;
- reproducible debug and release builds in the same pinned ESP-IDF container.

Reuse redacted protocol fixtures already covered by the Rust tests. If sharing
fixtures across Rust and embedded host tests is awkward, generate embedded
vectors from one canonical fixture file; do not maintain hand-copied protocol
truth in two places.

### 4.4 Define the bridge contract before network handlers

The initial native contract is deliberately small:

| Operation | Purpose |
| --- | --- |
| `GET /bridge/v1/status` | Firmware/build identity, uptime, USB state, Nano capability summary, spool bounds, and feature flags. |
| `GET /bridge/v1/files` | Cursor-paginated profile/log manifest with size, modification evidence, and SHA-256. |
| `GET /bridge/v1/files/{hash}` | Immutable bounded-range download with checksum and resume support. |
| `GET /bridge/v1/events` | Ordered live device/file/job events over WebSocket. |
| `POST /bridge/v1/synchronize` | Idempotently refresh the read-only device snapshot. |

`POST /bridge/v1/commands` is excluded from the first usable firmware. Add it
only after individual read commands are captured, replay-tested, capability
gated, and named in the contract. A generic raw-frame or raw-serial endpoint is
never allowed.

Every event has:

```json
{
  "schemaVersion": 1,
  "bridgeId": "public-pairing-id",
  "bootId": "random-per-boot-id",
  "seq": 1,
  "monotonicMs": 1234,
  "type": "device.status",
  "payload": {}
}
```

The OpenAPI document is the contract authority. Generate Rust bridge-client
types from it or validate generated types in CI; do not manually maintain a
second, almost-matching Rust model.

### 4.5 Network and pairing design

Use the ESP-IDF facilities rather than custom network/security stacks:

- `wifi_provisioning` for the initial SoftAP flow with proof-of-possession;
- `mdns` to advertise `_tan-bridge._tcp` as
  `tan-bridge-<short-id>.local`;
- ESP-TLS/mbedTLS and the HTTPS server for the paired local API;
- NVS for configuration during development, then NVS encryption in the
  production-hardening gate;
- `esp_https_ota` with two application slots and rollback after the bridge is
  otherwise stable.

First pairing requires holding the physical button to open a short pairing
window. The bridge pins the backend identity and the backend pins the bridge
identity. Discovery metadata contains only the product, protocol major, and
pairing state. Wi-Fi and pairing secrets never enter status responses or logs.

Define LED behavior centrally and keep the LED normally off:

| Signal | Meaning |
| --- | --- |
| brief blue pulse | booting or joining Wi-Fi |
| brief green pulse | paired backend connected |
| slow amber pulse | recovery data is waiting |
| red pulse pattern | persistent fault; diagnostics required |
| no light | healthy idle operation |

Do not add a browser-hosted configuration application to the Atom. Tan Studio
owns the user interface; the SoftAP exposes only the minimal provisioning and
pairing flow.

### 4.6 Flash and memory constraints

The C124 has 8 MB flash and no PSRAM. Treat that constraint as a useful design
boundary:

- receive/transmit buffers must be bounded near the verified 4,064-byte SASSI
  packet maximum;
- stream file data in chunks and apply backpressure;
- use fixed-capacity queues with explicit drop/fault policy;
- store only enough recovery history to bridge ordinary Wi-Fi/backend outages;
- expose spool low/high cursors and a retention-gap event;
- reserve two OTA application slots, each at least 25% larger than the measured
  release image, and give the remaining safe flash budget to the spool;
- finalize `partitions.csv` from actual image sizes rather than copying
  speculative offsets from this plan.

Target a steady-state heap margin of at least 25%, zero unbounded task/queue
growth, and no heap allocation in the per-byte codec path. Make current,
thermal, and radio measurements before choosing Wi-Fi transmit power or LED
brightness.

## 5. Offline acceptance gate

Before anyone connects the board to the Nano, the other computer should be able
to produce all of these results:

- clean checkout of `main` at a recorded commit;
- passive probe builds reproducibly and its binary SHA-256 is recorded;
- passive probe flashes to the exact C124 and returns schema-valid diagnostics;
- production firmware workspace builds from a clean Docker environment;
- host tests cover good, fragmented, combined, maximum-size, CRC-failed,
  truncated, escaped, and noise-prefixed SASSI inputs;
- session tests prove timeouts, reconnects, sequence gaps, queue saturation,
  and cancellation do not cause a hidden write;
- spool tests survive torn records and resume only from committed records;
- API schema and Rust mock-client contract agree;
- the release image fits both OTA slots with the required margin;
- a build manifest records Git commit, ESP-IDF/component versions, binary
  hashes, partition table, and feature flags;
- transmit remains compile-time and runtime disabled in the build intended for
  the first Nano connection.

Commit and push this work in small verified revisions. Do not commit build
directories, credentials, raw USB captures, or a local `sdkconfig` containing
machine-specific changes; commit reviewed defaults and lock files.

## 6. Artifacts to carry home

Keep these reproducible from Git rather than passing around anonymous binaries:

1. the exact Git commit;
2. passive probe bootloader, partition table, application binary, and SHA-256;
3. a safe bridge build whose SASSI transmit capability is absent;
4. build manifest and flash command;
5. the probe reader and a blank result template;
6. a short list of every USB cable/meter used in the home test.

The authoritative binary is the one rebuilt from the recorded commit. Treat an
unidentified binary copied from chat, email, or a temporary directory as
untrusted.

## 7. At-home hardware gate

Do this only when the Nano and the C124 are physically together.

### 7.1 Passive role and power test

1. Quit Kaffelogic Studio and Tan Studio so neither affects the experiment.
2. Power the Nano normally with no green coffee loaded and no roast running.
3. Verify the C124 still has the passive `usb-role-probe` image, not bridge
   firmware.
4. Put a short USB 2.0 data cable and a CC/data-preserving USB-C current meter
   between Nano and Atom. Verify orientation and rule out backfeed before
   leaving it connected.
5. Connect for 30 seconds. Do not press buttons; the probe has no Wi-Fi or
   intentional transmit path.
6. Record VBUS voltage, idle/peak current, resets/brownouts, and whether the
   Atom remains powered.
7. Disconnect the Atom from the Nano, reconnect it to the Mac, identify the new
   `/dev/cu.usbmodem...`, and run:

   ```sh
   uv run script/read_usb_role_probe.py /dev/cu.usbmodemXXXX
   ```

The program persists counters in NVS, so the `previous` object represents the
Nano session even though the Atom was power-cycled while changing cables.

### 7.2 Interpret the result

| Result | Decision |
| --- | --- |
| Atom is not powered | Stop. The one-cable native-device design is not proven; do not work around it by blindly injecting power. |
| Power is unstable, current is unsafe, or Nano resets | Stop. Investigate power/inrush with an electrical fallback before any Wi-Fi test. |
| Powered, `attached == 0` | Stop production work. Inspect CC/cable/descriptors and compare against the official accessory; do not add SASSI behavior. |
| `attached > 0`, `rxBytes == 0` | USB enumeration works, but the Nano did not send CDC data. Capture descriptor/control behavior before changing the protocol. |
| `attached > 0`, `rxBytes > 0`, `sassiFrames == 0` | Inspect only redacted framing metadata; fix the passive parser or descriptor hypothesis first. |
| All three counters are positive | Nano-as-host/source, Atom-as-device/sink, and spontaneous SASSI receipt are proven. Proceed to the staged read-only bridge. |

Preserve the JSON result, meter readings, board/cable identity, firmware hash,
and photos of the setup as a redacted hardware fixture in the verification
documentation.

## 8. Staged read-only bridge proof

Only after the last row of section 7 passes:

1. Flash a bridge build that can observe SASSI but still cannot transmit.
2. Enable Wi-Fi and measure current, voltage, brownouts, and temperature for
   boot, association, idle, and sustained traffic.
3. Enable mDNS and paired `GET /bridge/v1/status`; prove the backend can
   discover, pair, disconnect, and reconnect.
4. Enable one individually verified read request at a time. The session permits
   one in-flight request and has explicit deadline/retry behavior.
5. List and download profiles/logs into immutable chunks, then compare SHA-256
   and lossless parsing with the same files read by direct USB.
6. Run a roast with both Kaffelogic Studio evidence and Tan Studio telemetry;
   prove ordered live samples, reconnect/gap recovery, and chart parity.
7. Power-cycle the Atom during observation and synchronization. The Nano must
   remain safe and the backend must report an honest gap or recover from the
   spool—never invent or duplicate data.
8. Only after sustained soak tests add encrypted secrets, signed OTA, rollback,
   watchdog behavior, and a production enclosure/thermal test.

No device mutation is part of this gate. Profile upload and other writes are a
later feature, implemented command-by-command after legitimate traffic has been
captured and replay-tested.

## 9. Definition of done for the first useful dongle

The first useful Tan Bridge release is complete when:

- one USB cable powers and connects the C124 without destabilizing the Nano;
- the bridge rejoins configured Wi-Fi and is discoverable locally after power
  loss without user intervention;
- pairing requires physical button access and all normal API traffic is
  authenticated and encrypted;
- the Rust backend uses a generated, versioned bridge client behind
  `RoasterLink` and exposes the same Tan Studio API/UI/MCP behavior as direct
  USB;
- every profile and log obtained through the bridge hashes or losslessly parses
  identically to direct USB evidence;
- live telemetry stays ordered and bounded across long roasts and reconnects;
- the spool makes loss and retention gaps explicit;
- the bridge has no generic serial proxy and no unverified write command;
- recovery flashing, signed OTA rollback, redacted diagnostics, current draw,
  temperature, and 24-hour soak behavior are documented and repeatable.

## 10. Copy-paste Codex prompt for the other computer

```text
You are implementing the first safe AtomS3 Lite C124 firmware foundation for
Tan Studio. Clone git@github.com:xavierroma/tan-studio.git, switch to main, and
pull with --ff-only. Read these files completely before changing anything:

- docs/08-atoms3-lite-implementation-handoff.md
- docs/06-wireless-bridge-and-agent-interface.md
- docs/02-usb-protocol-and-file-formats.md
- firmware/usb-role-probe/README.md
- firmware/usb-role-probe/main/probe.c
- script/build_usb_role_probe.sh
- script/flash_usb_role_probe.sh
- script/read_usb_role_probe.py

I have the M5Stack AtomS3 Lite, SKU C124, with me, but I do not have the
Kaffelogic Nano. Complete only the work labeled safe away from the Nano. First
build the existing passive probe reproducibly. With every other serial device
disconnected, identify the Atom's exact new USB modem path, flash the probe,
and verify the diagnostic JSON. The expected pre-Nano result is exit status 2
with no previous attachment session. Record the Git commit and binary SHA-256.

Then scaffold firmware/tan-bridge-esp32s3 exactly along the clean boundaries in
the handoff. Use pinned ESP-IDF/TinyUSB components, pure host-testable SASSI and
session modules, a checksummed append-only spool, and a contract-first native
bridge API. Add host tests and a reproducible Docker build. Use the repository's
redacted fixtures as canonical protocol evidence. Ensure the build intended for
the first Nano connection has all SASSI transmission absent at compile time and
runtime.

Do not invent packets; do not add roast/profile/device writes; do not add a raw
serial proxy; do not expose an unauthenticated server; do not enable Wi-Fi in
the passive probe; and do not claim the one-cable bridge works until the at-home
power/enumeration gate passes. Do not enable secure boot or flash encryption
yet. Preserve unrelated work.

Run the firmware build and host tests from a clean environment, run git diff
--check, document exact results and remaining hardware gates, commit the
verified revision to main, and push it to origin. Leave the worktree clean.
```

## 11. Primary references

- [M5Stack AtomS3 Lite C124 documentation](https://docs.m5stack.com/en/core/AtomS3%20Lite)
- [M5Stack AtomS3 Lite schematic](https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/471/Sch_M5_AtomS3_v1.0.pdf)
- [ESP-IDF USB Device Stack](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/peripherals/usb_device.html)
- [ESP-IDF Wi-Fi provisioning](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/provisioning/wifi_provisioning.html)
- [ESP-IDF mDNS service](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/protocols/mdns.html)
- [ESP HTTPS OTA](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/esp_https_ota.html)
