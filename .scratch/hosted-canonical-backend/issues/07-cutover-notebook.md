# 07: Cutover existing notebook

**What to build:** The operator’s current notebook (short IDs, roasts, notes, attachment bytes) is the hosted notebook. After verification, the Mac/Pi copy is not canonical. Two writers must not run.

**Blocked by:** 06 (GCS attachments + Litestream + restore script)

**Status:** ready-for-agent

- [ ] A scripted copy moves the current SQLite notebook and local attachment objects onto the host/bucket without changing public IDs (roast 15 stays roast 15).
- [ ] After cutover, a signed-in read of history on `studio.tan.coffee` matches the source notebook at copy time.
- [ ] Native KLOG/KPRO evidence is present (SQLite BLOBs stay BLOBs).
- [ ] The operator confirms the live read; LAN appliance and desktop are then treated as not canonical.
- [ ] The procedure says to stop local writers before the copy so there is one writer.
