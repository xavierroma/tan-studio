#!/usr/bin/env bash
# OPERATOR ACTION: enables public authenticated /mcp. Never run from deployment
# or tests automatically. Requires separate action-time approval; creates no token.
set -euo pipefail
if [[ "${1:-}" != '--enable-public-mcp' || "$EUID" -ne 0 ]]; then
  echo 'Usage (after approval): sudo ./enable_mcp.sh --enable-public-mcp' >&2
  exit 2
fi
release=/opt/tan-studio/current
for file in bin/bun mcp/http-server.js system/tan-studio-mcp.service system/mcp.caddy; do
  [[ -f "$release/$file" ]] || { echo "Missing release artifact: $file" >&2; exit 1; }
done
getent group tan-studio-mcp >/dev/null || groupadd --system tan-studio-mcp
id tan-studio-mcp >/dev/null 2>&1 || useradd --system --gid tan-studio-mcp --no-create-home --shell /usr/sbin/nologin tan-studio-mcp
install -d -m 0755 /etc/tmpfiles.d /etc/systemd/system/tan-studio.service.d
# setgid makes Rust-created socket inherit only this dedicated connector group.
printf '%s\n' 'd /run/tan-studio-mcp-auth 2750 tan-studio tan-studio-mcp -' > /etc/tmpfiles.d/tan-studio-mcp.conf
systemd-tmpfiles --create /etc/tmpfiles.d/tan-studio-mcp.conf
cat > /etc/systemd/system/tan-studio.service.d/mcp.conf <<'CONFIG'
[Service]
Environment=TAN_STUDIO_MCP_ENABLED=1
Environment=TAN_STUDIO_MCP_AUTH_SOCKET=/run/tan-studio-mcp-auth/auth.sock
ReadWritePaths=/run/tan-studio-mcp-auth
CONFIG
install -m 0644 "$release/system/tan-studio-mcp.service" /etc/systemd/system/tan-studio-mcp.service
systemctl daemon-reload
systemctl restart tan-studio.service
systemctl start tan-studio-mcp.service
ready=0
for attempt in {1..20}; do
  if curl --max-time 2 -fsS http://127.0.0.1:8082/readyz >/dev/null; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  systemctl stop tan-studio-mcp.service
  echo 'MCP not ready; public routing was not enabled. Inspect service logs.' >&2
  exit 1
fi
install -m 0644 "$release/system/mcp.caddy" /etc/caddy/tan-studio-mcp-enabled.caddy
if ! caddy validate --config /etc/caddy/Caddyfile; then
  rm /etc/caddy/tan-studio-mcp-enabled.caddy
  systemctl stop tan-studio-mcp.service
  exit 1
fi
systemctl reload caddy.service
systemctl enable tan-studio-mcp.service >/dev/null
# No credentials, Google secrets or existing environment values are read here.
echo 'Authenticated MCP route enabled. Provision each agent explicitly in Settings → Access.'
