# Notebook backup: Litestream to GCS, native, in its own unit

ADR 0003 already committed the notebook to continuous replication into a GCS
bucket. This records how.

Litestream replicates `/var/lib/tan-studio/tan-studio.sqlite` to
`gs://tan-coffee-backups/tan-studio/notebook` from its own `litestream` systemd
unit, not from inside the Rust process. A backup that dies with the thing it is
backing up is not a backup: the notebook is restarted on every deploy and
restarted by systemd on every crash, and replication has to span both. The
unit is `Restart=always` and `WantedBy=multi-user.target`.

Litestream speaks the native `gs://` protocol with Application Default
Credentials, not the S3 interoperability endpoint. GCS can pretend to be S3
with HMAC keys, but that adds a second signing path and a second long-lived
credential to protect for no gain, since Litestream supports GCS directly.

The credential is a JSON key for a dedicated service account,
`tan-studio-backup@`, holding `roles/storage.objectAdmin` on that one bucket.
The VM's own service account was the first choice and cannot be used: it carries
the read-only `devstorage.read_only` scope, and widening an instance scope
requires stopping the instance. The key is root-owned mode 0600 at
`/etc/tan-studio/litestream-gcs.json`; systemd reads it as root and passes it to
the unit through `LoadCredential=`, so the unprivileged `tan-studio` user that
Litestream runs as never gets read access to the file on disk. The key is not
in the repo and not in the release tarball.

Litestream's stock housekeeping intervals were lengthened by roughly two orders
of magnitude. Compaction and retention monitors call Cloud Storage on every
tick whether or not there is work, and the defaults idle at about 13 listings a
minute — over 500,000 class A operations a month against an always-free
allowance of 5,000. The intervals in `deploy/hosted/litestream.yml` idle at
about 50 operations a day. This costs nothing that matters: those intervals
govern how tidy the remote file set is, not how much data is at risk. The
`sync-interval` is what bounds data loss, and it stays at 60s.

Attachment blobs on local disk are still unreplicated. That is a separate
problem from the notebook and is not solved here. ADR 0007 solves it, in the
same bucket under the sibling prefix `tan-studio/attachments`, reusing this
service account and this `LoadCredential=` handover.

The bucket and service account were created by hand. When the OpenTofu of
ADR 0003 exists, it should adopt them rather than create a second pair.
