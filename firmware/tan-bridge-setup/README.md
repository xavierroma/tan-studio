# Tan Bridge local-LAN image

This is the single AtomS3 Lite image used for local Tan Studio operation. The
same USB-C port is used first with a computer for setup and then with the Nano.

Implemented setup protocol operations:

- `setup.getStatus`: persistent pseudonymous bridge identity plus redacted
  lifecycle, Wi-Fi, backend, claim, firmware, and protocol state.
- `setup.scanWifi`: a bounded list of up to 12 visible 2.4 GHz networks with
  opaque scan-lifetime identifiers and sanitized display names.
- `setup.configure`: atomically stores the selected Wi-Fi credential and a
  one-time backend claim, then restarts into bridge mode.

The transport is strict UTF-8 JSON Lines over USB CDC at a nominal 115,200
baud. Lines are capped at 4,096 bytes, unknown properties are rejected, and
the last eight request identifiers cannot be reused.

After setup it resolves `xrc.local`, authenticates outbound on TCP port `8081`,
and forwards USB byte chunks into the Rust service. Backend-to-Nano frames are
accepted only for the five already verified read-only SASSI message types 1,
3, 5, 7, and 13. Wi-Fi credentials never leave the Atom. This unencrypted TCP
transport is deliberately scoped to the trusted local-LAN milestone; the
production remote design remains authenticated TLS/WSS.

The Atom retains a bounded 8 KiB bootstrap buffer while Wi-Fi is associating.
This preserves the Nano's spontaneous SASSI capability frame, which normally
arrives before the bridge can authenticate. Capture freezes after the backend's
first validated read-only SASSI response is delivered to the Nano, but the
bootstrap stays available for replay after a later backend reconnect.

Build and contract-check with:

```sh
./script/build_tan_bridge_setup_firmware.sh
```

This uses a digest-pinned ESP-IDF container because no host IDF toolchain is
required. The generated object cache and linker output stay in the named Docker
volume `tan-studio-esp-idf-5-5-5`, avoiding the severe random-I/O cost of
linking on a macOS bind mount; only the three flash binaries and flash manifest
are copied back. Use `./script/build_tan_bridge_setup_firmware.sh --clean` only
when the target or locked dependencies change.

With the Nano disconnected, put the Atom in ROM download mode and flash with:

```sh
./script/flash_tan_bridge_setup_firmware.sh /dev/cu.usbmodem...
```

After the application USB port reappears, validate the redacted status and scan
contract with:

```sh
uv run script/verify_tan_bridge_setup.py /dev/cu.usbmodem...
```
