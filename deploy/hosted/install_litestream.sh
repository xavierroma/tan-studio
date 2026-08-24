#!/usr/bin/env bash
set -euo pipefail

# Installs continuous off-VM replication of the hosted notebook.
#
# Litestream runs as its own systemd unit, not inside the Rust process, so a
# crashed or redeployed notebook does not stop the backup. Run as root:
#
#   sudo TAN_STUDIO_GCS_CREDENTIAL_FILE=/tmp/key.json ./install_litestream.sh
#
# The credential is only needed the first time; later runs reuse the installed
# root-owned 0600 copy. Set TAN_STUDIO_INSTALL_ROOT to install into a prefix
# for testing, which skips the download and every systemctl call.

LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.5.16}"
LITESTREAM_ARCHITECTURE="${LITESTREAM_ARCHITECTURE:-linux-x86_64}"
CREDENTIAL_SOURCE="${TAN_STUDIO_GCS_CREDENTIAL_FILE:-}"

SOURCE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PREFIX="${TAN_STUDIO_INSTALL_ROOT:-}"
LIVE=1
if [[ -n "$PREFIX" ]]; then
  LIVE=0
fi
if [[ "$LIVE" == "1" && "$(id -u)" -ne 0 ]]; then
  echo "Run the Litestream installer as root" >&2
  exit 2
fi

prefixed() {
  printf '%s%s' "$PREFIX" "$1"
}

CONFIG_FILE="$(prefixed /etc/litestream.yml)"
CONFIG_DIRECTORY="$(prefixed /etc/tan-studio)"
CREDENTIAL_FILE="$CONFIG_DIRECTORY/litestream-gcs.json"
UNIT_DIRECTORY="$(prefixed /etc/systemd/system)"
BINARY_DIRECTORY="$(prefixed /usr/local/bin)"
BINARY="$BINARY_DIRECTORY/litestream"

if [[ ! -f "$SOURCE_DIRECTORY/litestream.yml" ]] ||
  [[ ! -f "$SOURCE_DIRECTORY/litestream.service" ]]; then
  echo "The Litestream install source is incomplete" >&2
  exit 2
fi

install -d -m 0755 "$UNIT_DIRECTORY" "$BINARY_DIRECTORY"
install -d -m 0750 "$CONFIG_DIRECTORY"
if [[ "$LIVE" == "1" ]]; then
  chown root:root "$CONFIG_DIRECTORY"
fi

if [[ "$LIVE" == "1" ]] && ! getent passwd tan-studio >/dev/null; then
  echo "The tan-studio user does not exist; run install.sh first" >&2
  exit 2
fi

# The credential never lives in the repo. It arrives once, out of band, and is
# copied to a root-owned 0600 file that only systemd reads.
if [[ -n "$CREDENTIAL_SOURCE" ]]; then
  if [[ ! -f "$CREDENTIAL_SOURCE" ]]; then
    echo "TAN_STUDIO_GCS_CREDENTIAL_FILE does not exist: $CREDENTIAL_SOURCE" >&2
    exit 2
  fi
  CREDENTIAL_STAGING="$CONFIG_DIRECTORY/.litestream-gcs-$$.json"
  install -m 0600 "$CREDENTIAL_SOURCE" "$CREDENTIAL_STAGING"
  if [[ "$LIVE" == "1" ]]; then
    chown root:root "$CREDENTIAL_STAGING"
  fi
  mv "$CREDENTIAL_STAGING" "$CREDENTIAL_FILE"
elif [[ ! -f "$CREDENTIAL_FILE" ]]; then
  echo "No GCS credential installed; set TAN_STUDIO_GCS_CREDENTIAL_FILE" >&2
  exit 2
fi
chmod 0600 "$CREDENTIAL_FILE"

install -m 0644 "$SOURCE_DIRECTORY/litestream.yml" "$CONFIG_FILE"
install -m 0644 "$SOURCE_DIRECTORY/litestream.service" \
  "$UNIT_DIRECTORY/litestream.service"

if [[ "$LIVE" != "1" ]]; then
  printf 'Staged Litestream %s under %s\n' "$LITESTREAM_VERSION" "$PREFIX"
  exit 0
fi

INSTALLED_VERSION=""
if [[ -x "$BINARY" ]]; then
  INSTALLED_VERSION="$("$BINARY" version 2>/dev/null | tr -d 'v \n' || true)"
fi
if [[ "$INSTALLED_VERSION" != "$LITESTREAM_VERSION" ]]; then
  ARCHIVE="litestream-$LITESTREAM_VERSION-$LITESTREAM_ARCHITECTURE.tar.gz"
  BASE_URL="https://github.com/benbjohnson/litestream/releases/download/v$LITESTREAM_VERSION"
  DOWNLOAD_DIRECTORY="$(mktemp -d)"
  trap 'rm -rf "$DOWNLOAD_DIRECTORY"' EXIT
  curl --fail --silent --show-error --location \
    --output "$DOWNLOAD_DIRECTORY/$ARCHIVE" "$BASE_URL/$ARCHIVE"
  curl --fail --silent --show-error --location \
    --output "$DOWNLOAD_DIRECTORY/checksums.txt" "$BASE_URL/checksums.txt"
  (cd "$DOWNLOAD_DIRECTORY" && grep " $ARCHIVE\$" checksums.txt | sha256sum --check --status)
  tar -C "$DOWNLOAD_DIRECTORY" -xzf "$DOWNLOAD_DIRECTORY/$ARCHIVE" litestream
  install -m 0755 -o root -g root "$DOWNLOAD_DIRECTORY/litestream" "$BINARY"
  rm -rf "$DOWNLOAD_DIRECTORY"
  trap - EXIT
fi

systemctl daemon-reload
systemctl enable litestream.service >/dev/null
systemctl restart litestream.service

REPLICATING=0
for _ in {1..30}; do
  if systemctl is-active --quiet litestream.service; then
    REPLICATING=1
    break
  fi
  sleep 1
done
if [[ "$REPLICATING" != "1" ]]; then
  echo "Litestream did not stay running" >&2
  journalctl -u litestream.service --no-pager -n 40 >&2 || true
  exit 1
fi

printf 'Litestream %s is replicating the notebook\n' "$LITESTREAM_VERSION"
