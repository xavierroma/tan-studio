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
