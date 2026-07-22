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
        r'#define SETUP_BACKEND_HOST "xrc\.local"',
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
        r'TanBridgeBackendHost = "xrc\.local"',
        contract,
        "browser backend host",
    )
    require(r"#define SETUP_BACKEND_PORT 8081U", firmware, "firmware backend port")
    require(r"TanBridgeBackendPort = 8_081 as const", contract, "browser backend port")
    for operation in ("setup.getStatus", "setup.scanWifi", "setup.configure"):
        if operation not in firmware or operation not in contract:
            raise AssertionError(f"operation drift: {operation}")

    print("firmware and browser setup constants agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
