# Tan Bridge ESP32-S3 foundation

This is the separate production-firmware workspace for the M5Stack AtomS3 Lite
C124. It is not the passive USB-role probe, and it must not be connected to a
Kaffelogic Nano until the passive power/enumeration gate in
`docs/08-atoms3-lite-implementation-handoff.md` succeeds.

## Current safety boundary

The current image is a receive-only foundation:

- ESP TinyUSB exposes one CDC-ACM device and queues bounded receive events.
- The SASSI codec is incremental, allocation-free per byte, and caps negotiated
  framing at 4,064 packet bytes plus 64 framing bytes.
- There is no SASSI encoder, USB transmit function, raw serial endpoint, device
  command, Wi-Fi startup, HTTP handler, pairing flow, or OTA path.
- `tan_build_config.h` rejects a first-Nano build if transmit or network
  features are enabled. Runtime policy tests independently require every such
  feature to remain false.
- The OpenAPI 3.1 document defines the future paired, read-only native contract;
  it does not make that server available in this firmware.

The component dependencies point inward: pure codec/session/spool models have
no ESP-IDF, TinyUSB, HTTP, flash, Wi-Fi, or FreeRTOS imports; ESP-IDF adapters
sit outside them; `app_main.c` only wires events together.

## Reproducible verification

Docker is the only firmware/host-test prerequisite. Both scripts require the
reviewed ESP-IDF 5.5.5 image digest and refuse a different registry digest.

```sh
./script/test_tan_bridge_host.sh
./script/build_tan_bridge_firmware.sh
```

The build script produces clean debug and release builds under `build/`. The
release manifest records the Git commit and cleanliness, ESP-IDF/TinyUSB
versions, feature flags, partition sizes, image sizes, and SHA-256 hashes. It
fails unless each 2 MiB OTA slot retains at least 25% margin over the measured
release application image.

The host suite generates its C fixture header directly from
`packages/device-sassi/test/fixtures.ts`; the repository does not carry a
second hand-copied protocol fixture.

## Flashing policy

Do not flash this bridge image for the first Nano test. Flash and validate
`firmware/usb-role-probe` on the development Mac first. Only after the powered,
metered Nano test reports positive `attached`, `rxBytes`, and `sassiFrames`
may this receive-only bridge image be considered for the next staged test.

Secure boot, flash encryption, NVS encryption, Wi-Fi, pairing, HTTPS, mDNS,
signed OTA, rollback, SASSI requests, and all device mutation remain gated.
