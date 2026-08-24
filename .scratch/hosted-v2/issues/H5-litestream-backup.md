# H5: Continuous backup of the hosted notebook

**What to build:** The hosted SQLite notebook is continuously replicated off the VM, and a restore has actually been performed once.

**Blocked by:** H6 (the current-main deployment must be live first)

**Status:** ready-for-agent

- [ ] Litestream (or equivalent) replicates `/var/lib/tan-studio/tan-studio.sqlite` to the existing GCS bucket in project `tan-coffee`, under its own prefix.
- [ ] It runs as its own systemd unit, not inside the Rust process, and is enabled on boot.
- [ ] Credentials come from the VM service account or a root-owned 0600 file, never the repo.
- [ ] A restore script exists and has been **run once** against a throwaway copy, not merely documented.
- [ ] The deploy pipeline does not fight it: the installer already stops the service before backing up, so replication is consistent across a deploy.
- [ ] Cost stays inside the always-free envelope; note the expected monthly bytes.

Attachment objects on local disk are explicitly out of scope for this ticket; the notebook database is what must not be lost.
