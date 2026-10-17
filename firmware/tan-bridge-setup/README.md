# Tan Bridge hosted image

This is the AtomS3 Lite image used with the hosted Tan Studio service. The same
USB-C port is used first with a computer for setup and then with the Nano.

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

After setup it opens
`wss://studio.tan.coffee/device/v1/session`, verifies the public TLS certificate
and hostname, authenticates with the one-time claim or retained device token,
and forwards USB byte chunks into the Rust service. Backend-to-Nano frames are
accepted only for the five verified read-only SASSI message types 1, 3, 5, 7,
and 13. Wi-Fi credentials never leave the Atom.

The setup protocol is schema v2. The backend endpoint is compiled into the
firmware; setup stores only the selected Wi-Fi credential and one-time claim.
WebSocket ping/pong, bounded timeouts, and jittered reconnects keep the tunnel
alive without exposing a raw bridge port.

Version `0.3.4-hosted` / `hosted-wss-v5` uses a 32 KiB byte ring. USB callbacks
perform bounded memory copies only; socket I/O never runs under its critical
section. Overflow, socket/USB write failure or mutex timeout invalidates the
whole stream and closes the session. Bytes from an earlier connection generation
cannot enter a later one. WebSocket callback fragments must be contiguous.

After authentication, a peer positively observed sending `KL*` is disconnected
and reconnected at the USB data level (250 ms). This requests a fresh Nano SASSI
handshake instead of replaying stale seeds after a network interruption. It does
not reset the Nano, switch its power, reboot the Atom or erase configuration.
Computer setup peers are not re-enumerated. There is no durable offline spool;
the next sync reads the Nano's original files again.

`setup.getStatus` adds optional `diagnostics.forwarding` counters: received,
forwarded and discarded bytes; overflows; session failures; USB recoveries; ring
high-water bytes. Counters are per boot. Discards include expected offline and
recovery bytes, so an increasing discard count alone does not prove overflow.
Wi-Fi/backend status and persistent watchdog counters remain available. NVS
initialization errors now fail without erasing provisioning.

The authenticated WSS session also emits numeric diagnostics on attachment and
every 30 seconds. The backend validates the strict bounded message and logs at
most one sample per five seconds. This permits forwarding and watchdog monitoring
while the Atom stays attached to the Nano; no credentials or roast payloads are
included. Older firmware may omit these messages.

Build and contract-check with:

```sh
./script/build_tan_bridge_setup_firmware.sh
```

This uses a digest-pinned ESP-IDF container because no host IDF toolchain is
required. The generated object cache and linker output stay in the named Docker
volume `tan-studio-esp-idf-5-5-5`, avoiding the severe random-I/O cost of
linking on a macOS bind mount; the binaries, ELF, linker map, flash manifest and project metadata
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

For an already-provisioned `0.2.x-local` bridge, the application-only update
keeps the NVS identity, Wi-Fi credential, and issued device token intact. Put
the Atom in ROM download mode with the Nano disconnected, then use the guarded
updater:

```sh
./script/update_tan_bridge_setup_firmware.sh /dev/cu.usbmodem...
```

The updater writes only the factory application partition at `0x10000`; it
does not run `erase-flash` and does not touch the NVS partition. The original
flash script remains the recovery path when configuration must be erased.

After the update, reconnect the Atom to the computer and run the verifier. It
must report firmware `0.3.4-hosted`, transport `wss`, host
`studio.tan.coffee`, port `443`, and path `/device/v1/session`. Then reconnect
the Atom to the Nano. If the retained identity has been revoked or the bridge
was never provisioned, use Tan Studio's Tan Bridge setup panel to issue a new
claim.
