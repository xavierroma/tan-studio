#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIRECTORY="${1:?release source directory is required}"
VERSION="${2:?release version is required}"

if [[ ! "$VERSION" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo "Invalid Tan Studio release version" >&2
  exit 2
fi
if [[ ! -x "$SOURCE_DIRECTORY/bin/tan-studio-service" ]] ||
  [[ ! -f "$SOURCE_DIRECTORY/web/index.html" ]] ||
  [[ ! -f "$SOURCE_DIRECTORY/system/tan-studio.service" ]] ||
  [[ ! -f "$SOURCE_DIRECTORY/system/Caddyfile" ]]; then
  echo "The Tan Studio hosted release is incomplete" >&2
  exit 2
fi

PREFIX="${TAN_STUDIO_INSTALL_ROOT:-}"
LIVE=1
if [[ -n "$PREFIX" ]]; then
  LIVE=0
fi
if [[ "$LIVE" == "1" && "$(id -u)" -ne 0 ]]; then
  echo "Run the hosted installer as root" >&2
  exit 2
fi

prefixed() {
  printf '%s%s' "$PREFIX" "$1"
}

RELEASES_DIRECTORY="$(prefixed /opt/tan-studio/releases)"
CURRENT_LINK="$(prefixed /opt/tan-studio/current)"
RELEASE_DIRECTORY="$RELEASES_DIRECTORY/$VERSION"
STAGING_DIRECTORY="$RELEASES_DIRECTORY/.staging-$VERSION-$$"
STATE_DIRECTORY="$(prefixed /var/lib/tan-studio)"
CONFIG_DIRECTORY="$(prefixed /etc/tan-studio)"
ENVIRONMENT_FILE="$CONFIG_DIRECTORY/environment"
CADDY_DIRECTORY="$(prefixed /etc/caddy)"
SNAPSHOT_DIRECTORY="$STATE_DIRECTORY/backups"
STATE_DATABASE="$STATE_DIRECTORY/tan-studio.sqlite"
# How many pre-deploy snapshots to keep on the VM disk.
SNAPSHOT_KEEP="${TAN_STUDIO_SNAPSHOT_KEEP:-3}"
UNIT_DIRECTORY="$(prefixed /etc/systemd/system)"
PREVIOUS_RELEASE=""

cleanup() {
  if [[ -d "$STAGING_DIRECTORY" ]]; then
    rm -rf "$STAGING_DIRECTORY"
  fi
}
trap cleanup EXIT

kv_from_file() {
  local file="$1"
  local key="$2"
  local value=""
  if [[ -f "$file" ]]; then
    value="$(sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d '\r')"
    if [[ "$value" == \"*\" && "${#value}" -ge 2 ]]; then
      value="${value:1:$((${#value} - 2))}"
    fi
  fi
  printf '%s' "$value"
}

first_set() {
  local value
  for value in "$@"; do
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  printf ''
}

SECRETS_FILE="${TAN_STUDIO_SECRETS_FILE:-}"
if [[ -z "$SECRETS_FILE" && -f "$SOURCE_DIRECTORY/secrets" ]]; then
  SECRETS_FILE="$SOURCE_DIRECTORY/secrets"
fi

CLIENT_ID="$(first_set \
  "${TAN_STUDIO_OIDC_CLIENT_ID:-}" \
  "${GOOGLE_OAUTH_CLIENT_ID:-}" \
  "$(kv_from_file "$SECRETS_FILE" TAN_STUDIO_OIDC_CLIENT_ID)" \
  "$(kv_from_file "$SECRETS_FILE" GOOGLE_OAUTH_CLIENT_ID)" \
  "$(kv_from_file "$ENVIRONMENT_FILE" TAN_STUDIO_OIDC_CLIENT_ID)")"
CLIENT_SECRET="$(first_set \
  "${TAN_STUDIO_OIDC_CLIENT_SECRET:-}" \
  "${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
  "$(kv_from_file "$SECRETS_FILE" TAN_STUDIO_OIDC_CLIENT_SECRET)" \
  "$(kv_from_file "$SECRETS_FILE" GOOGLE_OAUTH_CLIENT_SECRET)" \
  "$(kv_from_file "$ENVIRONMENT_FILE" TAN_STUDIO_OIDC_CLIENT_SECRET)")"
OPERATOR_EMAIL="$(first_set \
  "${TAN_STUDIO_OPERATOR_EMAIL:-}" \
  "${OPERATOR_GOOGLE_EMAIL:-}" \
  "$(kv_from_file "$SECRETS_FILE" TAN_STUDIO_OPERATOR_EMAIL)" \
  "$(kv_from_file "$SECRETS_FILE" OPERATOR_GOOGLE_EMAIL)" \
  "$(kv_from_file "$ENVIRONMENT_FILE" TAN_STUDIO_OPERATOR_EMAIL)")"
SESSION_SECRET="$(first_set \
  "${TAN_STUDIO_SESSION_SECRET:-}" \
  "$(kv_from_file "$SECRETS_FILE" TAN_STUDIO_SESSION_SECRET)" \
  "$(kv_from_file "$ENVIRONMENT_FILE" TAN_STUDIO_SESSION_SECRET)")"

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" || -z "$OPERATOR_EMAIL" ]]; then
  echo "Hosted install needs OIDC client id, client secret, and operator email" >&2
  exit 2
fi
if [[ ! "$SESSION_SECRET" =~ ^[a-f0-9]{64}$ ]]; then
  SESSION_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
fi
if [[ ! "$SESSION_SECRET" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Failed to generate TAN_STUDIO_SESSION_SECRET" >&2
  exit 1
fi

if [[ "$LIVE" == "1" ]]; then
  if ! getent group tan-studio >/dev/null; then
    groupadd --system tan-studio
  fi
  if ! id -u tan-studio >/dev/null 2>&1; then
    useradd --system --gid tan-studio --home-dir /var/lib/tan-studio \
      --shell /usr/sbin/nologin tan-studio
  fi
  if ! command -v caddy >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    if ! apt-get install -y -t trixie-backports caddy; then
      apt-get install -y caddy
    fi
  fi
  # sqlite3 takes the pre-deploy snapshot. VACUUM INTO is the only way to get a
  # single consistent file out of a WAL database without copying three of them.
  if ! command -v sqlite3 >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y sqlite3
  fi
fi

install -d -m 0755 "$(prefixed /opt/tan-studio)" "$RELEASES_DIRECTORY" \
  "$CADDY_DIRECTORY" "$UNIT_DIRECTORY"
install -d -m 0750 "$STATE_DIRECTORY" "$CONFIG_DIRECTORY"
if [[ "$LIVE" == "1" ]]; then
  chown tan-studio:tan-studio "$STATE_DIRECTORY"
  chown root:root "$CONFIG_DIRECTORY"
fi

if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || readlink "$CURRENT_LINK")"
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
  if [[ "$LIVE" == "1" ]]; then
    chown -R root:root "$STAGING_DIRECTORY"
  fi
  mv "$STAGING_DIRECTORY" "$RELEASE_DIRECTORY"
fi

ENVIRONMENT_STAGING="$CONFIG_DIRECTORY/.environment-$$"
{
  printf 'TAN_STUDIO_HOSTED=1\n'
  printf 'TAN_STUDIO_BIND_HOST=127.0.0.1\n'
  printf 'TAN_STUDIO_PORT=8080\n'
  printf 'TAN_STUDIO_DATABASE_PATH=/var/lib/tan-studio/tan-studio.sqlite\n'
  printf 'TAN_STUDIO_WEB_ROOT=/opt/tan-studio/current/web\n'
  printf 'TAN_STUDIO_VERSION=%s\n' "$VERSION"
  printf 'TAN_STUDIO_PUBLIC_ORIGIN=https://studio.tan.coffee\n'
  printf 'TAN_STUDIO_OIDC_ISSUER=https://accounts.google.com\n'
  printf 'TAN_STUDIO_OIDC_REDIRECT_URI=https://studio.tan.coffee/auth/google/callback\n'
  printf 'TAN_STUDIO_OIDC_CLIENT_ID=%s\n' "$CLIENT_ID"
  printf 'TAN_STUDIO_OIDC_CLIENT_SECRET=%s\n' "$CLIENT_SECRET"
  printf 'TAN_STUDIO_OPERATOR_EMAIL=%s\n' "$OPERATOR_EMAIL"
  printf 'TAN_STUDIO_SESSION_SECRET=%s\n' "$SESSION_SECRET"
} > "$ENVIRONMENT_STAGING"
chmod 0600 "$ENVIRONMENT_STAGING"
if [[ "$LIVE" == "1" ]]; then
  chown root:root "$ENVIRONMENT_STAGING"
fi
mv "$ENVIRONMENT_STAGING" "$ENVIRONMENT_FILE"

install -m 0644 "$SOURCE_DIRECTORY/system/tan-studio.service" \
  "$UNIT_DIRECTORY/tan-studio.service"
sed "s|__ACME_EMAIL__|$OPERATOR_EMAIL|" "$SOURCE_DIRECTORY/system/Caddyfile" \
  > "$CADDY_DIRECTORY/.Caddyfile-$$"
chmod 0644 "$CADDY_DIRECTORY/.Caddyfile-$$"
mv "$CADDY_DIRECTORY/.Caddyfile-$$" "$CADDY_DIRECTORY/Caddyfile"

# Stop before snapshotting: the notebook runs SQLite in WAL mode, so a copy
# taken under a live writer can tear, and the -wal sidecar holds commits not
# yet checkpointed into the main file.
if [[ "$LIVE" == "1" ]]; then
  systemctl stop tan-studio.service 2>/dev/null || true
fi

if [[ -f "$STATE_DATABASE" ]]; then
  # A release-labelled restore point for the one failure Litestream is
  # awkward for: a deploy that corrupts data, where you must land just
  # before a known release rather than guess a timestamp. Litestream
  # remains the off-box copy; these snapshots share the notebook's disk
  # and are not a substitute for it.
  if [[ "$LIVE" == "1" ]]; then
    install -d -o tan-studio -g tan-studio -m 0750 "$SNAPSHOT_DIRECTORY"
  else
    install -d -m 0750 "$SNAPSHOT_DIRECTORY"
  fi
  SNAPSHOT_CANDIDATE="$SNAPSHOT_DIRECTORY/.candidate-$$.sqlite"
  rm -f "$SNAPSHOT_CANDIDATE"
  # VACUUM INTO on a stopped database: one file, already checkpointed, and
  # smaller than the original because it is written fresh.
  sqlite3 "$STATE_DATABASE" \
    "VACUUM INTO '$SNAPSHOT_CANDIDATE'"
  SNAPSHOT_DIGEST="$(sha256sum "$SNAPSHOT_CANDIDATE" | cut -d' ' -f1)"
  NEWEST_DIGEST_FILE="$(find "$SNAPSHOT_DIRECTORY" -maxdepth 1 -name '*.sha256' \
    -type f -print0 2>/dev/null | xargs -0 -r ls -1t 2>/dev/null | head -n 1)"
  NEWEST_DIGEST=""
  if [[ -n "$NEWEST_DIGEST_FILE" && -f "$NEWEST_DIGEST_FILE" ]]; then
    NEWEST_DIGEST="$(cut -d' ' -f1 < "$NEWEST_DIGEST_FILE")"
  fi
  if [[ "$SNAPSHOT_DIGEST" == "$NEWEST_DIGEST" ]]; then
    # Nothing was written since the last deploy. Keeping a byte-identical
    # second copy would only spend disk and push a real restore point out
    # of the retention window.
    rm -f "$SNAPSHOT_CANDIDATE"
    printf 'Notebook unchanged since the last snapshot; kept %s\n' \
      "$(basename "${NEWEST_DIGEST_FILE%.sha256}")"
  else
    SNAPSHOT_NAME="$(date -u +%Y%m%dT%H%M%SZ)-$VERSION"
    mv "$SNAPSHOT_CANDIDATE" "$SNAPSHOT_DIRECTORY/$SNAPSHOT_NAME.sqlite"
    printf '%s  %s\n' "$SNAPSHOT_DIGEST" "$SNAPSHOT_NAME.sqlite" \
      > "$SNAPSHOT_DIRECTORY/$SNAPSHOT_NAME.sha256"
    if [[ "$LIVE" == "1" ]]; then
      chown tan-studio:tan-studio \
        "$SNAPSHOT_DIRECTORY/$SNAPSHOT_NAME.sqlite" \
        "$SNAPSHOT_DIRECTORY/$SNAPSHOT_NAME.sha256"
    fi
    chmod 0640 \
      "$SNAPSHOT_DIRECTORY/$SNAPSHOT_NAME.sqlite" \
      "$SNAPSHOT_DIRECTORY/$SNAPSHOT_NAME.sha256"
  fi
  # Bounded on purpose. These live on the same 10 GB disk as the notebook,
  # so an unbounded history would eventually fill the disk and take the
  # service down -- a backup that causes the outage it exists to survive.
  find "$SNAPSHOT_DIRECTORY" -maxdepth 1 -name '*.sqlite' -type f -print0 \
    | xargs -0 -r ls -1t 2>/dev/null \
    | tail -n +$((SNAPSHOT_KEEP + 1)) \
    | while read -r STALE; do
      rm -f "$STALE" "${STALE%.sqlite}.sha256"
    done
fi

ln -sfn "$RELEASE_DIRECTORY" "$CURRENT_LINK"

if [[ "$LIVE" != "1" ]]; then
  printf 'Installed Tan Studio %s\n' "$VERSION"
  exit 0
fi

caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl daemon-reload
systemctl enable caddy.service >/dev/null
systemctl enable tan-studio.service >/dev/null
systemctl restart tan-studio.service
systemctl restart caddy.service

HEALTHY=0
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 2 \
    --header 'Host: studio.tan.coffee' http://127.0.0.1:8080/healthz >/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" != "1" ]]; then
  systemctl stop tan-studio.service || true
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    systemctl restart tan-studio.service || true
  fi
  echo "Tan Studio failed its post-deployment health check" >&2
  journalctl -u tan-studio.service --no-pager -n 40 >&2 || true
  exit 1
fi

HTTPS_HEALTHY=0
for _ in {1..45}; do
  if curl --fail --silent --show-error --max-time 5 \
    --header 'Host: studio.tan.coffee' https://studio.tan.coffee/healthz >/dev/null; then
    HTTPS_HEALTHY=1
    break
  fi
  sleep 2
done
if [[ "$HTTPS_HEALTHY" != "1" ]]; then
  echo "Caddy did not serve https://studio.tan.coffee/healthz" >&2
  journalctl -u caddy.service --no-pager -n 40 >&2 || true
  exit 1
fi

printf 'Installed Tan Studio %s\n' "$VERSION"
