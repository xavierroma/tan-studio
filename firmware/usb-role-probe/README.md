# Tan USB role probe

This is a temporary, passive ESP32-S3 firmware image used to validate the
Kaffelogic Nano accessory-side USB topology before production bridge hardware is
selected.

It presents one USB CDC-ACM **device** and records only:

- USB attach/detach events;
- DTR, RTS, and line-coding changes;
- received byte and callback counts;
- SASSI frame count, type, and length metadata.

It never stores or reports raw USB payloads, Wi-Fi credentials, or the Nano
serial number. It does not echo data and has no roaster command implementation.
Its only transmit path requires the exact `TAN_PROBE_DUMP` diagnostic command,
asserted DTR, and a sentinel 921,600-bit/s line coding. Those conditions are set
together only by the reader after reconnecting the probe to the development
Mac; an accidental token in roaster traffic cannot enable a response by itself.

## Supported probe boards

The image targets the native USB peripheral on ESP32-S3 GPIO19/GPIO20 and uses a
4 MB flash layout so it can run on:

- the existing Adafruit ESP32-S3 Reverse TFT Feather (display unused);
- M5Stack AtomS3 Lite C124;
- Seeed XIAO ESP32S3 and ESP32S3 Plus;
- Adafruit QT Py ESP32-S3.

These boards all expose the ESP32-S3 native USB peripheral on their USB-C port.
Board-specific LEDs, screens, PSRAM, and external GPIO are intentionally unused.

## Reproducible build

Docker is the only build prerequisite:

```sh
./script/build_usb_role_probe.sh
```

The script pins the multi-architecture Espressif ESP-IDF 5.5.5 container by OCI
digest. The component manifest pins `esp_tinyusb` 2.2.1. Generated binaries are
written to `firmware/usb-role-probe/build/` and are not committed.

## Physical test

Flashing replaces the current program on the ESP32-S3 board. Do not run the
flash script until any files or firmware on the probe board have been backed up.
The Nano must be physically disconnected before flashing, so its serial device
can never be selected accidentally.

1. Connect only the ESP32-S3 probe board to the Mac.
2. Put it in its ROM download mode and identify its `/dev/cu.usbmodem...` path.
3. Flash with `./script/flash_usb_role_probe.sh /dev/cu.usbmodem...`.
4. Unplug it from the Mac and connect the same USB-C port to the powered Nano
   through a short USB 2.0 data cable and a CC/data-preserving current meter.
5. Wait 30 seconds, then unplug it from the Nano.
6. Reconnect it to the Mac and run
   `uv run script/read_usb_role_probe.py /dev/cu.usbmodem...`.

Success requires the `previous` session to show `attached > 0`. `rxBytes > 0`
and `sassiFrames > 0` additionally prove that the Nano enumerated the gadget and
sent SASSI traffic. A powered board with all three values at zero means VBUS was
present but USB enumeration did not occur; an unpowered board means the Nano did
not source VBUS through that cable/topology.
