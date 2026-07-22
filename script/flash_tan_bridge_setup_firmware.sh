#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" != /dev/cu.usbmodem* ]]; then
  echo "Usage: $0 /dev/cu.usbmodem..." >&2
  echo "Pass the ESP32-S3 ROM port explicitly." >&2
  exit 2
fi

setup_port="$1"
repo_root="$(git rev-parse --show-toplevel)"
build_dir="${repo_root}/firmware/tan-bridge-setup/build"

for artifact in \
  "${build_dir}/bootloader/bootloader.bin" \
  "${build_dir}/partition_table/partition-table.bin" \
  "${build_dir}/tan_bridge_setup.bin"; do
  if [[ ! -f "${artifact}" ]]; then
    echo "Missing ${artifact}; run ./script/build_tan_bridge_setup_firmware.sh first." >&2
    exit 1
  fi
done

echo "This replaces the program and user data on the ESP32-S3 at ${setup_port}."
read -r -p "Confirm the Kaffelogic Nano is disconnected and type FLASH: " confirmation
if [[ "${confirmation}" != "FLASH" ]]; then
  echo "Cancelled."
  exit 1
fi

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${setup_port}" \
  erase-flash

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${setup_port}" \
  write-flash \
  0x0 "${build_dir}/bootloader/bootloader.bin" \
  0x8000 "${build_dir}/partition_table/partition-table.bin" \
  0x10000 "${build_dir}/tan_bridge_setup.bin"
