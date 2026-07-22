from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = REPO_ROOT / "firmware/tan-bridge-setup/main/setup_main.c"
CONTRACT = REPO_ROOT / "packages/api-contract/src/tan-bridge-setup.ts"
BUILD_SCRIPT = REPO_ROOT / "script/build_tan_bridge_setup_firmware.sh"
UPDATE_SCRIPT = REPO_ROOT / "script/update_tan_bridge_setup_firmware.sh"


def require(pattern: str, source: str, label: str) -> None:
    if re.search(pattern, source) is None:
        raise AssertionError(f"missing {label}")


def main() -> int:
    firmware = FIRMWARE.read_text(encoding="utf-8")
    contract = CONTRACT.read_text(encoding="utf-8")
    build_script = BUILD_SCRIPT.read_text(encoding="utf-8")
    update_script = UPDATE_SCRIPT.read_text(encoding="utf-8")

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
    require(
        r'#define SETUP_FIRMWARE_VERSION "0\.2\.2-local"',
        firmware,
        "runtime firmware version",
    )
    require(
        r'firmware_version="0\.2\.2-local"',
        build_script,
        "reproducible build firmware version",
    )
    require(
        r"pending_usb_bytes\[TUNNEL_MAX_PAYLOAD_BYTES\]",
        firmware,
        "pre-network Nano bootstrap buffer",
    )
    require(
        r"static void set_bridge_socket\(int socket_fd\)[\s\S]*?pending_usb_length[\s\S]*?send_tunnel_frame",
        firmware,
        "bootstrap replay after backend authentication",
    )
    require(
        r"confirm_usb_session_started\(\)",
        firmware,
        "bootstrap freeze after backend-to-Nano progress",
    )
    require(
        r"confirm_usb_session_started\(void\)[\s\S]*?usb_bootstrap_confirmed = true",
        firmware,
        "bootstrap retained for reconnect replay",
    )
    require(
        r"initialize_diagnostics\(\)",
        firmware,
        "persisted reset diagnostics",
    )
    require(
        r"vTaskDelay\(pdMS_TO_TICKS\(SETUP_NETWORK_START_DELAY_MS\)\)",
        firmware,
        "USB enumeration grace period",
    )
    require(
        r"esp_wifi_set_max_tx_power\(SETUP_WIFI_MAX_TX_POWER_QDBM\)",
        firmware,
        "bounded Wi-Fi transmit power",
    )
    require(
        r"write-flash\s+\\\s+0x10000",
        update_script,
        "application-only update address",
    )
    if "erase-flash" in update_script:
        raise AssertionError("configuration-preserving updater erases flash")
    for operation in ("setup.getStatus", "setup.scanWifi", "setup.configure"):
        if operation not in firmware or operation not in contract:
            raise AssertionError(f"operation drift: {operation}")

    print("firmware and browser setup constants agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
