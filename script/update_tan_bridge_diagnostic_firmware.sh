#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" != /dev/cu.usbmodem* ]]; then
  echo "Usage: $0 /dev/cu.usbmodem..." >&2
  echo "Pass the ESP32-S3 ROM port explicitly." >&2
  exit 2
fi

setup_port="$1"
repo_root="$(git rev-parse --show-toplevel)"
partition_table="${repo_root}/firmware/tan-bridge-setup/build/partition_table/partition-table.bin"
application="${repo_root}/firmware/tan-bridge-setup/build/tan_bridge_setup.bin"

if [[ ! -f "${partition_table}" || ! -f "${application}" ]]; then
  echo "Missing diagnostic firmware artifacts; run the clean firmware build first." >&2
  exit 1
fi

echo "This installs the Tan Bridge diagnostic partition table and application at ${setup_port}."
echo "The NVS partition remains at 0x9000 and is not erased; Wi-Fi and identity are preserved."
read -r -p "Confirm the Kaffelogic Nano is disconnected and type DIAGNOSE: " confirmation
if [[ "${confirmation}" != "DIAGNOSE" ]]; then
  echo "Cancelled."
  exit 1
fi

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${setup_port}" \
  write-flash \
  0x8000 "${partition_table}" \
  0x10000 "${application}"
