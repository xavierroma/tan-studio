# 14: Close-out docs and production topology

**What to build:** The repo tells the truth about how the notebook is hosted: `studio.tan.coffee` is the canonical backend, Tan Bridge is the USB path, the LAN appliance is not production, and a weekend restore is documented.

**Blocked by:** 13 (Live Nano → hosted notebook)

**Status:** ready-for-agent

- [ ] README product shape matches hosted canonical backend + Tan Bridge (LAN/desktop described as non-canonical or dev).
- [ ] Product constants and the bridge protocol doc use `studio.tan.coffee`, not `bridge.tanstudio.xroma.dev`.
- [ ] ADRs 0001–0003 still match what shipped (amend if a detail drifted).
- [ ] Restore and cutover commands are findable from README or the infra README.
- [ ] `tan.coffee` is documented as the public site, not the notebook.
- [ ] Full repo gate (`bun run check`) is green.
