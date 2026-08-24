# 02: Object-store port for attachments

**What to build:** Attachment upload and download still work the way the operator already uses them, but file bytes pass through a content-addressed store (key = SHA-256) instead of the API talking to a directory. Desktop and dev keep the local-disk adapter. No GCS in this ticket.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Putting attachment content and getting it back still round-trips the same bytes and hash.
- [x] A missing or incomplete object is still a pending upload the operator (or agent) can retry.
- [x] The 512 MiB limit still holds.
- [x] Desktop/dev behaviour is unchanged from the operator’s point of view (local files next to the notebook).
- [x] Tests drive the store through the port (local adapter), not through a hard-wired path inside the resource handlers.
- [x] `bun run check` (or the service test gate used in this repo) stays green.

## Comments

Landed on `hosted/02-object-store-port` (`d6a3349`). Attachment bytes go through a content-addressed `ObjectStore` port with a local-disk adapter. `core_api` PUT/GET no longer talk to `PathBuf`. Service `cargo test --lib` 36 passed. Full `bun run check` was not run. Not merged to `main` yet (working tree already has other edits on `api.rs` / `core_api.rs`).
