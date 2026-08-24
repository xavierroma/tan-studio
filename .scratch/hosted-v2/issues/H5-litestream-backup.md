# H5: Continuous backup of the hosted notebook

**What to build:** The hosted SQLite notebook is continuously replicated off the VM, and a restore has actually been performed once.

**Blocked by:** H6 (the current-main deployment must be live first)

**Status:** completed

- [ ] Litestream (or equivalent) replicates `/var/lib/tan-studio/tan-studio.sqlite` to the existing GCS bucket in project `tan-coffee`, under its own prefix.
- [ ] It runs as its own systemd unit, not inside the Rust process, and is enabled on boot.
- [ ] Credentials come from the VM service account or a root-owned 0600 file, never the repo.
- [ ] A restore script exists and has been **run once** against a throwaway copy, not merely documented.
- [ ] The deploy pipeline does not fight it: the installer already stops the service before backing up, so replication is consistent across a deploy.
- [ ] Cost stays inside the always-free envelope; note the expected monthly bytes.

Attachment objects on local disk are explicitly out of scope for this ticket; the notebook database is what must not be lost.

## Comments

- 2026-08-24 — Landed in `99cf737`. Litestream replicates `/var/lib/tan-studio/tan-studio.sqlite` to `gs://tan-coffee-backups/tan-studio/notebook` from its own `litestream` systemd unit, enabled and active. Credential is a root-owned 0600 file at `/etc/tan-studio/litestream-gcs.json`, never in the repo. ADR 0006 records the decision.

  Replication intervals are deliberately far longer than Litestream's defaults: every level check costs a Cloud Storage class A operation, and the stock 30s/5m cadence idles at 500,000+ operations a month against a 5,000 free allowance. The configured 1h/6h/24h cadence idles at roughly 50 a day.

  **The restore was executed, not just written.** `sudo ./restore_notebook.sh` on the VM restored to a scratch path and reported: `integrity ok`, `migrations 14`, and a row census across `coffees/roasts/brews/notes/attachments/api_tokens/settings`. Litestream logged `post-restore integrity check passed`. The script refuses to target the live notebook whatever spelling names it. Row counts are zero because the notebook holds no data yet.

  Delivered by a subagent that stalled before committing; its work was taken over, its ADR renumbered 0005 -> 0006 to clear a collision with the bridge ADR, and the restore run to completion by hand.
