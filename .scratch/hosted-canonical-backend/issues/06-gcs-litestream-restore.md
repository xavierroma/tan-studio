# 06: GCS attachments + Litestream + restore script

**What to build:** Attachment bytes on the host live in the GCS bucket. The SQLite notebook is continuously replicated to that bucket. If the VM disk dies, a documented restore brings the notebook and attachments back.

**Blocked by:** 02 (Object-store port), 05 (Deploy binary + Caddy + systemd)

**Status:** ready-for-agent

- [ ] Hosted attachment PUT/GET uses the GCS adapter (S3-compatible HMAC); desktop still uses local disk.
- [ ] A 512 MiB-capable object is streamed; the e2-micro does not buffer the whole file in RAM as a design assumption.
- [ ] Litestream (or equivalent) runs as a sidecar/systemd unit, not inside the Rust process.
- [ ] Replica target is the same project bucket (distinct prefix from attachments).
- [ ] A restore procedure exists: stop service, restore DB, confirm attachment objects, start service.
- [ ] The restore procedure has been run once against a throwaway copy (not only written down).
