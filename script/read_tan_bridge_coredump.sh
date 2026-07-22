#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" != /dev/cu.usbmodem* ]]; then
  echo "Usage: $0 /dev/cu.usbmodem..." >&2
  echo "Pass the ESP32-S3 ROM port explicitly." >&2
  exit 2
fi

setup_port="$1"
repo_root="$(git rev-parse --show-toplevel)"
idf_image="espressif/idf:v5.5.5"
core_file="${repo_root}/firmware/tan-bridge-setup/build/tan_bridge_coredump.bin"
program_elf="${repo_root}/firmware/tan-bridge-setup/build/tan_bridge_setup.elf"

if [[ ! -f "${program_elf}" ]]; then
  echo "Missing ${program_elf}; run the clean firmware build first." >&2
  exit 1
fi

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${setup_port}" \
  read-flash 0x110000 0x10000 "${core_file}"

docker run --rm \
  --volume "${repo_root}:/workspace:ro" \
  --workdir /workspace/firmware/tan-bridge-setup \
  "${idf_image}" \
  bash -lc "esp-coredump --chip esp32s3 info_corefile \
    --core /workspace/firmware/tan-bridge-setup/build/tan_bridge_coredump.bin \
    --core-format raw \
    /workspace/firmware/tan-bridge-setup/build/tan_bridge_setup.elf"
