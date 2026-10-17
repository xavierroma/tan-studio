#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" != /dev/cu.usbmodem* ]]; then
  echo "Usage: $0 /dev/cu.usbmodem..." >&2
  echo "Pass the ESP32-S3 ROM port explicitly." >&2
  exit 2
fi

setup_port="$1"
repo_root="$(git rev-parse --show-toplevel)"
application="${repo_root}/firmware/tan-bridge-setup/build/tan_bridge_setup.bin"

if [[ ! -f "${application}" ]]; then
  echo "Missing ${application}; run ./script/build_tan_bridge_setup_firmware.sh first." >&2
  exit 1
fi

python3 - "${application}" "${repo_root}" <<'PY'
import hashlib, json, pathlib, subprocess, sys
application = pathlib.Path(sys.argv[1])
manifest = json.loads((application.parent / "tan-bridge-build.json").read_text())
assert not manifest["sourceDirty"], "Refusing a firmware build from uncommitted source"
head = subprocess.check_output(["git", "-C", sys.argv[2], "rev-parse", "HEAD"], text=True).strip()
assert manifest["sourceCommit"] == head, "Firmware source commit does not match checkout"
assert manifest["applicationOffset"] == "0x10000"
assert hashlib.sha256(application.read_bytes()).hexdigest() == manifest["artifacts"][application.name]["sha256"], "Firmware checksum mismatch"
print("Verified application:", manifest["firmwareVersion"], manifest["buildId"], head)
PY

echo "This updates the Tan Bridge application at ${setup_port}."
echo "The existing NVS identity, Wi-Fi configuration, and device token are preserved."
read -r -p "Confirm the Kaffelogic Nano is disconnected and type UPDATE: " confirmation
if [[ "${confirmation}" != "UPDATE" ]]; then
  echo "Cancelled."
  exit 1
fi

uvx --from 'esptool==5.1.0' esptool \
  --chip esp32s3 \
  --port "${setup_port}" \
  write-flash \
  0x10000 "${application}"
