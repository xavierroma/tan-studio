# 13: Live Nano → hosted notebook

**What to build:** With no LAN appliance running, a real roast (or a real stored log on the paired Nano) lands in the canonical notebook on `studio.tan.coffee`. The operator can see it while away from home.

**Blocked by:** 07 (Cutover existing notebook), 09 (KLOG over the fake bridge), 12 (Firmware Wi-Fi + TLS + session)

**Status:** ready-for-agent

- [ ] Tan Bridge is on the Nano USB-C port, not on a computer acting as the notebook host.
- [ ] The device session stays up (or reconnects) to `wss://studio.tan.coffee/device/v1/session`.
- [ ] A verified KLOG from that Nano appears as the expected roast on the hosted notebook.
- [ ] Planned-roast reconciliation still holds if the operator planned the roast in the studio UI.
- [ ] No Pi/Mac LAN daemon is required for this path.
- [ ] Unverified Nano writes remain disabled.
