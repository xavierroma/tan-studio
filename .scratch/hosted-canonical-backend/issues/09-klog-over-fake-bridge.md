# 09: KLOG over the fake bridge

**What to build:** A finished roast log offered on an authenticated bridge session becomes a roast in the hosted notebook (reconciled to a planned roast when one exists). Evidence stays lossless. A fake device is enough.

**Blocked by:** 08 (Claims, bootstrap, bridge WebSocket)

**Status:** completed

- [x] After session accepted, the fake device can offer native log chunks; the backend writes a content-addressed object and does not import until length and SHA-256 verify (bridge spec).
- [x] A verified KLOG imports through the existing lossless importer into the public roast model.
- [x] If a planned roast is active, reconciliation follows the existing planned-roast rules.
- [x] Interrupted or invalid bytes do not create a fake success roast.
- [x] The hosted process still does not open a USB serial port for this path.

## Comments

Landed on `hosted/09-klog-over-fake-bridge` (`0379500`). After SHA-256 verify, the real KLOG importer creates or reconciles a roast. Staging during transfer is in-memory (not the GCS object store from ticket 02). Hosted USB stays idle. Service tests passed. Not merged to `main`.
