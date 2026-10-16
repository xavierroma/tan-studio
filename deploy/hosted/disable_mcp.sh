#!/usr/bin/env bash
# OPERATOR ACTION: closes remote MCP without downgrading notebook schema/data.
set -euo pipefail
if [[ "${1:-}" != '--disable-public-mcp' || "$EUID" -ne 0 ]]; then
  echo 'Usage: sudo ./disable_mcp.sh --disable-public-mcp' >&2
  exit 2
fi
rm -f /etc/caddy/tan-studio-mcp-enabled.caddy
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy.service
systemctl disable --now tan-studio-mcp.service
rm -f /etc/systemd/system/tan-studio.service.d/mcp.conf
systemctl daemon-reload
systemctl restart tan-studio.service
# Persisted credentials remain revocable in the UI. Revoke before re-enabling if needed.
