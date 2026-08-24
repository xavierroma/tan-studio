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
  OPERATOR_GOOGLE_EMAIL=romaxavier12@gmail.com \
  ./install.sh /path/to/release <version>
```

Later releases reuse `/etc/tan-studio/environment` and do not need those values
again. After reboot:

```sh
curl -fsS --header 'Host: studio.tan.coffee' https://studio.tan.coffee/healthz
```

Sign in with Google is `https://studio.tan.coffee/auth/google`.
