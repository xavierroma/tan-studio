#!/usr/bin/env bash
set -euo pipefail

ROOT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOSTED_DIRECTORY="$ROOT_DIRECTORY/deploy/hosted"
SCRIPT_DIRECTORY="$ROOT_DIRECTORY/script"
FAILS=0

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  FAILS=$((FAILS + 1))
}

pass() {
  printf 'PASS: %s\n' "$*"
}

require_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    pass "exists ${path#"$ROOT_DIRECTORY"/}"
  else
    fail "missing ${path#"$ROOT_DIRECTORY"/}"
  fi
}

require_match() {
  local path="$1"
  local pattern="$2"
  local label="$3"
  if [[ ! -f "$path" ]]; then
    fail "cannot match $label; missing ${path#"$ROOT_DIRECTORY"/}"
    return
  fi
  if grep -Eq "$pattern" "$path"; then
    pass "$label"
  else
    fail "$label (pattern $pattern)"
  fi
}

forbid_match() {
  local path="$1"
  local pattern="$2"
  local label="$3"
  if [[ ! -f "$path" ]]; then
    fail "cannot check $label; missing ${path#"$ROOT_DIRECTORY"/}"
    return
  fi
  if grep -Eq "$pattern" "$path"; then
    fail "$label"
  else
    pass "$label"
  fi
}

CADDYFILE="$HOSTED_DIRECTORY/Caddyfile"
UNIT="$HOSTED_DIRECTORY/tan-studio.service"
INSTALLER="$HOSTED_DIRECTORY/install.sh"
DOCKERFILE="$HOSTED_DIRECTORY/Dockerfile"
BUILD_SCRIPT="$SCRIPT_DIRECTORY/build_hosted_release.sh"
DEPLOY_SCRIPT="$SCRIPT_DIRECTORY/deploy_hosted.sh"
BACKUP_CONFIG="$HOSTED_DIRECTORY/litestream.yml"
BACKUP_UNIT="$HOSTED_DIRECTORY/litestream.service"
BACKUP_INSTALLER="$HOSTED_DIRECTORY/install_litestream.sh"
RESTORE_SCRIPT="$HOSTED_DIRECTORY/restore_notebook.sh"

require_file "$CADDYFILE"
require_file "$UNIT"
require_file "$INSTALLER"
require_file "$DOCKERFILE"
require_file "$BUILD_SCRIPT"
require_file "$DEPLOY_SCRIPT"
require_file "$BACKUP_CONFIG"
require_file "$BACKUP_UNIT"
require_file "$BACKUP_INSTALLER"
require_file "$RESTORE_SCRIPT"

for script in "$INSTALLER" "$BUILD_SCRIPT" "$DEPLOY_SCRIPT" "$BACKUP_INSTALLER" \
  "$RESTORE_SCRIPT" "$HOSTED_DIRECTORY/test.sh"; do
  if [[ -f "$script" ]]; then
    if bash -n "$script"; then
      pass "bash -n ${script#"$ROOT_DIRECTORY"/}"
    else
      fail "bash -n ${script#"$ROOT_DIRECTORY"/}"
    fi
  fi
done

if command -v shellcheck >/dev/null 2>&1; then
  SHELLCHECK_FILES=()
  for script in "$INSTALLER" "$BUILD_SCRIPT" "$DEPLOY_SCRIPT" "$BACKUP_INSTALLER" \
    "$RESTORE_SCRIPT" "$HOSTED_DIRECTORY/test.sh"; do
    if [[ -f "$script" ]]; then
      SHELLCHECK_FILES+=("$script")
    fi
  done
  if [[ ${#SHELLCHECK_FILES[@]} -gt 0 ]]; then
    if shellcheck --external-sources "${SHELLCHECK_FILES[@]}"; then
      pass "shellcheck hosted scripts"
    else
      fail "shellcheck hosted scripts"
    fi
  fi
fi

require_match "$CADDYFILE" 'studio\.tan\.coffee' 'Caddyfile serves studio.tan.coffee'
require_match "$CADDYFILE" 'http://studio\.tan\.coffee' 'Caddyfile defines the HTTP site'
require_match "$CADDYFILE" 'redir https://studio\.tan\.coffee' 'Caddyfile redirects HTTP to HTTPS'
# The bridge does not speak HTTP to this origin: it dials a plaintext TCP port
# and the service rejects non-private peers (ADR 0005). A proxy route for it
# would forward to a path the service does not serve.
forbid_match "$CADDYFILE" '/device/v1/session' 'Caddyfile does not proxy a bridge session route'

require_match "$UNIT" '^ExecStart=/opt/tan-studio/current/bin/tan-studio-service$' \
  'unit starts the current-release binary'
require_match "$UNIT" '^EnvironmentFile=/etc/tan-studio/environment$' \
  'unit loads secrets from EnvironmentFile'
require_match "$UNIT" '^WantedBy=multi-user.target$' 'unit is enabled on boot'
require_match "$UNIT" '^Restart=' 'unit restarts after failure'
require_match "$UNIT" '^After=network-online.target$' 'unit waits for network'
forbid_match "$UNIT" '/opt/tan-studio/releases/' 'unit has no versioned release path'
forbid_match "$UNIT" 'CLIENT_SECRET|SESSION_SECRET|GOOGLE_OAUTH' \
  'unit file does not embed OIDC or session secrets'

require_match "$INSTALLER" 'GOOGLE_OAUTH_CLIENT_ID' 'installer accepts repo-root Google client id'
require_match "$INSTALLER" 'GOOGLE_OAUTH_CLIENT_SECRET' 'installer accepts repo-root Google client secret'
require_match "$INSTALLER" 'OPERATOR_GOOGLE_EMAIL' 'installer accepts operator email'
require_match "$INSTALLER" 'TAN_STUDIO_OIDC_CLIENT_ID' 'installer writes hosted OIDC client id'
require_match "$INSTALLER" 'TAN_STUDIO_OIDC_CLIENT_SECRET' 'installer writes hosted OIDC client secret'
require_match "$INSTALLER" 'TAN_STUDIO_OPERATOR_EMAIL' 'installer writes hosted operator email'
require_match "$INSTALLER" 'TAN_STUDIO_SESSION_SECRET' 'installer writes session secret'
require_match "$INSTALLER" 'systemctl enable caddy' 'installer enables Caddy on boot'
require_match "$INSTALLER" 'systemctl enable tan-studio' 'installer enables the service on boot'

require_match "$INSTALLER" 'VACUUM INTO' \
  'installer takes a consistent single-file snapshot'

forbid_match "$DEPLOY_SCRIPT" 'rsync' \
  'deploy script does not require rsync on the VM'
require_match "$DEPLOY_SCRIPT" 'tar -C' 'deploy script ships the release with tar'
# Ordering matters more than any other line in the installer: snapshotting a
# database the service is still writing to can tear it. Match executable lines
# only -- an earlier grep here matched a comment and silently inverted itself.
installer_line() {
  grep -nE "$1" "$INSTALLER" | grep -vE '^[0-9]+: *#' | head -n 1 | cut -d: -f1
}
STOP_LINE="$(installer_line 'systemctl stop tan-studio')"
BACKUP_LINE="$(installer_line "VACUUM INTO '")"
if [[ -n "$STOP_LINE" && -n "$BACKUP_LINE" && "$STOP_LINE" -lt "$BACKUP_LINE" ]]; then
  pass 'installer stops the service before snapshotting the database'
else
  fail 'installer snapshots the database while the service may still be writing'
fi

forbid_match "$DOCKERFILE" '\.env' 'Dockerfile does not copy .env'
require_match "$DOCKERFILE" 'linux/amd64|FROM rust:' 'Dockerfile builds the hosted linux binary'
require_match "$DOCKERFILE" 'Caddyfile' 'Dockerfile ships the Caddyfile'
require_match "$DOCKERFILE" 'tan-studio.service' 'Dockerfile ships the systemd unit'

if [[ -x "$INSTALLER" || -f "$INSTALLER" ]]; then
  TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tan-hosted-install.XXXXXX")"
  SOURCE_DIRECTORY="$TEST_ROOT/source"
  cleanup_test_root() {
    rm -rf "$TEST_ROOT"
  }
  trap cleanup_test_root EXIT

  mkdir -p "$SOURCE_DIRECTORY/bin" "$SOURCE_DIRECTORY/web" "$SOURCE_DIRECTORY/system"
  printf '#!/bin/sh\nexit 0\n' > "$SOURCE_DIRECTORY/bin/tan-studio-service"
  chmod 0755 "$SOURCE_DIRECTORY/bin/tan-studio-service"
  printf '<html>Tan Studio</html>\n' > "$SOURCE_DIRECTORY/web/index.html"
  printf 'test-version-1\n' > "$SOURCE_DIRECTORY/VERSION"
  if [[ -f "$CADDYFILE" ]]; then
    cp "$CADDYFILE" "$SOURCE_DIRECTORY/system/Caddyfile"
  else
    printf 'studio.tan.coffee {\n}\n' > "$SOURCE_DIRECTORY/system/Caddyfile"
  fi
  if [[ -f "$UNIT" ]]; then
    cp "$UNIT" "$SOURCE_DIRECTORY/system/tan-studio.service"
  else
    printf '[Service]\nExecStart=/opt/tan-studio/current/bin/tan-studio-service\n' \
      > "$SOURCE_DIRECTORY/system/tan-studio.service"
  fi

  INSTALL_ROOT="$TEST_ROOT/root"
  if TAN_STUDIO_INSTALL_ROOT="$INSTALL_ROOT" "$INSTALLER" "$SOURCE_DIRECTORY" "test-version-1" \
    >/dev/null 2>"$TEST_ROOT/first-missing.log"; then
    fail 'installer requires OIDC secrets on first install'
  else
    pass 'installer requires OIDC secrets on first install'
  fi

  if ! TAN_STUDIO_INSTALL_ROOT="$INSTALL_ROOT" \
    GOOGLE_OAUTH_CLIENT_ID='hosted-client-id' \
    GOOGLE_OAUTH_CLIENT_SECRET='hosted-client-secret' \
    OPERATOR_GOOGLE_EMAIL='operator@example.com' \
    "$INSTALLER" "$SOURCE_DIRECTORY" "test-version-1" >"$TEST_ROOT/first-install.log" 2>&1; then
    fail "first install with mapped Google secrets failed: $(tr '\n' ' ' < "$TEST_ROOT/first-install.log")"
  else
    pass 'first install with mapped Google secrets'
  fi

  ENV_FILE="$INSTALL_ROOT/etc/tan-studio/environment"
  if [[ -f "$ENV_FILE" ]]; then
    env_has() {
      grep -Eq "^$1=$2$" "$ENV_FILE"
    }
    require_env() {
      if env_has "$1" "$2"; then
        pass "$3"
      else
        fail "$3"
      fi
    }
    require_env TAN_STUDIO_HOSTED 1 'env TAN_STUDIO_HOSTED=1'
    require_env TAN_STUDIO_BIND_HOST '127.0.0.1' 'env binds loopback'
    require_env TAN_STUDIO_PORT 8080 'env TAN_STUDIO_PORT=8080'
    require_env TAN_STUDIO_PUBLIC_ORIGIN 'https://studio.tan.coffee' 'env public origin'
    require_env TAN_STUDIO_OIDC_ISSUER 'https://accounts.google.com' 'env Google issuer'
    require_env TAN_STUDIO_OIDC_REDIRECT_URI 'https://studio.tan.coffee/auth/google/callback' \
      'env Google redirect'
    require_env TAN_STUDIO_OIDC_CLIENT_ID 'hosted-client-id' 'maps GOOGLE_OAUTH_CLIENT_ID'
    require_env TAN_STUDIO_OIDC_CLIENT_SECRET 'hosted-client-secret' 'maps GOOGLE_OAUTH_CLIENT_SECRET'
    require_env TAN_STUDIO_OPERATOR_EMAIL 'operator@example.com' 'maps OPERATOR_GOOGLE_EMAIL'
    require_env TAN_STUDIO_DATABASE_PATH '/var/lib/tan-studio/tan-studio.sqlite' 'env database path'
    require_env TAN_STUDIO_WEB_ROOT '/opt/tan-studio/current/web' 'env web root uses current symlink'
    SESSION_SECRET="$(sed -n 's/^TAN_STUDIO_SESSION_SECRET=//p' "$ENV_FILE" | head -n 1)"
    if [[ "$SESSION_SECRET" =~ ^[a-f0-9]{64}$ ]]; then
      pass 'generated 64-hex session secret'
    else
      fail 'generated 64-hex session secret'
    fi
    if grep -Eq 'GOOGLE_OAUTH_|OPERATOR_GOOGLE_EMAIL' "$ENV_FILE"; then
      fail 'environment file keeps repo-root secret names'
    else
      pass 'environment file uses TAN_STUDIO_* names only'
    fi
  else
    fail 'first install wrote /etc/tan-studio/environment'
  fi

  if [[ -L "$INSTALL_ROOT/opt/tan-studio/current" ]]; then
    TARGET="$(readlink "$INSTALL_ROOT/opt/tan-studio/current")"
    if [[ "$TARGET" == "$INSTALL_ROOT/opt/tan-studio/releases/test-version-1" ]] ||
      [[ "$TARGET" == /opt/tan-studio/releases/test-version-1 ]]; then
      pass 'current symlink points at the release'
    else
      # Accept a relative or absolute link into releases/test-version-1
      if [[ "$TARGET" == *"/releases/test-version-1" ]]; then
        pass 'current symlink points at the release'
      else
        fail "current symlink is $TARGET"
      fi
    fi
  else
    fail 'current symlink exists'
  fi

  if [[ -f "$INSTALL_ROOT/etc/caddy/Caddyfile" ]]; then
    pass 'installed Caddyfile'
    # The repo ships a token, not the operator's address. If substitution ever
    # regresses, Caddy gets a literal __ACME_EMAIL__ and certificate contact
    # is silently wrong, so assert both directions.
    forbid_match "$INSTALL_ROOT/etc/caddy/Caddyfile" '__ACME_EMAIL__' \
      'installed Caddyfile has no unsubstituted ACME email token'
    require_match "$INSTALL_ROOT/etc/caddy/Caddyfile" '^\s*email .+@.+$' \
      'installed Caddyfile carries a real ACME email'
  else
    fail 'installed Caddyfile'
  fi
  if [[ -f "$INSTALL_ROOT/etc/systemd/system/tan-studio.service" ]]; then
    pass 'installed systemd unit'
  else
    fail 'installed systemd unit'
  fi

  printf 'test-version-2\n' > "$SOURCE_DIRECTORY/VERSION"
  if ! TAN_STUDIO_INSTALL_ROOT="$INSTALL_ROOT" \
    "$INSTALLER" "$SOURCE_DIRECTORY" "test-version-2" >"$TEST_ROOT/second-install.log" 2>&1; then
    fail "repeatable install without re-supplying secrets failed: $(tr '\n' ' ' < "$TEST_ROOT/second-install.log")"
  else
    pass 'repeatable install without re-supplying secrets'
  fi

  ENV_FILE="$INSTALL_ROOT/etc/tan-studio/environment"
  if [[ -f "$ENV_FILE" ]]; then
    if grep -Eq '^TAN_STUDIO_OIDC_CLIENT_SECRET=hosted-client-secret$' "$ENV_FILE" &&
      grep -Eq "^TAN_STUDIO_SESSION_SECRET=${SESSION_SECRET}$" "$ENV_FILE" &&
      grep -Eq '^TAN_STUDIO_VERSION=test-version-2$' "$ENV_FILE"; then
      pass 'redeploy preserves secrets and updates version'
    else
      fail 'redeploy preserves secrets and updates version'
    fi
  fi

  INSTALLED_UNIT="$INSTALL_ROOT/etc/systemd/system/tan-studio.service"
  if [[ -f "$INSTALLED_UNIT" ]] && grep -Eq '^ExecStart=/opt/tan-studio/current/bin/tan-studio-service$' "$INSTALLED_UNIT"; then
    pass 'redeploy does not require hand-editing the unit'
  else
    fail 'redeploy does not require hand-editing the unit'
  fi

  if [[ -L "$INSTALL_ROOT/opt/tan-studio/current" ]]; then
    TARGET="$(readlink "$INSTALL_ROOT/opt/tan-studio/current")"
    if [[ "$TARGET" == *"/releases/test-version-2" ]]; then
      pass 'redeploy switches the current symlink'
    else
      fail "redeploy current symlink is $TARGET"
    fi
  fi


  # Snapshot retention. These share the notebook's disk, so an unbounded
  # history would eventually fill it and cause the outage backups exist to
  # survive. Drive the installer repeatedly against a changing database.
  if command -v sqlite3 >/dev/null 2>&1; then
    SNAPSHOT_STATE="$INSTALL_ROOT/var/lib/tan-studio"
    SNAPSHOT_DIR="$SNAPSHOT_STATE/backups"
    mkdir -p "$SNAPSHOT_STATE"
    sqlite3 "$SNAPSHOT_STATE/tan-studio.sqlite" \
      'CREATE TABLE IF NOT EXISTS roast(id INTEGER PRIMARY KEY); INSERT INTO roast DEFAULT VALUES;'

    snapshot_count() {
      find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.sqlite' -type f 2>/dev/null | wc -l | tr -d ' '
    }

    run_install() {
      TAN_STUDIO_INSTALL_ROOT="$INSTALL_ROOT" TAN_STUDIO_SNAPSHOT_KEEP=2 \
        "$INSTALLER" "$SOURCE_DIRECTORY" "$1" >/dev/null 2>&1
    }

    run_install snap-1
    FIRST_COUNT="$(snapshot_count)"
    if [[ "$FIRST_COUNT" == "1" ]]; then
      pass 'first deploy writes a snapshot'
    else
      fail "first deploy wrote $FIRST_COUNT snapshots"
    fi

    # Same bytes, so a second deploy must not spend disk on a duplicate.
    run_install snap-2
    if [[ "$(snapshot_count)" == "1" ]]; then
      pass 'unchanged notebook does not create a second snapshot'
    else
      fail 'unchanged notebook created a redundant snapshot'
    fi

    for VERSION_LABEL in snap-3 snap-4 snap-5; do
      sqlite3 "$SNAPSHOT_STATE/tan-studio.sqlite" 'INSERT INTO roast DEFAULT VALUES;'
      sleep 1
      run_install "$VERSION_LABEL"
    done
    FINAL_COUNT="$(snapshot_count)"
    if [[ "$FINAL_COUNT" == "2" ]]; then
      pass 'snapshot history is bounded by TAN_STUDIO_SNAPSHOT_KEEP'
    else
      fail "snapshot history kept $FINAL_COUNT, expected 2"
    fi

    ORPHANS="$(find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.sha256' -type f 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "$ORPHANS" == "$FINAL_COUNT" ]]; then
      pass 'pruning removes each snapshot digest with its snapshot'
    else
      fail "found $ORPHANS digests for $FINAL_COUNT snapshots"
    fi

    NEWEST_SNAPSHOT="$(find "$SNAPSHOT_DIR" -maxdepth 1 -name '*.sqlite' -type f -print0 \
      | xargs -0 -r ls -1t | head -n 1)"
    if sqlite3 "$NEWEST_SNAPSHOT" 'PRAGMA integrity_check;' 2>/dev/null | grep -q '^ok$'; then
      pass 'snapshot is a valid SQLite database'
    else
      fail 'snapshot failed integrity_check'
    fi
    if [[ "$(sqlite3 "$NEWEST_SNAPSHOT" 'SELECT count(*) FROM roast;' 2>/dev/null)" == "4" ]]; then
      pass 'snapshot carries the rows written before the deploy'
    else
      fail 'snapshot lost rows written before the deploy'
    fi
  fi

  trap - EXIT
  cleanup_test_root
fi

require_match "$BACKUP_CONFIG" '^\s+- path: /var/lib/tan-studio/tan-studio\.sqlite$' \
  'backup config replicates the hosted notebook'
require_match "$BACKUP_CONFIG" 'url: gs://[a-z0-9-]+/' \
  'backup config targets a Cloud Storage prefix'
require_match "$BACKUP_CONFIG" 'sync-interval:' 'backup config bounds the sync interval'

require_match "$BACKUP_UNIT" '^ExecStart=/usr/local/bin/litestream replicate' \
  'backup unit runs Litestream as its own process'
require_match "$BACKUP_UNIT" '^WantedBy=multi-user.target$' 'backup unit is enabled on boot'
require_match "$BACKUP_UNIT" '^Restart=always$' 'backup unit outlives a notebook redeploy'
require_match "$BACKUP_UNIT" '^After=network-online.target$' 'backup unit waits for network'
require_match "$BACKUP_UNIT" '^LoadCredential=gcs.json:/etc/tan-studio/litestream-gcs.json$' \
  'backup unit reads the credential through systemd'
require_match "$BACKUP_UNIT" '^Environment=GOOGLE_APPLICATION_CREDENTIALS=%d/gcs.json$' \
  'backup unit points Litestream at the loaded credential'
require_match "$BACKUP_UNIT" '^ReadWritePaths=/var/lib/tan-studio$' \
  'backup unit may write only the notebook directory'

# The credential must never ride along in the repo, in any of these files.
for candidate in "$BACKUP_CONFIG" "$BACKUP_UNIT" "$BACKUP_INSTALLER" "$RESTORE_SCRIPT"; do
  forbid_match "$candidate" 'BEGIN [A-Z ]*PRIVATE KEY|"private_key"|gserviceaccount\.com' \
    "no GCS credential material in ${candidate#"$ROOT_DIRECTORY"/}"
done

require_match "$RESTORE_SCRIPT" 'Refusing to restore over the live notebook' \
  'restore script refuses to overwrite the live notebook'
require_match "$RESTORE_SCRIPT" 'PRAGMA integrity_check' \
  'restore script verifies the restored file'
require_match "$RESTORE_SCRIPT" 'FROM schema_migrations' \
  'restore script checks the restored notebook has a schema'

forbid_match "$INSTALLER" 'systemctl (stop|disable) litestream' \
  'deploying a release does not stop replication'

BACKUP_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tan-hosted-backup.XXXXXX")"
cleanup_backup_root() {
  rm -rf "$BACKUP_TEST_ROOT"
}
trap cleanup_backup_root EXIT

RESTORE_LOG="$BACKUP_TEST_ROOT/restore-live.log"
if "$RESTORE_SCRIPT" /var/lib/tan-studio/tan-studio.sqlite >"$RESTORE_LOG" 2>&1; then
  fail 'restore script rejects the live notebook as a destination'
elif grep -q 'Refusing to restore over the live notebook' "$RESTORE_LOG"; then
  pass 'restore script rejects the live notebook as a destination'
else
  fail "restore script rejected the live notebook for the wrong reason: $(tr '\n' ' ' < "$RESTORE_LOG")"
fi

BACKUP_INSTALL_ROOT="$BACKUP_TEST_ROOT/root"
if TAN_STUDIO_INSTALL_ROOT="$BACKUP_INSTALL_ROOT" "$BACKUP_INSTALLER" \
  >"$BACKUP_TEST_ROOT/no-credential.log" 2>&1; then
  fail 'backup installer requires a credential on first install'
else
  pass 'backup installer requires a credential on first install'
fi

FAKE_CREDENTIAL="$BACKUP_TEST_ROOT/fake-key.json"
printf '{"type":"service_account"}\n' > "$FAKE_CREDENTIAL"
if ! TAN_STUDIO_INSTALL_ROOT="$BACKUP_INSTALL_ROOT" \
  TAN_STUDIO_GCS_CREDENTIAL_FILE="$FAKE_CREDENTIAL" \
  "$BACKUP_INSTALLER" >"$BACKUP_TEST_ROOT/install.log" 2>&1; then
  fail "backup install failed: $(tr '\n' ' ' < "$BACKUP_TEST_ROOT/install.log")"
else
  pass 'backup install stages config, unit, and credential'
fi

INSTALLED_CREDENTIAL="$BACKUP_INSTALL_ROOT/etc/tan-studio/litestream-gcs.json"
if [[ -f "$BACKUP_INSTALL_ROOT/etc/litestream.yml" ]]; then
  pass 'installed Litestream config'
else
  fail 'installed Litestream config'
fi
if [[ -f "$BACKUP_INSTALL_ROOT/etc/systemd/system/litestream.service" ]]; then
  pass 'installed Litestream unit'
else
  fail 'installed Litestream unit'
fi
if [[ -f "$INSTALLED_CREDENTIAL" ]]; then
  CREDENTIAL_MODE="$(stat -f '%OLp' "$INSTALLED_CREDENTIAL" 2>/dev/null ||
    stat -c '%a' "$INSTALLED_CREDENTIAL")"
  if [[ "$CREDENTIAL_MODE" == "600" ]]; then
    pass 'credential is installed mode 0600'
  else
    fail "credential is installed mode $CREDENTIAL_MODE"
  fi
else
  fail 'credential is installed'
fi

if TAN_STUDIO_INSTALL_ROOT="$BACKUP_INSTALL_ROOT" "$BACKUP_INSTALLER" \
  >"$BACKUP_TEST_ROOT/reinstall.log" 2>&1; then
  pass 'backup reinstall reuses the installed credential'
else
  fail "backup reinstall reuses the installed credential: $(tr '\n' ' ' < "$BACKUP_TEST_ROOT/reinstall.log")"
fi

trap - EXIT
cleanup_backup_root

if [[ "$FAILS" -ne 0 ]]; then
  printf '%s hosted deploy check(s) failed\n' "$FAILS" >&2
  exit 1
fi
printf 'hosted deploy checks passed\n'
