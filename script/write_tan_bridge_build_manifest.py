"""Record source and artifact identity without device credentials."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
firmware = root / "firmware/tan-bridge-setup"
source = (firmware / "main/setup_main.c").read_text()
build = firmware / "build"
def git(*args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()
result = {
    "schemaVersion": 1,
    "firmwareVersion": re.search(r'SETUP_FIRMWARE_VERSION "([^"]+)"', source)[1],
    "buildId": re.search(r'SETUP_BUILD_ID "([^"]+)"', source)[1],
    "sourceCommit": git("rev-parse", "HEAD"),
    "sourceDirty": bool(git("status", "--porcelain")),
    "idfImage": "espressif/idf@sha256:a9231d0697ab8f7517cc072e93b7c83e04907bfbfba80b6440d7dbbf90665cf2",
    "applicationOffset": "0x10000",
    "artifacts": {},
}
for name in ["tan_bridge_setup.bin", "tan_bridge_setup.elf", "tan_bridge_setup.map",
             "bootloader/bootloader.bin", "partition_table/partition-table.bin",
             "flasher_args.json", "project_description.json"]:
    data = (build / name).read_bytes()
    result["artifacts"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
(build / "tan-bridge-build.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({k: result[k] for k in ["firmwareVersion", "buildId", "sourceCommit", "sourceDirty"]}))
