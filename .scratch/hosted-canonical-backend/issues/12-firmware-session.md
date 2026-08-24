# 12: Firmware Wi-Fi + TLS + session

**What to build:** Tan Bridge firmware joins the configured Wi-Fi network, validates TLS for `studio.tan.coffee`, and completes the bridge session handshake. It still does not own the notebook. It still does not skip the USB-role gate.

**Blocked by:** 08 (Claims, bootstrap, bridge WebSocket), 11 (USB-role probe on the real Nano)

**Status:** ready-for-agent

- [ ] Firmware can associate to 2.4 GHz Wi-Fi from the setup credentials stored on device.
- [ ] Outbound TLS checks the hostname `studio.tan.coffee` (no skip-verify in production builds).
- [ ] The device performs bootstrap (if needed) and the WebSocket session handshake against the hosted service (or a test double that speaks the same contract).
- [ ] Receive-only / no-Nano-host policy remains until ticket 11 has passed for a live roaster.
- [ ] Durable spool still exists so a network drop does not forget ordered events (bounds as in the bridge spec).
- [ ] Host tests stay hardware-free; live Atom verification is documented if used.
