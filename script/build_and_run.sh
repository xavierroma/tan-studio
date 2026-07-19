#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="tan-studio"
BUNDLE_ID="com.xavierroma.tanstudio"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$HOME/Applications/Tan Studio.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$APP_NAME"

stop_app() {
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
  pkill -x "tan-studio-companion" >/dev/null 2>&1 || true
  pkill -x "tan-studio-serial-bridge" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! pgrep -x "$APP_NAME" >/dev/null 2>&1; then
      return
    fi
    sleep 0.1
  done

  echo "Tan Studio did not stop cleanly before the build." >&2
  exit 1
}

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

verify_launch() {
  for _ in {1..50}; do
    if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
      echo "Tan Studio is running from $APP_BUNDLE"
      return
    fi
    sleep 0.1
  done

  echo "Tan Studio did not start within five seconds." >&2
  exit 1
}

case "$MODE" in
  run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac

stop_app
cd "$ROOT_DIR"
bun run build

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    verify_launch
    ;;
esac
