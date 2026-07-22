# AtomS3 Lite offline-safe implementation verification

Date: 21 July 2026

Board: M5Stack AtomS3 Lite, SKU C124

Verified implementation commit: `73d4aafc8dcb58372caecb755269929debbc6df6`

This record covers only the work that is safe away from the Kaffelogic Nano.
The Nano was not present or connected. Nothing here proves that the Nano can
power or enumerate the Atom over one cable.

## Passive probe

The probe was built from the clean verified commit with the pinned ESP-IDF
5.5.5 container and locked `esp_tinyusb` 2.2.1 / TinyUSB 0.21.0~1 components:

```text
bootloader.bin
  31b2d4505b0fd8f5f614cb576a808e8082adc9c7f5390083bc7b3e263a6b5e0a
partition-table.bin
  7f00b6c042a89b15b0cac534f82ed988caf29278ff5700b0c511eb1b5bb7c820
tan_usb_role_probe.bin
  5f9fb53806f5444891d9737fcf1ccf1c33bb8df434b394cf32cc9ca50c301405
```

With every other serial board absent, the C124 entered its native Espressif
USB-Serial/JTAG ROM interface as `/dev/cu.usbmodem11401`. Flashing with the
following command identified an ESP32-S3 QFN56 revision 0.2 with 8 MB embedded
XMC flash. Erase and all three writes completed with esptool's hash
verification:

```sh
./script/flash_usb_role_probe.sh /dev/cu.usbmodem11401
```

The first probe image exposed a real diagnostic transport defect: a response
longer than the 512-byte CDC transmit buffer was truncated. The verified probe
drains the complete bounded response through the CDC queue. After a plain
power cycle it enumerated as `/dev/cu.usbmodemrole_probe1`, and this command
returned schema-valid JSON with the expected exit status 2:

```sh
uv run script/read_usb_role_probe.py /dev/cu.usbmodemrole_probe1
```

Observed result:

```json
{
  "current": {
    "attached": 1,
    "bitRate": 921600,
    "boot": 1,
    "detached": 0,
    "droppedEvents": 0,
    "dtr": 1,
    "lastFrameLength": 0,
    "lastSassiType": 0,
    "lineCodingChanges": 9,
    "lineStateChanges": 1,
    "longestFrameLength": 0,
    "malformedSassiFrames": 0,
    "rts": 1,
    "rxBytes": 15,
    "rxCallbacks": 1,
    "sassiFrames": 0
  },
  "previousAvailable": false,
  "probe": "tan-usb-role",
  "schemaVersion": 1
}
```

The current attachment and 15 received bytes are the development Mac opening
the interface and sending `TAN_PROBE_DUMP`. They are not Nano observations.
The full output also contained a zeroed `previous` object.

## Receive-only bridge foundation

`firmware/tan-bridge-esp32s3` was built from a clean tree in the same pinned
container. Both debug and release builds succeeded. The release manifest
reported `gitTreeClean: true` and these artifacts:

```text
bootloader.bin, 18,640 bytes
  fd774fd36245970609b203bcc53441dd322663313ff64ea4eda3a2980b670a43
partition-table.bin, 3,072 bytes
  01bb4f4b77434a8143abd3356dcb74e9e37b35ec08a60a7acc82ad6e1435cb78
tan_bridge.bin, 180,880 bytes
  f72319c288d9b864871995bae54ab6d6d9606e52c35e755eff02700fa3c322ee
partitions.csv
  3fce88504779be825ea56f9affe51f1a5e07e5f650811b0531047418db09a8a0
```

Each OTA slot is 2,097,152 bytes. The release application occupies 180,880
bytes and leaves 91% of the smallest application slot free, exceeding the
required 25% margin. Secure boot and flash encryption remain disabled.

The image intended for the first Nano connection has SASSI transmission,
Wi-Fi, the bridge API server, pairing, and OTA disabled at compile time and at
runtime. The release build also inspects the linked ELF and fails if a CDC or
Tan transmit/write symbol survives linker garbage collection. No bridge image
was flashed to the board.

## Verification commands

The following checks passed for the verified implementation commit:

```text
./script/test_tan_bridge_host.sh
  2/2 CTest tests passed: native foundation and API contract

cargo fmt --manifest-path apps/service/Cargo.toml -- --check
  passed

cargo test --manifest-path apps/service/Cargo.toml
  27 passed, 0 failed

./script/build_tan_bridge_firmware.sh
  clean debug and release builds passed
  forbidden transmit-symbol assertion passed

python3 -m json.tool \
  firmware/tan-bridge-esp32s3/components/tan_bridge_api/openapi.json
  passed

git diff --check
  passed
```

The host suite covers canonical generated type-2 fixtures, every fragmentation
boundary, combined frames, noise recovery, CRC failure and recovery, maximum
and oversized frames, truncation, and field-delimiter rejection. Session tests
cover the fragmented mock transport, fake clock, timeout, reconnect, sequence
gap, cancellation, and queue saturation without a write. Spool tests cover
committed recovery, torn records, corruption, capacity, and retention gaps.
The OpenAPI contract and typed Rust mock client expose exactly the five
read-only bridge operations from the handoff, under mutual TLS, with no command
or raw-serial endpoint.

## Remaining hardware gates

The Atom must retain the passive probe until the at-home Nano test is complete.
That test still requires the exact Nano, a short USB 2.0 data cable, and a
CC/data-preserving USB-C current meter. Record VBUS voltage, idle and peak
current, resets or brownouts, backfeed behavior, cable identity, and the
persisted probe JSON.

The passive role/power gate passes only when power is stable and the persisted
Nano session has all of `attached > 0`, `rxBytes > 0`, and `sassiFrames > 0`.
Until then:

- do not claim the one-cable bridge works;
- do not flash the bridge image for the Nano test;
- do not enable Wi-Fi, mDNS, HTTPS, pairing, SASSI transmit, or OTA;
- do not add a SASSI encoder, device command, mutation, or raw serial proxy;
- do not enable secure boot or flash encryption.

Only after that gate passes may the staged read-only bridge proof begin, with
separate current measurements for Wi-Fi and one individually evidenced read
request at a time. Device mutation remains outside that gate.

## At-home hardware gate attempt

Date: 21 July 2026

Repository commit: `018abbc60a67e08b8fb0d2a75ddae6fdcfd124dd`

Passive probe application SHA-256:
`5f9fb53806f5444891d9737fcf1ccf1c33bb8df434b394cf32cc9ca50c301405`

Command:

```sh
uv run script/read_usb_role_probe.py /dev/cu.usbmodemrole_probe1
```

Observed result:

```json
{
  "current": {
    "attached": 1,
    "bitRate": 921600,
    "boot": 7,
    "detached": 0,
    "droppedEvents": 0,
    "dtr": 1,
    "lastFrameLength": 0,
    "lastSassiType": 0,
    "lineCodingChanges": 9,
    "lineStateChanges": 1,
    "longestFrameLength": 0,
    "malformedSassiFrames": 0,
    "rts": 1,
    "rxBytes": 15,
    "rxCallbacks": 1,
    "sassiFrames": 0
  },
  "previous": {
    "attached": 1,
    "bitRate": 921600,
    "boot": 6,
    "detached": 0,
    "droppedEvents": 0,
    "dtr": 1,
    "lastFrameLength": 0,
    "lastSassiType": 0,
    "lineCodingChanges": 9,
    "lineStateChanges": 1,
    "longestFrameLength": 0,
    "malformedSassiFrames": 0,
    "rts": 1,
    "rxBytes": 15,
    "rxCallbacks": 1,
    "sassiFrames": 0
  },
  "previousAvailable": true,
  "probe": "tan-usb-role",
  "schemaVersion": 1
}
```

Command exit status: `5`.

Interpretation: inconclusive physical sequence, not a Nano protocol failure.
The `previous` session has the development-reader signature:
`bitRate == 921600`, `dtr == 1`, `rts == 1`, and `rxBytes == 15`, matching the
Mac-side `TAN_PROBE_DUMP` diagnostic request. That means the persisted
previous session is another computer diagnostic boot, not the intended
Nano-powered 30-second session. The hardware gate is therefore still pending.

Measurements were not available in this run:

- cable identity: not recorded;
- meter identity: not recorded;
- VBUS voltage: not measured;
- idle current: not measured;
- peak current: not measured;
- resets or brownouts: not observed by software;
- Nano reset behavior: not observed by software;
- Atom remained powered by Nano: not verified;
- backfeed indication: not measured.

Do not flash `tan-bridge-setup` or `tan-bridge-esp32s3` onto the Nano
connection based on this result. Repeat section 7 with the Atom disconnected
from the Mac, connected only to the powered Nano for 30 seconds, then moved
back to the Mac for exactly one diagnostic read.

## At-home hardware gate pass

Date: 21 July 2026

Repository commit: `ce0059c1`

Passive probe application SHA-256:
`5f9fb53806f5444891d9737fcf1ccf1c33bb8df434b394cf32cc9ca50c301405`

Command:

```sh
uv run script/read_usb_role_probe.py /dev/cu.usbmodemrole_probe1
```

Observed result:

```json
{
  "current": {
    "attached": 1,
    "bitRate": 921600,
    "boot": 10,
    "detached": 0,
    "droppedEvents": 0,
    "dtr": 1,
    "lastFrameLength": 0,
    "lastSassiType": 0,
    "lineCodingChanges": 9,
    "lineStateChanges": 1,
    "longestFrameLength": 0,
    "malformedSassiFrames": 0,
    "rts": 1,
    "rxBytes": 15,
    "rxCallbacks": 1,
    "sassiFrames": 0
  },
  "previous": {
    "attached": 1,
    "bitRate": 0,
    "boot": 9,
    "detached": 0,
    "droppedEvents": 0,
    "dtr": 0,
    "lastFrameLength": 71,
    "lastSassiType": 2,
    "lineCodingChanges": 0,
    "lineStateChanges": 0,
    "longestFrameLength": 71,
    "malformedSassiFrames": 0,
    "rts": 0,
    "rxBytes": 560,
    "rxCallbacks": 16,
    "sassiFrames": 6
  },
  "previousAvailable": true,
  "probe": "tan-usb-role",
  "schemaVersion": 1
}
```

Command exit status: `0`.

Interpretation: pass. The previous session has Nano-compatible passive
metadata: `attached > 0`, `rxBytes > 0`, `sassiFrames > 0`, `bitRate == 0`,
`dtr == 0`, `rts == 0`, and last SASSI type `2`. This proves the Nano can power
and enumerate the AtomS3 Lite as a USB CDC device and sends spontaneous SASSI
traffic to it.

Measurements were not available in this run:

- cable identity: not recorded;
- meter identity: not recorded;
- VBUS voltage: not measured;
- idle current: not measured;
- peak current: not measured;
- resets or brownouts: not observed by software;
- Nano reset behavior: not observed by software;
- backfeed indication: not measured.

The next stage may proceed only as a staged proof. `tan-bridge-setup` remains a
computer/browser setup image and must not be used while connected to the Nano.
`tan-bridge-esp32s3` is the receive-only Nano foundation; its current release
image intentionally has no Wi-Fi, no API server, no USB transmit path, and no
Tan Studio UI integration.

## Computer-powered setup reflash verification

Date: 21 July 2026

Repository commit: `5e305b8a7ad7`

The passive probe was replaced only after the Nano hardware gate passed. The
Atom was disconnected from the Nano, placed in ROM download mode, erased, and
flashed through the guarded repository workflow:

```sh
./script/build_tan_bridge_setup_firmware.sh
./script/flash_tan_bridge_setup_firmware.sh /dev/cu.usbmodem1101
```

Rebuilt setup application:

```text
bytes: 784032
SHA-256: d5299617a57a4f3e1f5de2814145fca4990886bb9d6e223ee5eaf6dfb13abfc3
```

Esptool 5.1.0 verified the hashes of the bootloader, partition table, and
application after writing. After one normal cable re-enumeration, macOS
identified the application as:

```text
USB product: Tan Bridge Setup Development
USB manufacturer: Tan Studio
USB serial descriptor: tan-bridge-setup
port: /dev/cu.usbmodem1101
```

The physical setup contract was then exercised with:

```sh
uv run script/verify_tan_bridge_setup.py /dev/cu.usbmodem1101
```

Command exit status: `0`.

Redacted result:

```json
{
  "firmware": {
    "version": "0.1.0-dev",
    "build": "setup-v1"
  },
  "lifecycle": "unprovisioned",
  "wifiState": {
    "state": "disabled"
  },
  "visibleNetworkCount": 12,
  "ssidValuesRedacted": true,
  "unknownPropertiesRejected": true,
  "duplicateRequestIdsRejected": true,
  "unsupportedOperationsRejected": true,
  "oversizedLinesRejected": true
}
```

The matching Tan Studio production web build and Rust service were installed
locally at `http://127.0.0.1:8080`, and the Devices route returned the
application shell with a healthy database. The Web Serial client and shared
setup schema suites each passed three focused tests. Chrome was opened to the
Devices route, but its native device chooser was not automated in this run, so
the rendered click-through remains a manual UI check rather than claimed
evidence.

This is still the computer-facing development setup image. It must not be
connected to the Nano and does not accept Wi-Fi credentials, associate to a
network, contact a backend, synchronize Nano files, or expose a production
bridge session.

## Local-LAN bridge bootstrap repair

Date: 22 July 2026

Firmware implementation commit: `598812c`

Reproducible build wrapper commit: `1d44acf`

The physically flashed `0.2.0-local` image successfully retained its Wi-Fi and
device token, resolved `xrc.local`, and repeatedly authenticated to the Rust
bridge listener. It did not retain a usable Nano session: the Nano emits its
type-2 capability frame immediately after USB enumeration, while Wi-Fi and
backend authentication complete later. The earlier firmware forwarded USB
bytes only when a backend socket already existed, so that initial capability
frame was discarded. The service then reached its bounded negotiation timeout
and the bridge reconnected without a capability frame to replay.

`0.2.1-local` (`local-lan-v2`) retains up to 8 KiB of early Nano bytes before
Wi-Fi is ready, replays them immediately after authenticated bridge attachment,
and continues collecting until the first validated read-only backend frame is
delivered to the Nano. The retained bootstrap remains available across a later
backend reconnect. Backend-to-Nano output is still restricted to the five
verified read-only SASSI message types; there is no raw serial endpoint or
profile/roast mutation path.

The clean ESP-IDF 5.5.5 build and the immediate incremental rebuild both
passed the setup contract test. The build runs against the digest-pinned image,
keeps objects and linker output in the Docker volume
`tan-studio-esp-idf-5-5-5`, and copies only guarded flash artifacts back to the
repository build directory. The application version is explicitly pinned so
the firmware binary is reproducible regardless of unrelated Git dirtiness.

```text
bootloader.bin, 18,640 bytes
  6d6e4d4c75184a201e7e2a2215d0c5d6564b3cf7937c2af5806bef7206499dda
partition-table.bin, 3,072 bytes
  7f00b6c042a89b15b0cac534f82ed988caf29278ff5700b0c511eb1b5bb7c820
tan_bridge_setup.bin, 805,472 bytes
  a293374fc166d9f4ef24c41aea92524cddca26dd1d28e6cb309cea904631b69d
```

The application occupies 77% of the 1 MiB factory partition and leaves 23%
free.

The candidate was flashed physically on 22 July 2026 with the Atom connected
only to the Mac. Esptool 5.1.0 erased the previous image, wrote all three
artifacts, and verified every written hash. The first post-flash application
boot enumerated but did not answer setup requests; a normal USB power cycle,
without entering ROM mode again, restored the application interface. The
independent setup verifier then passed with:

```json
{
  "firmware": {
    "version": "0.2.1-local",
    "build": "local-lan-v2"
  },
  "lifecycle": "unprovisioned",
  "wifiState": {
    "state": "disabled"
  },
  "visibleNetworkCount": 12,
  "ssidValuesRedacted": true,
  "unknownPropertiesRejected": true,
  "duplicateRequestIdsRejected": true,
  "invalidConfigurationRejected": true,
  "oversizedLinesRejected": true
}
```

`script/provision_tan_bridge.py` was then used to read the service launch token
from its protected local file, prompt for the Wi-Fi credential without echoing
it, request a one-time claim, send `setup.configure`, and poll for the exact
bridge identity to authenticate. The Atom accepted the configuration, joined
the LAN, resolved `xrc.local`, redeemed its claim, and authenticated to the
Rust listener on port 8081. A subsequent LAN smoke test reported one connected
`0.2.1-local` bridge and retained the expected unauthenticated and hostile-Host
rejections.

The remaining hardware gate is:

1. Move the Atom's single cable from the Mac to the powered Nano.
2. Run `script/smoke_tan_studio_lan.py --expect-bridge
   --expect-device-connected` and verify all Nano profiles and logs through the
   live API and UI.

No bridge identity, Wi-Fi credential, raw Nano payload, or device serial is
recorded in this evidence.

## Stateful Nano simulation and tunnel watchdog diagnosis

Date: 22 July 2026

Repository commit: `acd7007`

The hardware-free verification now uses one stateful Virtual Nano through the
same Rust `Read + Write + Send` session boundary as direct serial and the LAN
bridge. It serves two synthetic KPRO profiles and three synthetic KLOG files,
including multi-chunk transfers and acknowledgements. Direct transport and an
authenticated TCP bridge both completed the same process-level scenario:

- KN1007B, SASSI v1 read-only, and negotiated packet limit 4,064;
- two profiles and three logs discovered with zero import warnings or
  quarantine;
- three roasts, four provenance-preserving profile revisions, nine telemetry
  samples, and five immutable native files persisted in SQLite;
- a repeated synchronization imported zero duplicate logs;
- REST list/detail/series resources, the served React UI and chart, and the MCP
  live smoke test all passed.

The simulator additionally verifies one-byte and 4,096-byte read patterns,
fragmentation, CRC corruption, out-of-order chunks, disconnect, busy status,
response timeout, malformed tunnel sizes, reconnect, and queue saturation. The
complete consolidated command is:

```sh
./script/test_bridge_no_hardware.sh
```

The installed Atom firmware was still `0.2.5-local` (`local-lan-v6`). A real
Atom HIL run used a SQLite backup, a disposable backend/database, and the Mac as
the Nano-side CDC peer. It failed before import and added one interrupt-watchdog
reset in five seconds. Production was restored automatically, and a seven-event
partial, synthetic-only transcript was retained.

Three controlled Mac experiments isolated the cause without the Nano:

1. With no backend, setup status remained stable for ten seconds with zero
   boot or watchdog delta.
2. An authenticated tunnel held open without payload remained stable with zero
   delta.
3. One verified read-only SASSI-shaped payload reproduced the interrupt
   watchdog both with the Mac CDC port closed and held open.

The tunnel task had an 8,192-byte stack and declared an 8,192-byte receive
array inside `tunnel_backend()`. Receiving the first payload overwrote the task
stack. Candidate `0.2.7-local` (`local-lan-v8-heap-tunnel`) moves this bounded
buffer to per-session heap storage and uses a separately host-tested C safety
policy for printable `KL*<type>|...\r` frames of read-only types 1, 3, 5, 7,
and 13. A source contract prevents the 8 KiB stack allocation from returning.

The pinned ESP-IDF 5.5.5 build passed. Candidate application evidence:

```text
tan_bridge_setup.bin: 823,264 bytes
SHA-256: 0ca95a370966768193c9ee4eb1a615496513a6f7afb95a6504b1fad918d2cfee
```

This candidate is not flashed. The installed TinyUSB application did not enter
the ROM downloader through software reset, and the unattended user cannot make
the required physical reset/download gesture. The exact next gate is:

1. With the Nano disconnected, place the Atom in ROM download mode.
2. Install `0.2.7-local` using the guarded application update workflow.
3. Run `script/test_bridge_atom_hil.py` and require the complete synthetic
   import plus zero boot/watchdog deltas.
4. Only after that passes, connect the Atom to the Nano for the final read-only
   power, enumeration, profile, and log integration test.

No raw Nano payload, device serial, bridge identity, Wi-Fi credential, or API
token is included in this evidence.

## Corrected firmware real-Atom HIL

Date: 22 July 2026

Firmware source commit: `acd7007`

With the Nano disconnected, the guarded application-only updater installed
`0.2.7-local` at `0x10000`, preserved NVS, and verified the flashed data hash.
The ESP32-S3 remained in its ROM interface after the normal hard reset; an
explicit watchdog reset then booted `local-lan-v8-heap-tunnel`. Redacted status
confirmed the preserved Wi-Fi and fixed `xrc.local:8081` backend configuration.

The Mac then acted as the Nano over the Atom's physical USB CDC interface for a
30-second HIL run. Traffic crossed the real Atom firmware and Wi-Fi tunnel into
the Rust service using a disposable SQLite backup. Result:

```json
{
  "result": "pass",
  "firmware": "0.2.7-local",
  "simulatedProfiles": 2,
  "simulatedLogs": 3,
  "bootCountDelta": 0,
  "brownoutCountDelta": 0,
  "watchdogCountDelta": 0,
  "interruptWatchdogCountDelta": 0,
  "taskWatchdogCountDelta": 0,
  "productionServiceRestored": true
}
```

The report and synthetic-only transcript are retained under the ignored local
directory `tmp/atom-hil/1784738318178/`. The tunnel stack-overflow repair is
therefore verified on the actual Atom. The final compatibility gate is to move
the Atom's single cable to the powered Nano and validate its real read-only
capability frame, profiles, logs, API resources, and UI charts. No write or
roast-control command is authorized by this gate.
