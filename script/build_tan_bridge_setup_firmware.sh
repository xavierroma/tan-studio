#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
idf_image="espressif/idf:v5.5.5"
expected_digest="espressif/idf@sha256:a9231d0697ab8f7517cc072e93b7c83e04907bfbfba80b6440d7dbbf90665cf2"

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
  --workdir /workspace/firmware/tan-bridge-setup \
  "${idf_image}" \
  bash -lc 'cmake -E remove_directory build && cmake -E remove_directory managed_components && idf.py set-target esp32s3 && idf.py build'

python3 "${repo_root}/script/test_tan_bridge_setup_contract.py"
echo "Setup image: ${repo_root}/firmware/tan-bridge-setup/build/tan_bridge_setup.bin"
