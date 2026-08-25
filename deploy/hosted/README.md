# Hosted notebook (`studio.tan.coffee`)

The same Rust HTTP/SQLite service runs on the GCP e2-micro behind Caddy.
Caddy terminates TLS on the VM; systemd starts Caddy and the service on boot.
OIDC client secrets and the session key stay in `/etc/tan-studio/environment`,
not in the release image.

## Deploy

From the repo root, with Docker Desktop running:

```sh
bun run deploy:hosted
```

Defaults:

| | |
| --- | --- |
| SSH | `xavi@136.67.36.35` with `~/.ssh/google_compute_engine` |
| Env file | repo-root `.env` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OPERATOR_GOOGLE_EMAIL`) |
| Secret Manager | `google-oauth-client-id` / `google-oauth-client-secret` in project `tan-coffee` if `.env` is missing those keys |
| Origin | `https://studio.tan.coffee` |

Overrides: `TAN_STUDIO_HOSTED_SSH`, `TAN_STUDIO_HOSTED_SSH_KEY`, `TAN_STUDIO_ENV_FILE`.

A new git SHA builds a new immutable tree under `/opt/tan-studio/releases` and
flips `/opt/tan-studio/current`. Unit files are not edited by hand.

## Operator commands (on the VM)

If the laptop script cannot run, copy a built `dist/hosted/<version>/` tree to
the VM and:

```sh
sudo ./install.sh /path/to/release <version>
```

Secrets on first install (mapped to `TAN_STUDIO_*`):

```sh
sudo \
  GOOGLE_OAUTH_CLIENT_ID=... \
  GOOGLE_OAUTH_CLIENT_SECRET=... \
  OPERATOR_GOOGLE_EMAIL=operator@example.com \
  ./install.sh /path/to/release <version>
```

Later releases reuse `/etc/tan-studio/environment` and do not need those values
again. After reboot:

```sh
curl -fsS --header 'Host: studio.tan.coffee' https://studio.tan.coffee/healthz
```

Sign in with Google is `https://studio.tan.coffee/auth/google`.

## Continuous backup

`/var/lib/tan-studio/tan-studio.sqlite` is replicated to
`gs://tan-coffee-backups/tan-studio/notebook` by Litestream, running as the
`litestream` systemd unit — a separate process from the notebook, enabled on
boot, `Restart=always`, so a crashed or redeployed service never pauses the
backup. Attachment bytes are covered separately, by the notebook process itself
— see **Attachment bytes** below.

Litestream uses the native `gs://` replica and Google Application Default
Credentials rather than the S3 interoperability endpoint: one Google-issued
JSON key, no long-lived HMAC pair, and no second signing path to get wrong.
The VM's own service account cannot be used — it holds the read-only
`devstorage.read_only` scope, and widening a scope requires stopping the
instance. So a dedicated service account,
`tan-studio-backup@tan-coffee.iam.gserviceaccount.com`, holds
`roles/storage.objectAdmin` on that one bucket and nothing else.

The key lives at `/etc/tan-studio/litestream-gcs.json`, root-owned, mode 0600.
It is never in the repo and never in the release tarball. systemd reads it as
root and hands the unit a private copy via `LoadCredential=`, so the
`tan-studio` user never has read access to the file itself.

Install or upgrade replication (the credential is only needed the first time):

```sh
sudo TAN_STUDIO_GCS_CREDENTIAL_FILE=/path/to/key.json ./install_litestream.sh
sudo systemctl status litestream
```

Deploys do not fight it. `install.sh` stops `tan-studio` before copying the
database, so the file Litestream is watching is quiet during the copy, and
`install.sh` never stops or disables the `litestream` unit.

### Restore

`restore_notebook.sh` restores into a scratch path and refuses to write over
the live notebook. Promoting a restored copy is a deliberate, separate act.

```sh
sudo ./restore_notebook.sh                          # newest state
sudo ./restore_notebook.sh /var/tmp/check.sqlite    # explicit destination
sudo TAN_STUDIO_RESTORE_TIMESTAMP=2026-08-24T02:00:00Z ./restore_notebook.sh
```

It runs Litestream's own post-restore integrity check, then `PRAGMA
integrity_check`, then confirms the schema ledger and prints per-table row
counts. To promote a copy after checking it:

```sh
sudo systemctl stop tan-studio
sudo install -o tan-studio -g tan-studio -m 0640 \
  /var/tmp/<restore>/tan-studio.sqlite /var/lib/tan-studio/tan-studio.sqlite
sudo rm -f /var/lib/tan-studio/tan-studio.sqlite-wal \
  /var/lib/tan-studio/tan-studio.sqlite-shm
sudo systemctl restart tan-studio litestream
```

### Cost

The bucket is Standard class in `us-west1`, which is inside the Cloud Storage
always-free allowance (5 GB-month, 5,000 class A and 50,000 class B operations
per month, US regions). The notebook is about 0.5 MB; a daily snapshot with
seven days of retention plus the intervening LTX increments keeps the prefix in
the single-digit megabytes, roughly 1,000x under the free storage allowance.
The `sync-interval`, snapshot interval and compaction intervals in
`litestream.yml` are what bound the operation count, so lengthen them rather
than shortening them.

## Attachment bytes

Litestream replicates the notebook database; the bytes it points at are
replicated by the notebook process, into the same bucket under
`gs://tan-coffee-backups/tan-studio/attachments` — a sibling of the notebook
prefix, never the same one. ADR 0007 records why.

Objects are named by the SHA-256 of their bytes, so an upload only gets its
final name once the whole body has verified, and an interrupted one leaves
nothing readable. `/var/lib/tan-studio/attachments` is still used, but only as
an upload spool and a read cache: losing that disk loses no attachment.

Configuration is two lines in `/etc/tan-studio/environment`, written by
`install.sh`:

```
TAN_STUDIO_ATTACHMENT_BUCKET=tan-coffee-backups
TAN_STUDIO_ATTACHMENT_PREFIX=tan-studio/attachments
```

No credential goes in that file. The service uses the same key as Litestream,
handed over by systemd through `LoadCredential=gcs.json:/etc/tan-studio/litestream-gcs.json`
in `tan-studio.service`, and read at runtime from `$CREDENTIALS_DIRECTORY`.
Because systemd will not start a unit whose credential source is missing,
`install.sh` refuses to install until `install_litestream.sh` has put the key in
place.

On every start the service uploads any object the disk has and the bucket does
not, so attachments predating this are migrated rather than orphaned:

```sh
journalctl -u tan-studio | grep attachment_replication_finished
```

If the bucket or the credential is absent, the service still starts, keeps
attachments on the local disk only, and logs
`attachment_replication_disabled` at `warn`. Check for that line before assuming
attachments are safe.

## API tokens for MCP and HTTP clients

The MCP plugin and `curl` cannot sign in with Google, so they present an API
token instead. Mint one in the signed-in notebook under **Settings → Access**;
the secret is shown once. Each token is stored only as a SHA-256 digest and can
be revoked on its own from the same screen.

```sh
curl -fsS \
  --header "Authorization: Bearer $TAN_STUDIO_API_TOKEN" \
  --header 'X-Tan-Studio-Client: tan-studio-api-v1' \
  https://studio.tan.coffee/api/v1/coffees
```

The plugin needs no change beyond pointing at the origin:

```sh
TAN_STUDIO_URL=https://studio.tan.coffee \
TAN_STUDIO_API_TOKEN=<minted secret> \
  bun run plugins/tan-studio/dist/server.js
```

or, for an installed plugin, put the origin in
`~/.config/tan-studio/codex-plugin.json` and the secret in the mode-0600
`~/.config/tan-studio/token`.

The LAN token (`TAN_STUDIO_LAN_TOKEN`) is not a hosted credential: hosted mode
has no launch token, and a single global bearer would be a second permanent
anonymous operator.
