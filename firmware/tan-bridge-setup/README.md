# Tan Bridge setup development image

This computer-powered image implements the first Web Serial provisioning slice
for the AtomS3 Lite. It is separate from the verified receive-only Nano image.

Implemented setup protocol operations:

- `setup.getStatus`: persistent pseudonymous bridge identity plus redacted
  lifecycle, Wi-Fi, backend, claim, firmware, and protocol state.
- `setup.scanWifi`: a bounded list of up to 12 visible 2.4 GHz networks with
  opaque scan-lifetime identifiers and sanitized display names.

The transport is strict UTF-8 JSON Lines over USB CDC at a nominal 115,200
baud. Lines are capped at 4,096 bytes, unknown properties are rejected, and
the last eight request identifiers cannot be reused.

This image does not accept Wi-Fi credentials, contact the backend, communicate
with a Kaffelogic Nano, or implement any SASSI transmit path. Those stages
remain explicit follow-on work after this handshake is physically verified.

Build and contract-check with:

```sh
./script/build_tan_bridge_setup_firmware.sh
```

With the Nano disconnected, put the Atom in ROM download mode and flash with:

```sh
./script/flash_tan_bridge_setup_firmware.sh /dev/cu.usbmodem...
```

After the application USB port reappears, validate the redacted status and scan
contract with:

```sh
uv run script/verify_tan_bridge_setup.py /dev/cu.usbmodem...
```
