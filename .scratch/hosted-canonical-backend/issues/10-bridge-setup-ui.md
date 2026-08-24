# 10: Tan Bridge setup UI

**What to build:** From the signed-in studio UI, the operator provisions Tan Bridge over Web Serial: pick the Atom, join Wi-Fi, hand it the one-time claim. The Wi-Fi password never goes to the canonical backend. The UI tells them to move the bridge to the Nano only after the backend session is accepted.

**Blocked by:** 08 (Claims, bootstrap, bridge WebSocket)

**Status:** completed

- [x] Only a signed-in operator can start setup and mint the claim used in the flow.
- [x] Setup talks to the Atom over Web Serial as specified (status, scan, configure, watch).
- [x] Wi-Fi credential is written to the device from the browser and is not sent to `/api/v1`.
- [x] The backend URL the device will dial is `studio.tan.coffee`; the operator does not type a URL.
- [x] Watch reports ready only after bootstrap + session accepted (or the UI does not tell them to unplug early).
- [x] Tests do not need a physical Atom (fake serial / protocol fixtures).

## Comments

Landed on `hosted/10-bridge-setup-ui` (`86acc28`). Signed-in UI mints a claim then talks Web Serial. Wi-Fi password is USB-only. Host pinned to `studio.tan.coffee`. Current setup firmware still returns `unsupported_operation` for configure/watch until ticket 12. Web tests 22 passed. Not merged to `main`.
