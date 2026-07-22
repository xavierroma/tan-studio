#!/usr/bin/env bash
set -euo pipefail

TAN_COMMAND="${1:-install}"
TAN_LABEL="com.xavierroma.tanstudio.lan"
TAN_UID="$(id -u)"
TAN_LAUNCH_DOMAIN="gui/$TAN_UID"
TAN_APP_SUPPORT="$HOME/Library/Application Support/com.xavierroma.tanstudio"
TAN_LAN_ROOT="$TAN_APP_SUPPORT/lan"
TAN_RELEASES="$TAN_LAN_ROOT/releases"
TAN_CURRENT="$TAN_LAN_ROOT/current"
TAN_RUNNER="$TAN_LAN_ROOT/run.sh"
TAN_TOKEN_FILE="$TAN_LAN_ROOT/token"
TAN_LOG_DIRECTORY="$TAN_LAN_ROOT/logs"
TAN_DATABASE_PATH="${TAN_STUDIO_MAC_LAN_DATABASE_PATH:-$TAN_APP_SUPPORT/store/tan-studio.sqlite}"
TAN_PORT="${TAN_STUDIO_MAC_LAN_PORT:-8080}"
TAN_BRIDGE_PORT="${TAN_STUDIO_MAC_LAN_BRIDGE_PORT:-8081}"
TAN_PLIST="$HOME/Library/LaunchAgents/$TAN_LABEL.plist"

if [[ ! "$TAN_PORT" =~ ^[0-9]+$ ]] || ((TAN_PORT < 1024 || TAN_PORT > 65535)); then
  echo "TAN_STUDIO_MAC_LAN_PORT must be an unprivileged TCP port (1024-65535)" >&2
  exit 2
fi
if [[ ! "$TAN_BRIDGE_PORT" =~ ^[0-9]+$ ]] || ((TAN_BRIDGE_PORT < 1024 || TAN_BRIDGE_PORT > 65535)) || [[ "$TAN_BRIDGE_PORT" == "$TAN_PORT" ]]; then
  echo "TAN_STUDIO_MAC_LAN_BRIDGE_PORT must be a distinct unprivileged TCP port (1024-65535)" >&2
  exit 2
fi

tan_primary_interface() {
  route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}'
}

TAN_INTERFACE="$(tan_primary_interface)"
TAN_LAN_IP="${TAN_STUDIO_MAC_LAN_IP:-$(ipconfig getifaddr "$TAN_INTERFACE" 2>/dev/null || true)}"
TAN_LOCAL_NAME="${TAN_STUDIO_MAC_LAN_NAME:-$(scutil --get LocalHostName 2>/dev/null || true)}"

if [[ ! "$TAN_LAN_IP" =~ ^[0-9a-fA-F:.]+$ ]] || [[ ! "$TAN_LOCAL_NAME" =~ ^[A-Za-z0-9-]+$ ]]; then
  echo "Tan Studio could not determine a safe LAN address and local hostname" >&2
  exit 2
fi

TAN_NAME_AUTHORITY="$TAN_LOCAL_NAME.local:$TAN_PORT"
TAN_IP_AUTHORITY="$TAN_LAN_IP:$TAN_PORT"
TAN_LOOPBACK_AUTHORITY="127.0.0.1:$TAN_PORT"
TAN_HOSTS="$TAN_NAME_AUTHORITY,$TAN_IP_AUTHORITY,$TAN_LOOPBACK_AUTHORITY"
TAN_ORIGINS="http://$TAN_NAME_AUTHORITY,http://$TAN_IP_AUTHORITY,http://$TAN_LOOPBACK_AUTHORITY"

tan_stop() {
  launchctl bootout "$TAN_LAUNCH_DOMAIN/$TAN_LABEL" >/dev/null 2>&1 || true
}

tan_wait_healthy() {
  for _ in {1..30}; do
    if curl --fail --silent --show-error --max-time 2 \
      --header "Host: $TAN_IP_AUTHORITY" "http://127.0.0.1:$TAN_PORT/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

tan_start() {
  if [[ ! -f "$TAN_PLIST" ]] || [[ ! -x "$TAN_RUNNER" ]]; then
    echo "Tan Studio LAN is not installed; run: bun run lan:install" >&2
    exit 1
  fi
  if ! launchctl print "$TAN_LAUNCH_DOMAIN/$TAN_LABEL" >/dev/null 2>&1; then
    launchctl bootstrap "$TAN_LAUNCH_DOMAIN" "$TAN_PLIST"
  else
    launchctl kickstart -k "$TAN_LAUNCH_DOMAIN/$TAN_LABEL"
  fi
  if ! tan_wait_healthy; then
    tail -n 40 "$TAN_LOG_DIRECTORY/service.error.log" >&2 || true
    return 1
  fi
}

tan_status() {
  if ! launchctl print "$TAN_LAUNCH_DOMAIN/$TAN_LABEL" >/dev/null 2>&1; then
    echo "Tan Studio LAN is stopped"
    exit 1
  fi
  curl --fail --silent --show-error --max-time 2 \
    --header "Host: $TAN_IP_AUTHORITY" "http://127.0.0.1:$TAN_PORT/healthz"
  printf '\nUI: http://%s\nAPI base: http://%s/api/v1\nAPI token: %s\n' \
    "$TAN_NAME_AUTHORITY" "$TAN_NAME_AUTHORITY" "$TAN_TOKEN_FILE"
}

case "$TAN_COMMAND" in
stop)
  tan_stop
  echo "Tan Studio LAN stopped"
  exit 0
  ;;
start)
  tan_start
  tan_status
  exit 0
  ;;
status)
  tan_status
  exit 0
  ;;
install) ;;
*)
  echo "Usage: $0 {install|start|stop|status}" >&2
  exit 2
  ;;
esac

if pgrep -f '/Tan Studio.app/Contents/MacOS/tan-studio$' >/dev/null 2>&1; then
  echo "Quit the Tan Studio desktop app before installing LAN mode; both modes cannot own the Nano USB port." >&2
  exit 1
fi

TAN_REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TAN_VERSION="$(git -C "$TAN_REPOSITORY_ROOT" rev-parse --short=12 HEAD)"
TAN_RELEASE="$TAN_RELEASES/$TAN_VERSION"
TAN_SERVICE_SOURCE="$TAN_REPOSITORY_ROOT/apps/service/target/release/tan-studio-service"
TAN_WEB_SOURCE="$TAN_REPOSITORY_ROOT/apps/web/dist"

cd "$TAN_REPOSITORY_ROOT"
bun run --filter @tan-studio/web build
cargo build --locked --release --manifest-path apps/service/Cargo.toml

install -d -m 0700 "$TAN_RELEASES" "$TAN_LAN_ROOT" "$TAN_LOG_DIRECTORY"
install -d -m 0700 "$(dirname "$TAN_DATABASE_PATH")"
if [[ ! -d "$TAN_RELEASE" ]]; then
  TAN_STAGING="$TAN_RELEASES/.staging-$TAN_VERSION-$$"
  install -d -m 0700 "$TAN_STAGING/bin" "$TAN_STAGING/web"
  install -m 0755 "$TAN_SERVICE_SOURCE" "$TAN_STAGING/bin/tan-studio-service"
  ditto "$TAN_WEB_SOURCE" "$TAN_STAGING/web"
  mv "$TAN_STAGING" "$TAN_RELEASE"
fi
ln -sfn "$TAN_RELEASE" "$TAN_CURRENT"

if [[ ! -f "$TAN_TOKEN_FILE" ]] || [[ ! "$(tr -d '\r\n' < "$TAN_TOKEN_FILE")" =~ ^[a-f0-9]{64}$ ]]; then
  umask 077
  openssl rand -hex 32 > "$TAN_TOKEN_FILE"
fi
chmod 0600 "$TAN_TOKEN_FILE"

{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  printf 'TAN_LAN_ROOT=%q\n' "$TAN_LAN_ROOT"
  printf 'export TAN_STUDIO_HEADLESS=1\n'
  printf 'export TAN_STUDIO_BIND_HOST=0.0.0.0\n'
  printf 'export TAN_STUDIO_PORT=%q\n' "$TAN_PORT"
  printf 'export TAN_STUDIO_BRIDGE_PORT=%q\n' "$TAN_BRIDGE_PORT"
  printf 'export TAN_STUDIO_DATABASE_PATH=%q\n' "$TAN_DATABASE_PATH"
  printf 'export TAN_STUDIO_WEB_ROOT=%q\n' "$TAN_CURRENT/web"
  printf 'export TAN_STUDIO_VERSION=%q\n' "$TAN_VERSION"
  printf 'export TAN_STUDIO_ALLOWED_HOSTS=%q\n' "$TAN_HOSTS"
  printf 'export TAN_STUDIO_ALLOWED_ORIGINS=%q\n' "$TAN_ORIGINS"
  printf 'export TAN_STUDIO_LAN_TOKEN="$(/usr/bin/tr -d '\''\\r\\n'\'' < "$TAN_LAN_ROOT/token")"\n'
  printf 'exec "$TAN_LAN_ROOT/current/bin/tan-studio-service"\n'
} > "$TAN_RUNNER"
chmod 0700 "$TAN_RUNNER"

install -d -m 0700 "$(dirname "$TAN_PLIST")"
TAN_PLIST_STAGING="$TAN_LAN_ROOT/$TAN_LABEL.plist"
plutil -create xml1 "$TAN_PLIST_STAGING"
plutil -insert Label -string "$TAN_LABEL" "$TAN_PLIST_STAGING"
plutil -insert ProgramArguments -array "$TAN_PLIST_STAGING"
plutil -insert ProgramArguments.0 -string /bin/bash "$TAN_PLIST_STAGING"
plutil -insert ProgramArguments.1 -string "$TAN_RUNNER" "$TAN_PLIST_STAGING"
plutil -insert RunAtLoad -bool true "$TAN_PLIST_STAGING"
plutil -insert KeepAlive -bool true "$TAN_PLIST_STAGING"
plutil -insert ProcessType -string Background "$TAN_PLIST_STAGING"
plutil -insert ThrottleInterval -integer 3 "$TAN_PLIST_STAGING"
plutil -insert StandardOutPath -string "$TAN_LOG_DIRECTORY/service.log" "$TAN_PLIST_STAGING"
plutil -insert StandardErrorPath -string "$TAN_LOG_DIRECTORY/service.error.log" "$TAN_PLIST_STAGING"
install -m 0600 "$TAN_PLIST_STAGING" "$TAN_PLIST"

tan_stop
tan_start

printf 'Tan Studio LAN is running.\nUI:       http://%s\n          http://%s\nAPI base: http://%s/api/v1\nBridge:   %s.local:%s\nAPI token: %s\n' \
  "$TAN_NAME_AUTHORITY" "$TAN_IP_AUTHORITY" "$TAN_NAME_AUTHORITY" "$TAN_LOCAL_NAME" "$TAN_BRIDGE_PORT" "$TAN_TOKEN_FILE"
