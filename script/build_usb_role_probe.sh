#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
idf_image="espressif/idf:v5.5.5"
expected_digest="espressif/idf@sha256:a9231d0697ab8f7517cc072e93b7c83e04907bfbfba80b6440d7dbbf90665cf2"

# Docker Desktop's containerd image store does not retain this multi-platform
# image when it is addressed only by its index digest. Pull the immutable
# release tag for caching, then refuse to run unless its registry digest is the
# one reviewed and pinned here.
if ! docker image inspect "${idf_image}" >/dev/null 2>&1; then
  docker pull "${idf_image}"
fi

repo_digests_json="$(docker image inspect "${idf_image}" --format '{{json .RepoDigests}}')"
if [[ "${repo_digests_json}" != *\"${expected_digest}\"* ]]; then
  echo "Refusing unverified ESP-IDF image; expected ${expected_digest}." >&2
  exit 1
fi

docker run --rm \
  --volume "${repo_root}:/workspace" \
  --workdir /workspace/firmware/usb-role-probe \
  "${idf_image}" \
  bash -lc 'cmake -E remove_directory build && cmake -E remove_directory managed_components && idf.py set-target esp32s3 && idf.py build'

echo "Probe image: ${repo_root}/firmware/usb-role-probe/build/tan_usb_role_probe.bin"
