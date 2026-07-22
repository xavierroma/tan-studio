from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = REPO_ROOT / "firmware/tan-bridge-setup/main/setup_main.c"
CONTRACT = REPO_ROOT / "packages/api-contract/src/tan-bridge-setup.ts"


def require(pattern: str, source: str, label: str) -> None:
    if re.search(pattern, source) is None:
        raise AssertionError(f"missing {label}")


def main() -> int:
    firmware = FIRMWARE.read_text(encoding="utf-8")
    contract = CONTRACT.read_text(encoding="utf-8")

    require(r"#define SETUP_SCHEMA_VERSION 1\b", firmware, "firmware schema")
    require(r"#define SETUP_LINE_BYTES 4096U\b", firmware, "firmware line limit")
    require(
        r'#define SETUP_BACKEND_HOST "bridge\.tanstudio\.xroma\.dev"',
        firmware,
        "firmware backend host",
    )
    require(
        r"TanBridgeSetupSchemaVersion = 1 as const",
        contract,
        "browser schema",
    )
    require(
        r"TanBridgeSetupMaxLineBytes = 4_096 as const",
        contract,
        "browser line limit",
    )
    require(
        r'TanBridgeBackendHost = "bridge\.tanstudio\.xroma\.dev"',
        contract,
        "browser backend host",
    )
    for operation in ("setup.getStatus", "setup.scanWifi"):
        if operation not in firmware or operation not in contract:
            raise AssertionError(f"operation drift: {operation}")

    print("firmware and browser setup constants agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
