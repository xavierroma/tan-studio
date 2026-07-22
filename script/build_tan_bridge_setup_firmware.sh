#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
idf_image="espressif/idf:v5.5.5"
expected_digest="espressif/idf@sha256:a9231d0697ab8f7517cc072e93b7c83e04907bfbfba80b6440d7dbbf90665cf2"
build_volume="tan-studio-esp-idf-5-5-5"
firmware_version="0.2.6-local"
clean_build=false
if [[ "${1:-}" == "--clean" ]]; then
  clean_build=true
elif [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--clean]" >&2
  exit 2
fi

if ! docker image inspect "${idf_image}" >/dev/null 2>&1; then
  docker pull "${idf_image}"
fi

repo_digests_json="$(docker image inspect "${idf_image}" --format '{{json .RepoDigests}}')"
if [[ "${repo_digests_json}" != *\"${expected_digest}\"* ]]; then
  echo "Refusing unverified ESP-IDF image; expected ${expected_digest}." >&2
  exit 1
fi

build_command="IDF_TARGET=esp32s3 idf.py -B /idf-cache/build -D PROJECT_VER=${firmware_version} build"
if [[ "${clean_build}" == true ]]; then
  build_command="cmake -E remove_directory /idf-cache/build && IDF_TARGET=esp32s3 idf.py -B /idf-cache/build -D PROJECT_VER=${firmware_version} build"
fi

docker run --rm \
  --volume "${repo_root}:/workspace:delegated" \
  --volume "${build_volume}:/idf-cache" \
  --workdir /workspace/firmware/tan-bridge-setup \
  "${idf_image}" \
  bash -lc "${build_command} && \
    mkdir -p build/bootloader build/partition_table && \
    cp /idf-cache/build/bootloader/bootloader.bin build/bootloader/bootloader.bin && \
    cp /idf-cache/build/partition_table/partition-table.bin build/partition_table/partition-table.bin && \
    cp /idf-cache/build/tan_bridge_setup.bin build/tan_bridge_setup.bin && \
    cp /idf-cache/build/tan_bridge_setup.elf build/tan_bridge_setup.elf && \
    cp /idf-cache/build/flasher_args.json build/flasher_args.json"

python3 "${repo_root}/script/test_tan_bridge_setup_contract.py"
echo "Setup image: ${repo_root}/firmware/tan-bridge-setup/build/tan_bridge_setup.bin"
