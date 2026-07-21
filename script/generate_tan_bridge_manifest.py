# /// script
# requires-python = ">=3.11"
# ///

from __future__ import annotations

import csv
import hashlib
import json
import subprocess
from pathlib import Path
from typing import TypedDict


class Artifact(TypedDict):
    path: str
    bytes: int
    sha256: str


class Partition(TypedDict):
    name: str
    offset: int
    bytes: int


class FeatureFlags(TypedDict):
    sassiTransmit: bool
    wifi: bool
    api: bool
    pairing: bool
    ota: bool


class Manifest(TypedDict):
    schemaVersion: int
    gitCommit: str
    gitTreeClean: bool
    espIdfVersion: str
    espTinyusbVersion: str
    tinyusbVersion: str
    profile: str
    featureFlags: FeatureFlags
    artifacts: list[Artifact]
    partitionTableSha256: str
    partitions: list[Partition]
    otaSlotBytes: int
    requiredMarginPercent: int
    releaseImageBytes: int
    releaseImageFitsWithRequiredMargin: bool


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(*arguments: str) -> str:
    return subprocess.check_output(
        ["git", *arguments], text=True, stderr=subprocess.DEVNULL
    ).strip()


def parse_int(value: str) -> int:
    stripped = value.strip()
    if stripped.lower().startswith("0x"):
        return int(stripped, 16)
    suffixes = {"k": 1024, "m": 1024 * 1024}
    suffix = stripped[-1:].lower()
    if suffix in suffixes:
        return int(stripped[:-1]) * suffixes[suffix]
    return int(stripped)


def partitions(path: Path) -> list[Partition]:
    result: list[Partition] = []
    with path.open(newline="", encoding="utf-8") as source:
        rows = csv.reader(line for line in source if not line.lstrip().startswith("#"))
        for row in rows:
            if not row or len(row) < 5:
                continue
            result.append(
                {
                    "name": row[0].strip(),
                    "offset": parse_int(row[3]),
                    "bytes": parse_int(row[4]),
                }
            )
    return result


def artifact(repo_root: Path, path: Path) -> Artifact:
    return {
        "path": str(path.relative_to(repo_root)),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def main() -> int:
    repo_root = Path(git("rev-parse", "--show-toplevel"))
    project = repo_root / "firmware/tan-bridge-esp32s3"
    release = project / "build/release"
    app = release / "tan_bridge.bin"
    partition_csv = project / "partitions.csv"
    artifact_paths = [
        release / "bootloader/bootloader.bin",
        release / "partition_table/partition-table.bin",
        app,
    ]
    missing = [path for path in artifact_paths if not path.is_file()]
    if missing:
        raise SystemExit(f"missing release artifacts: {', '.join(map(str, missing))}")

    parsed_partitions = partitions(partition_csv)
    ota_slots = [item["bytes"] for item in parsed_partitions if item["name"] in {"ota_0", "ota_1"}]
    if len(ota_slots) != 2 or len(set(ota_slots)) != 1:
        raise SystemExit("expected two equal OTA slots")
    ota_slot_bytes = ota_slots[0]
    image_bytes = app.stat().st_size
    fits = image_bytes * 5 <= ota_slot_bytes * 4

    manifest: Manifest = {
        "schemaVersion": 1,
        "gitCommit": git("rev-parse", "HEAD"),
        "gitTreeClean": git("status", "--porcelain", "--untracked-files=no") == "",
        "espIdfVersion": "5.5.5",
        "espTinyusbVersion": "2.2.1",
        "tinyusbVersion": "0.21.0~1",
        "profile": "release",
        "featureFlags": {
            "sassiTransmit": False,
            "wifi": False,
            "api": False,
            "pairing": False,
            "ota": False,
        },
        "artifacts": [artifact(repo_root, path) for path in artifact_paths],
        "partitionTableSha256": sha256(partition_csv),
        "partitions": parsed_partitions,
        "otaSlotBytes": ota_slot_bytes,
        "requiredMarginPercent": 25,
        "releaseImageBytes": image_bytes,
        "releaseImageFitsWithRequiredMargin": fits,
    }
    output = release / "build-manifest.json"
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(output)
    if not fits:
        raise SystemExit("release image does not retain 25% OTA slot margin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
