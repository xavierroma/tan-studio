#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIRECTORY="${1:?release source directory is required}"
VERSION="${2:?release version is required}"

if [[ ! "$VERSION" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo "Invalid Tan Studio release version" >&2
  exit 2
fi
if [[ ! -x "$SOURCE_DIRECTORY/bin/tan-studio-service" ]] ||
  [[ ! -f "$SOURCE_DIRECTORY/web/index.html" ]]; then
  echo "The Tan Studio release is incomplete" >&2
  exit 2
fi

RELEASES_DIRECTORY="/opt/tan-studio/releases"
CURRENT_LINK="/opt/tan-studio/current"
RELEASE_DIRECTORY="$RELEASES_DIRECTORY/$VERSION"
STAGING_DIRECTORY="$RELEASES_DIRECTORY/.staging-$VERSION-$$"
STATE_DIRECTORY="/var/lib/tan-studio"
CONFIG_DIRECTORY="/etc/tan-studio"
ENVIRONMENT_FILE="$CONFIG_DIRECTORY/environment"
PREVIOUS_RELEASE=""

cleanup() {
  if [[ -d "$STAGING_DIRECTORY" ]]; then
    rm -rf "$STAGING_DIRECTORY"
  fi
}
trap cleanup EXIT

if ! getent group tan-studio >/dev/null; then
  groupadd --system tan-studio
fi
if ! id -u tan-studio >/dev/null 2>&1; then
  useradd --system --gid tan-studio --home-dir "$STATE_DIRECTORY" \
    --shell /usr/sbin/nologin tan-studio
fi
usermod -a -G dialout tan-studio

install -d -m 0755 /opt/tan-studio "$RELEASES_DIRECTORY"
install -d -o tan-studio -g tan-studio -m 0750 "$STATE_DIRECTORY"
install -d -m 0750 "$CONFIG_DIRECTORY"

if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
fi
if [[ -e "$RELEASE_DIRECTORY" ]]; then
  if [[ ! -x "$RELEASE_DIRECTORY/bin/tan-studio-service" ]] ||
    [[ ! -f "$RELEASE_DIRECTORY/web/index.html" ]] ||
    [[ "$(tr -d '\n' < "$RELEASE_DIRECTORY/VERSION")" != "$VERSION" ]]; then
    echo "Installed release $VERSION is incomplete or inconsistent" >&2
    exit 2
  fi
else
  install -d -m 0755 "$STAGING_DIRECTORY/bin" "$STAGING_DIRECTORY/web"
  install -m 0755 "$SOURCE_DIRECTORY/bin/tan-studio-service" \
    "$STAGING_DIRECTORY/bin/tan-studio-service"
  cp -R "$SOURCE_DIRECTORY/web/." "$STAGING_DIRECTORY/web/"
  install -m 0644 "$SOURCE_DIRECTORY/VERSION" "$STAGING_DIRECTORY/VERSION"
  chown -R root:root "$STAGING_DIRECTORY"
  mv "$STAGING_DIRECTORY" "$RELEASE_DIRECTORY"
fi

TOKEN=""
if [[ -f "$ENVIRONMENT_FILE" ]]; then
  TOKEN="$(sed -n 's/^TAN_STUDIO_LAN_TOKEN=//p' "$ENVIRONMENT_FILE" | head -n 1)"
fi
if [[ ! "$TOKEN" =~ ^[a-f0-9]{64}$ ]]; then
  TOKEN="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
fi
PRIMARY_ADDRESS="$(hostname -I | awk '{print $1}')"
if [[ -z "$PRIMARY_ADDRESS" ]]; then
  echo "Tan Studio cannot determine the Raspberry Pi LAN address" >&2
  exit 1
fi
ENVIRONMENT_STAGING="$CONFIG_DIRECTORY/.environment-$$"
{
  printf 'TAN_STUDIO_HEADLESS=1\n'
  printf 'TAN_STUDIO_BIND_HOST=0.0.0.0\n'
  printf 'TAN_STUDIO_PORT=80\n'
  printf 'TAN_STUDIO_DATABASE_PATH=%s/tan-studio.sqlite\n' "$STATE_DIRECTORY"
  printf 'TAN_STUDIO_WEB_ROOT=%s/web\n' "$CURRENT_LINK"
  printf 'TAN_STUDIO_VERSION=%s\n' "$VERSION"
  printf 'TAN_STUDIO_LAN_TOKEN=%s\n' "$TOKEN"
  printf 'TAN_STUDIO_ALLOWED_HOSTS=tan-studio.local,tan-studio-2.local,%s\n' "$PRIMARY_ADDRESS"
  printf 'TAN_STUDIO_ALLOWED_ORIGINS=http://tan-studio.local,http://tan-studio-2.local,http://%s\n' "$PRIMARY_ADDRESS"
} > "$ENVIRONMENT_STAGING"
chmod 0600 "$ENVIRONMENT_STAGING"
chown root:root "$ENVIRONMENT_STAGING"
mv "$ENVIRONMENT_STAGING" "$ENVIRONMENT_FILE"

install -m 0644 "$SOURCE_DIRECTORY/system/tan-studio.service" \
  /etc/systemd/system/tan-studio.service
install -m 0644 "$SOURCE_DIRECTORY/system/99-tan-studio-kaffelogic.rules" \
  /etc/udev/rules.d/99-tan-studio-kaffelogic.rules

systemctl stop tan-studio.service 2>/dev/null || true
if [[ -f "$STATE_DIRECTORY/tan-studio.sqlite" ]]; then
  BACKUP_DIRECTORY="$STATE_DIRECTORY/backups/pre-deploy-$VERSION"
  install -d -o tan-studio -g tan-studio -m 0750 "$BACKUP_DIRECTORY"
  cp "$STATE_DIRECTORY/tan-studio.sqlite" "$BACKUP_DIRECTORY/tan-studio.sqlite"
fi

ln -sfn "$RELEASE_DIRECTORY" "$CURRENT_LINK"
systemctl daemon-reload
udevadm control --reload-rules
udevadm trigger --subsystem-match=tty
systemctl enable avahi-daemon.service >/dev/null
systemctl restart avahi-daemon.service
systemctl enable tan-studio.service >/dev/null
systemctl restart tan-studio.service

HEALTHY=0
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 2 \
    --header 'Host: tan-studio.local' http://127.0.0.1/healthz >/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" != "1" ]]; then
  systemctl stop tan-studio.service || true
  if [[ -n "$PREVIOUS_RELEASE" ]] && [[ -d "$PREVIOUS_RELEASE" ]]; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    systemctl restart tan-studio.service || true
  fi
  echo "Tan Studio failed its post-deployment health check" >&2
  journalctl -u tan-studio.service --no-pager -n 40 >&2 || true
  exit 1
fi

printf 'Installed Tan Studio %s\n' "$VERSION"
