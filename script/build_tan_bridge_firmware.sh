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
  --workdir /workspace/firmware/tan-bridge-esp32s3 \
  "${idf_image}" \
  bash -lc '
    set -euo pipefail
    cmake -E remove_directory build
    cmake -E remove_directory managed_components
    for profile in debug release; do
      idf.py \
        -B "build/${profile}" \
        -D "SDKCONFIG=build/${profile}/sdkconfig" \
        -D "SDKCONFIG_DEFAULTS=sdkconfig.defaults;config/${profile}.defaults" \
        set-target esp32s3 build
    done
    if xtensa-esp32s3-elf-nm --defined-only build/release/tan_bridge.elf |
      grep -Eq "tinyusb_cdcacm_write|tud_cdc.*write|tan_.*(transmit|encode|write)"; then
      echo "Release image contains a forbidden transmit symbol." >&2
      exit 1
    fi
  '

uv run script/generate_tan_bridge_manifest.py
