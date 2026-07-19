#!/usr/bin/env bash
set -euo pipefail

ROOT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  COMMIT="$(git -C "$ROOT_DIRECTORY" rev-parse --short=12 HEAD)"
  if [[ -z "$(git -C "$ROOT_DIRECTORY" status --porcelain --untracked-files=normal)" ]]; then
    VERSION="$COMMIT"
  else
    VERSION="$COMMIT-dirty-$(date -u +%Y%m%d%H%M%S)"
  fi
fi
if [[ ! "$VERSION" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo "Invalid release version: $VERSION" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop must be running to build the reproducible ARM64 release" >&2
  exit 1
fi

OUTPUT_PARENT="$ROOT_DIRECTORY/dist/raspberry-pi"
OUTPUT_DIRECTORY="$OUTPUT_PARENT/$VERSION"
mkdir -p "$OUTPUT_PARENT"

if [[ -e "$OUTPUT_DIRECTORY" ]]; then
  if [[ -x "$OUTPUT_DIRECTORY/bin/tan-studio-service" ]] &&
    [[ -f "$OUTPUT_DIRECTORY/web/index.html" ]] &&
    [[ "$(tr -d '\n' < "$OUTPUT_DIRECTORY/VERSION")" == "$VERSION" ]]; then
    printf '%s\n' "$OUTPUT_DIRECTORY"
    exit 0
  fi
  echo "Release output is incomplete or inconsistent: $OUTPUT_DIRECTORY" >&2
  exit 2
fi

STAGING_DIRECTORY="$(mktemp -d "$OUTPUT_PARENT/.staging-$VERSION.XXXXXX")"
trap 'rm -rf "$STAGING_DIRECTORY"' EXIT

docker buildx build \
  --platform linux/arm64 \
  --file "$ROOT_DIRECTORY/deploy/raspberry-pi/Dockerfile" \
  --target release \
  --build-arg "TAN_STUDIO_VERSION=$VERSION" \
  --output "type=local,dest=$STAGING_DIRECTORY" \
  "$ROOT_DIRECTORY"

chmod 0755 \
  "$STAGING_DIRECTORY/bin/tan-studio-service" \
  "$STAGING_DIRECTORY/install.sh"
mv "$STAGING_DIRECTORY" "$OUTPUT_DIRECTORY"
trap - EXIT
printf '%s\n' "$OUTPUT_DIRECTORY"
