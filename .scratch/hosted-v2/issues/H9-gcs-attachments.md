# H9: Attachment bytes survive the disk

**What to build:** Attachment bytes in the hosted notebook live in Cloud Storage, not only on the VM's disk. Losing the disk loses no roast photos or logs.

**Blocked by:** nothing (H5 already replicates the database; this is the other half)

**Status:** ready-for-human

## Why

Litestream replicates only `tan-studio.sqlite`. `/var/lib/tan-studio/attachments` has no copy anywhere, so a dead disk restores the notebook with every attachment dangling. This is the last data-loss gap in the hosted deployment.

- [ ] Attachment bytes go through a content-addressed object-store port with two adapters: local disk (desktop, LAN) and GCS (hosted).
- [ ] Hosted mode uses GCS. Desktop and LAN behaviour is unchanged.
- [ ] **Streaming both ways.** The VM is an e2-micro with ~1 GB of RAM; a 512 MiB attachment must not be buffered whole in memory on upload or download. This is a hard constraint, not a nicety.
- [ ] An interrupted upload does not leave a half object that later reads as complete — content addressing means the digest is the name, so only a fully verified object gets its final name.
- [ ] Credential reaches the service through systemd `LoadCredential=` from `/etc/tan-studio/litestream-gcs.json`, exactly as the litestream unit already does. Do NOT copy the key to a second path with looser ownership, and do NOT put it in the environment file.
- [ ] Bucket `tan-coffee-backups`, under a prefix distinct from litestream's `tan-studio/notebook` — use `tan-studio/attachments`.
- [ ] Existing local attachments on the VM are migrated up, or the path degrades safely and says so. Do not silently orphan them.
- [ ] The existing attachment HTTP API is unchanged from a client's point of view.
- [ ] `bun run check` green, including `bun run test:hosted`.

## Start from the archived port, do not rewrite it

`git show archive/object-store-port:apps/service/src/object_store.rs` is reviewed, tested code: `ObjectStore`, `LocalDiskStore`, `StoredObject`, `ObjectReader` (implements `AsyncRead`), `ObjectStoreError`. It was written against an older base and never ported.

`git show archive/object-store-port` for the whole commit, including how `core_api.rs` PUT/GET content handlers were moved off `PathBuf`.

Current main still carries `attachment_root: Arc<PathBuf>` in `apps/service/src/api.rs:50`. Porting means replacing that field, as the archived commit did, and adapting to everything upstream has changed since.

## The GCS adapter

Prefer existing dependencies: `reqwest` is already a dependency, and `jsonwebtoken` came in with the OIDC work, so minting an access token from the service-account key is possible without new crates. If you judge a well-tested crate materially safer for streaming correctness, you may add one — but justify it, and remember every dependency is built under emulation on every deploy.

Resumable or single-shot upload is your call; say which and why.

## Deployment surface

`deploy/hosted/tan-studio.service` needs the `LoadCredential=` line, and the installer needs to pass the bucket and prefix. Keep `deploy/hosted/test.sh` honest — it should assert the unit loads the credential and that the environment file contains no key material.

**Do not deploy.** Land the code; deployment happens separately.

## Comments

- 2026-08-24 — Code landed on `worktree-agent-a3431ab7dd0663672`; **not deployed** (the deploy step is owned elsewhere), hence `ready-for-human` rather than `completed`.

  The archived `archive/object-store-port` commit was ported rather than rewritten: `object_store.rs` and its seven tests came across unchanged, `attachment_root: Arc<PathBuf>` is gone from `ApiState`, and the PUT/GET handlers now talk to the port. The Cloud Storage adapter is new, in `object_store/gcs.rs`, behind the same `ObjectStore` surface. ADR 0007 records the decisions.

  **Streaming.** Uploads are hashed and written to the spool chunk by chunk, then sent to the bucket as a single-shot `uploadType=media` POST with an exact `Content-Length` — no chunked framing, so a body that stops short leaves no object. Downloads come back as an `AsyncRead` over the response body. Two tests hold this: one watches earlier chunks reach the disk before the body has produced the next, the other stalls the bucket mid-body and still reads the first chunk.

  **Migration.** Every hosted start walks the local object tree in the background and uploads what the bucket lacks (`attachment_replication_finished`, with counts). Reads fall back to the disk while that runs, so nothing is orphaned.

  **Degradation.** Hosted with no bucket or no readable credential keeps attachments on the disk and logs `attachment_replication_disabled` at `warn`. A bucket that *is* configured but whose key will not parse refuses to start, rather than looking replicated.

  **Credential.** `LoadCredential=gcs.json:/etc/tan-studio/litestream-gcs.json` in `tan-studio.service`, read from `$CREDENTIALS_DIRECTORY`. No copy, nothing in the environment file. `install.sh` now refuses to install if that key is absent, because systemd will not start a unit whose credential source is missing — run `install_litestream.sh` first.

  Not verified: nothing has run against real Cloud Storage. The adapter's tests drive a fake bucket, and the JWT-minting path has no test that signs with a real RSA key. First deploy should check `journalctl -u tan-studio | grep attachment_replication` and confirm objects under `gs://tan-coffee-backups/tan-studio/attachments/`.
