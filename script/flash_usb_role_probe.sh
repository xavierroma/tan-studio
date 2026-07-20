#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" != /dev/cu.usbmodem* ]]; then
  echo "Usage: $0 /dev/cu.usbmodem..." >&2
  echo "Disconnect the Kaffelogic Nano and pass the ESP32-S3 ROM port explicitly." >&2
  exit 2
fi

probe_port="$1"
repo_root="$(git rev-parse --show-toplevel)"
build_dir="${repo_root}/firmware/usb-role-probe/build"

for artifact in \
  "${build_dir}/bootloader/bootloader.bin" \
  "${build_dir}/partition_table/partition-table.bin" \
  "${build_dir}/tan_usb_role_probe.bin"; do
  if [[ ! -f "${artifact}" ]]; then
    echo "Missing ${artifact}; run ./script/build_usb_role_probe.sh first." >&2
    exit 1
  fi
done

echo "This replaces the program and user data on the ESP32-S3 connected at ${probe_port}."
read -r -p "Confirm the Nano is disconnected and type FLASH: " confirmation
if [[ "${confirmation}" != "FLASH" ]]; then
  echo "Cancelled."
  exit 1
fi

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${probe_port}" \
  erase-flash

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${probe_port}" \
  write-flash \
  0x0 "${build_dir}/bootloader/bootloader.bin" \
  0x8000 "${build_dir}/partition_table/partition-table.bin" \
  0x10000 "${build_dir}/tan_usb_role_probe.bin"
