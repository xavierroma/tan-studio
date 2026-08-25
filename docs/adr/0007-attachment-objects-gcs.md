# Attachment bytes: a content-addressed object store, spooled through the disk

ADR 0006 replicates `tan-studio.sqlite` and says attachment blobs are still
unreplicated. This closes that gap. It is the other half of the same problem:
Litestream restores a notebook whose every attachment row points at a file that
died with the disk.

Attachment bytes now go through one port, `ObjectStore`, with two adapters.
Desktop and the LAN appliance keep the local-disk layout they already had,
`{db-dir}/attachments/objects/{hh}/{sha256}`. Hosted mode wraps that same layout
in a Cloud Storage adapter and keeps the durable copy in
`gs://tan-coffee-backups/tan-studio/attachments` — a sibling of Litestream's
`tan-studio/notebook`, never the same prefix.

## The key is the digest

An object's name is the SHA-256 of its bytes. That is what makes an interrupted
upload safe rather than merely unlikely: bytes are hashed as they arrive and
written to a temporary, and the object is moved to its digest name only after
the whole body has been seen. A dead connection leaves a temporary that is
deleted, never a short object under a name a reader would trust. It also makes
the disk a coherent cache for free — a file under a digest name cannot hold
anything but those bytes — and makes replication idempotent, so the backfill
pass can run on every start.

## Why the disk stays in the hosted path

The digest cannot be known until the last byte arrives, so streaming a body of
unknown length straight at Cloud Storage means uploading under a placeholder
name and renaming afterwards: a second remote object, a rewrite loop for
anything large, and a window in which a half-written placeholder exists.

Spooling through the local-disk adapter first settles the digest before anything
is sent. Every upload is then a single-shot `uploadType=media` POST of an
exactly known length, straight to the object's final name — no resumable
session, no chunk bookkeeping, no rewrite. A connection that dies mid-body is a
short body against a declared `Content-Length`, which Cloud Storage discards
whole.

The cost is a disk write the hosted placement would otherwise not need, and the
disk is the thing this ADR exists to stop trusting. That is acceptable because
the disk is no longer the record: it is a spool on the way in and a cache on the
way out, and losing it loses nothing. The 10 GB volume has room, and the write
buys a much smaller upload path.

## Memory is the binding constraint

The VM is a 1 GB e2-micro and an attachment may be 512 MiB, so nothing may hold
an object. On the way in, the body is hashed and written chunk by chunk as it
arrives. On the way out, `ObjectReader` is an `AsyncRead` — over the file, or
over the bucket's response body — that the HTTP layer streams into the response.
Neither direction ever collects into a `Vec`. This is why the port hands back a
reader rather than bytes, and why the upload declares a length instead of using
chunked framing.

A refused upload fails the request rather than answering 200 and hoping the next
backfill catches it. Reporting bytes as stored when they reached nothing but
this disk would be the exact silent gap the adapter exists to close.

## The credential

The same service account and the same handover as ADR 0006:
`tan-studio-backup@` holding `roles/storage.objectAdmin` on that one bucket, key
root-owned 0600 at `/etc/tan-studio/litestream-gcs.json`, read by systemd as
root and passed to the unit through `LoadCredential=gcs.json:...`. The service
reads it from `$CREDENTIALS_DIRECTORY`. The key is not copied to a second path,
is not in `/etc/tan-studio/environment`, is not in the repo, and is not in the
release tarball. `deploy/hosted/test.sh` asserts the unit carries the line and
that the generated environment file holds no key material.

Because systemd refuses to start a unit whose `LoadCredential=` source is
missing, `install.sh` now checks for that file before staging anything and says
to run `install_litestream.sh` first. Without the check the failure would land
as an unexplained unit start failure after the release was already in place.

The token is minted in-process from the key with `jsonwebtoken` and exchanged at
Google's token endpoint, and cached until shortly before it expires. No new
crate: `reqwest` gained its `stream` feature, whose only additional dependencies
are `futures-io` and the wasm32-only `wasm-streams`, neither of which lands in
the linux build. Every dependency is rebuilt under emulation on each deploy, so
a dedicated GCS crate was not worth its build time for one POST, one GET, one
DELETE and a JWT.

## Degradation, and what happens to bytes already on the disk

Hosted mode without a bucket, or with no readable credential, falls back to the
local disk and logs `attachment_replication_disabled` at `warn`. A hosted
configuration has to be runnable off the VM, and refusing to boot would trade a
missing backup for an outage. The warning exists so nobody has to guess which
mode is live.

Attachments written before this landed exist only on the VM disk. On every
hosted start the service walks the local object tree in the background and
uploads whatever the bucket lacks, logging
`attachment_replication_finished` with counts. Reads fall back to the disk while
that runs, so nothing is orphaned and nothing is served worse in the meantime.
