# H2: Hosted deploy pipeline on current main

**What to build:** `bun run deploy:hosted` builds a linux/amd64 release of current main and installs it on the VM under Caddy + systemd, repeatably.

**Blocked by:** nothing (independent of H1; the two land together)

**Status:** ready-for-agent

- [ ] `deploy/hosted/` carries the Caddyfile, systemd unit, Dockerfile, installer and its test suite.
- [ ] `script/build_hosted_release.sh` builds a linux/amd64 tree via Docker; `script/deploy_hosted.sh` ships and installs it.
- [ ] Releases are immutable under `/opt/tan-studio/releases/<version>` behind a `current` symlink; unit files are never hand-edited.
- [ ] Secrets are written to a root-owned 0600 `/etc/tan-studio/environment`, never into the release image.
- [ ] The pre-deploy SQLite backup stops the service FIRST and copies the `-wal`/`-shm` sidecars.
- [ ] `bun run test:hosted` passes and is wired into `bun run test`.

## Port, do not merge

Branch `hosted/05-deploy-caddy-systemd`, tip `1e6412f`. Take the whole of `deploy/hosted/`, `script/build_hosted_release.sh`, `script/deploy_hosted.sh`, and the `package.json` script entries.

`git show 1e6412f:deploy/hosted/install.sh` etc.

## Hard-won fixes already in that branch — keep them

- Dockerfile must pin **`rust:1.97-bookworm`**. `rust:1.85` fails: the lock needs rustc >= 1.88.
- Debian 13 has **no rsync**. Transfer uses `tar` over the existing ssh connection. Do not reintroduce rsync.
- Backup stops the unit before copying, and copies `-wal`/`-shm`.

## Live facts

VM `tan-notebook`, `xavi@136.67.36.35`, Debian 13 trixie, passwordless sudo, key `~/.ssh/google_compute_engine`. Caddy 2.11.2 from trixie-backports. Origin `https://studio.tan.coffee`. Secrets in repo-root `.env` and Secret Manager (`google-oauth-client-id`, `google-oauth-client-secret`) in project `tan-coffee`.

**Do not deploy in this ticket.** Land the pipeline; deployment happens in H6 once H1 is merged.
