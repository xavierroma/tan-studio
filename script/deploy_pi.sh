#!/usr/bin/env bash
set -euo pipefail

ROOT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOST="${TAN_STUDIO_PI_HOST:-xavi@tan-studio.local}"
SSH_KEY="${TAN_STUDIO_PI_SSH_KEY:-$HOME/.ssh/id_ed25519_tan_studio}"
COMMIT="$(git -C "$ROOT_DIRECTORY" rev-parse --short=12 HEAD)"

if [[ -z "$(git -C "$ROOT_DIRECTORY" status --porcelain --untracked-files=normal)" ]]; then
  VERSION="$COMMIT"
else
  VERSION="$COMMIT-dirty-$(date -u +%Y%m%d%H%M%S)"
fi

"$ROOT_DIRECTORY/script/build_pi_release.sh" "$VERSION"
RELEASE_DIRECTORY="$ROOT_DIRECTORY/dist/raspberry-pi/$VERSION"
REMOTE_DIRECTORY="/tmp/tan-studio-deploy-$VERSION"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes)

cleanup_remote() {
  "${SSH[@]}" "$PI_HOST" "rm -rf '$REMOTE_DIRECTORY'" >/dev/null 2>&1 || true
}
trap cleanup_remote EXIT

"${SSH[@]}" "$PI_HOST" "install -d -m 0700 '$REMOTE_DIRECTORY'"
rsync --archive --delete -e "ssh -i $SSH_KEY -o BatchMode=yes -o IdentitiesOnly=yes" \
  "$RELEASE_DIRECTORY/" "$PI_HOST:$REMOTE_DIRECTORY/"
"${SSH[@]}" "$PI_HOST" \
  "sudo '$REMOTE_DIRECTORY/install.sh' '$REMOTE_DIRECTORY' '$VERSION'"
cleanup_remote
trap - EXIT

ADDRESS="${PI_HOST#*@}"
curl --fail --silent --show-error --max-time 5 \
  --header 'Host: tan-studio.local' "http://$ADDRESS/healthz"
printf '\nTan Studio %s is running at http://%s\n' "$VERSION" "$ADDRESS"
