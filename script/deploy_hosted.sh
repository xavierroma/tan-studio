#!/usr/bin/env bash
set -euo pipefail

ROOT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOSTED_SSH="${TAN_STUDIO_HOSTED_SSH:-xavi@136.67.36.35}"
SSH_KEY="${TAN_STUDIO_HOSTED_SSH_KEY:-$HOME/.ssh/id_ed25519_tan_studio}"
ENV_FILE="${TAN_STUDIO_ENV_FILE:-$ROOT_DIRECTORY/.env}"
GCP_PROJECT="${TAN_STUDIO_GCP_PROJECT:-tan-coffee}"
COMMIT="$(git -C "$ROOT_DIRECTORY" rev-parse --short=12 HEAD)"

# Untracked files are excluded from the build context by .dockerignore, so the
# release is a function of the tracked tree alone and only tracked edits make a
# version dirty.
if [[ -z "$(git -C "$ROOT_DIRECTORY" status --porcelain --untracked-files=no)" ]]; then
  VERSION="$COMMIT"
else
  VERSION="$COMMIT-dirty-$(date -u +%Y%m%d%H%M%S)"
fi

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

secret_manager() {
  local name="$1"
  if ! command -v gcloud >/dev/null 2>&1; then
    return 0
  fi
  gcloud secrets versions access latest --secret="$name" --project="$GCP_PROJECT" \
    2>/dev/null || true
}

CLIENT_ID="$(first_set \
  "${TAN_STUDIO_OIDC_CLIENT_ID:-}" \
  "${GOOGLE_OAUTH_CLIENT_ID:-}" \
  "$(kv_from_file "$ENV_FILE" TAN_STUDIO_OIDC_CLIENT_ID)" \
  "$(kv_from_file "$ENV_FILE" GOOGLE_OAUTH_CLIENT_ID)" \
  "$(secret_manager google-oauth-client-id)")"
CLIENT_SECRET="$(first_set \
  "${TAN_STUDIO_OIDC_CLIENT_SECRET:-}" \
  "${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
  "$(kv_from_file "$ENV_FILE" TAN_STUDIO_OIDC_CLIENT_SECRET)" \
  "$(kv_from_file "$ENV_FILE" GOOGLE_OAUTH_CLIENT_SECRET)" \
  "$(secret_manager google-oauth-client-secret)")"
OPERATOR_EMAIL="$(first_set \
  "${TAN_STUDIO_OPERATOR_EMAIL:-}" \
  "${OPERATOR_GOOGLE_EMAIL:-}" \
  "$(kv_from_file "$ENV_FILE" TAN_STUDIO_OPERATOR_EMAIL)" \
  "$(kv_from_file "$ENV_FILE" OPERATOR_GOOGLE_EMAIL)")"
SESSION_SECRET="$(first_set \
  "${TAN_STUDIO_SESSION_SECRET:-}" \
  "$(kv_from_file "$ENV_FILE" TAN_STUDIO_SESSION_SECRET)")"

"$ROOT_DIRECTORY/script/build_hosted_release.sh" "$VERSION"
RELEASE_DIRECTORY="$ROOT_DIRECTORY/dist/hosted/$VERSION"
REMOTE_DIRECTORY=""
SECRETS_STAGING=""
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$SECRETS_STAGING" ]]; then
    rm -f -- "$SECRETS_STAGING"
  fi
  if [[ -n "$REMOTE_DIRECTORY" ]]; then
    if ! "${SSH[@]}" "$HOSTED_SSH" "rm -rf -- '$REMOTE_DIRECTORY'"; then
      printf 'Deployment staging cleanup failed; retained at %s:%s\n' "$HOSTED_SSH" "$REMOTE_DIRECTORY" >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# /tmp is RAM-backed on the small hosted VM. Allocate each deployment a private,
# unique directory on disk so concurrent runs cannot delete each other's files.
candidate="$("${SSH[@]}" "$HOSTED_SSH" "set -eu; filesystem=\$(findmnt -n -o FSTYPE --target /var/tmp); case \"\$filesystem\" in tmpfs|ramfs|'') echo 'Deployment staging requires disk-backed /var/tmp' >&2; exit 1;; esac; mktemp -d '/var/tmp/tan-studio-hosted-$VERSION.XXXXXXXX'")"
prefix="/var/tmp/tan-studio-hosted-$VERSION."
suffix="${candidate#"$prefix"}"
if [[ "$candidate" != "$prefix"* || ! "$suffix" =~ ^[[:alnum:]]{8}$ ]]; then
  echo "Unexpected deployment staging path; refusing upload or cleanup" >&2
  exit 1
fi
REMOTE_DIRECTORY="$candidate"
tar -C "$RELEASE_DIRECTORY" -cf - . |
  "${SSH[@]}" "$HOSTED_SSH" "tar -C '$REMOTE_DIRECTORY' -xf -"
"${SSH[@]}" "$HOSTED_SSH" \
  "chmod 0755 '$REMOTE_DIRECTORY/bin/tan-studio-service' '$REMOTE_DIRECTORY/install.sh'"

if [[ -n "$CLIENT_ID" || -n "$CLIENT_SECRET" || -n "$OPERATOR_EMAIL" || -n "$SESSION_SECRET" ]]; then
  umask 077
  SECRETS_STAGING="$(mktemp)"
  {
    if [[ -n "$CLIENT_ID" ]]; then
      printf 'TAN_STUDIO_OIDC_CLIENT_ID=%s\n' "$CLIENT_ID"
    fi
    if [[ -n "$CLIENT_SECRET" ]]; then
      printf 'TAN_STUDIO_OIDC_CLIENT_SECRET=%s\n' "$CLIENT_SECRET"
    fi
    if [[ -n "$OPERATOR_EMAIL" ]]; then
      printf 'TAN_STUDIO_OPERATOR_EMAIL=%s\n' "$OPERATOR_EMAIL"
    fi
    if [[ -n "$SESSION_SECRET" ]]; then
      printf 'TAN_STUDIO_SESSION_SECRET=%s\n' "$SESSION_SECRET"
    fi
  } > "$SECRETS_STAGING"
  chmod 0600 "$SECRETS_STAGING"
  "${SSH[@]}" "$HOSTED_SSH" \
    "umask 077; cat > '$REMOTE_DIRECTORY/secrets'" < "$SECRETS_STAGING"
  rm -f "$SECRETS_STAGING"
  SECRETS_STAGING=""
fi

"${SSH[@]}" "$HOSTED_SSH" \
  "sudo '$REMOTE_DIRECTORY/install.sh' '$REMOTE_DIRECTORY' '$VERSION'"
curl --fail --silent --show-error --max-time 10 \
  --header 'Host: studio.tan.coffee' https://studio.tan.coffee/healthz
printf '\nTan Studio %s is running at https://studio.tan.coffee\n' "$VERSION"
