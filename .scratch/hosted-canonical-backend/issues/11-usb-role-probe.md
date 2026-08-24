# 11: USB-role probe on the real Nano

**What to build:** The operator runs the existing USB-role probe procedure on real hardware so production Tan Bridge firmware is not flashed onto a live Nano until the electrical/enumeration gate passes.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [ ] Probe firmware is built and flashed as documented in the Atom implementation handoff.
- [ ] The metered Nano test records attached / rxBytes / sassiFrames (pass or explicit fail).
- [ ] A fail means ticket 12 must not target a live Nano; a pass is the only green light for that.
- [ ] Findings are written on this ticket under Comments.
