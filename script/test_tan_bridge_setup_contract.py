from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = REPO_ROOT / "firmware/tan-bridge-setup/main/setup_main.c"
CONTRACT = REPO_ROOT / "packages/api-contract/src/tan-bridge-setup.ts"
BUILD_SCRIPT = REPO_ROOT / "script/build_tan_bridge_setup_firmware.sh"
UPDATE_SCRIPT = REPO_ROOT / "script/update_tan_bridge_setup_firmware.sh"
COMPONENT_MANIFEST = REPO_ROOT / "firmware/tan-bridge-setup/main/idf_component.yml"


def require(pattern: str, source: str, label: str) -> None:
    if re.search(pattern, source) is None:
        raise AssertionError(f"missing {label}")


def main() -> int:
    firmware = FIRMWARE.read_text(encoding="utf-8")
    contract = CONTRACT.read_text(encoding="utf-8")
    build_script = BUILD_SCRIPT.read_text(encoding="utf-8")
    update_script = UPDATE_SCRIPT.read_text(encoding="utf-8")
    component_manifest = COMPONENT_MANIFEST.read_text(encoding="utf-8")

    require(r"#define SETUP_SCHEMA_VERSION 2\b", firmware, "firmware schema")
    require(r"#define BRIDGE_PROTOCOL_VERSION 1\b", firmware, "bridge protocol")
    require(r"#define SETUP_LINE_BYTES 4096U\b", firmware, "firmware line limit")
    require(
        r'#define SETUP_BACKEND_HOST "studio\.tan\.coffee"',
        firmware,
        "firmware backend host",
    )
    require(
        r"TanBridgeSetupSchemaVersion = 2 as const",
        contract,
        "browser schema",
    )
    require(
        r"TanBridgeSetupMaxLineBytes = 4_096 as const",
        contract,
        "browser line limit",
    )
    require(
        r'TanBridgeBackendHost = "studio\.tan\.coffee"',
        contract,
        "browser backend host",
    )
    require(r"#define SETUP_BACKEND_PORT 443U", firmware, "firmware backend port")
    require(r"#define SETUP_BACKEND_PATH \"/device/v1/session\"", firmware, "firmware backend path")
    require(r"TanBridgeBackendPort = 443 as const", contract, "browser backend port")
    require(r'TanBridgeBackendPath = "/device/v1/session"', contract, "browser backend path")
    require(
        r'#define SETUP_FIRMWARE_VERSION "0\.3\.1-hosted"',
        firmware,
        "runtime firmware version",
    )
    require(
        r'firmware_version="0\.3\.1-hosted"',
        build_script,
        "reproducible build firmware version",
    )
    require(
        r"pending_usb_bytes\[TUNNEL_MAX_PAYLOAD_BYTES\]",
        firmware,
        "pre-network Nano bootstrap buffer",
    )
    require(
        r"static void set_bridge_client\(esp_websocket_client_handle_t client\)[\s\S]*?pending_usb_length[\s\S]*?send_tunnel_frame",
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
        r"bool setup_bytes = setup_protocol_active \|\| event\.bytes\[0\] == '\{'",
        firmware,
        "payload-selected setup protocol",
    )
    if re.search(
        r"setup_protocol_active\s*=\s*event->line_state_changed_data\.dtr",
        firmware,
    ):
        raise AssertionError("DTR must not select the setup protocol")
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
        r"esp_wifi_set_ps\(WIFI_PS_NONE\)",
        firmware,
        "always-on Wi-Fi power mode",
    )
    require(
        r"xTaskCreatePinnedToCore\(network_task,[\s\S]*?SETUP_NETWORK_TASK_CORE",
        firmware,
        "network task core isolation",
    )
    require(
        r"tan_tunnel_allows_backend_frame\(payload, payload_length\)",
        firmware,
        "host-tested backend-to-Nano safety policy",
    )
    require(r"esp_websocket_client_send_bin", firmware, "binary WebSocket tunnel")
    require(
        r"\(size_t\)sent != hello_length",
        firmware,
        "complete WebSocket hello write",
    )
    require(r"esp_crt_bundle_attach", firmware, "Mozilla CA bundle verification")
    require(r"\.skip_cert_common_name_check\s*=\s*false", firmware, "TLS hostname verification")
    require(r"\.ping_interval_sec\s*=\s*20U", firmware, "WebSocket heartbeat")
    require(r"\.pingpong_timeout_sec\s*=\s*60", firmware, "heartbeat timeout")
    require(r"\.network_timeout_ms\s*=\s*10000", firmware, "bounded TLS network timeout")
    require(r"esp_netif_sntp_sync_wait", firmware, "clock synchronization before TLS")
    require(r"payload_offset", firmware, "fragmented WebSocket message assembly")
    require(r"payload_len", firmware, "bounded WebSocket message assembly")
    require(r"espressif/esp_websocket_client:[\s\S]*?version: \"1\.8\.0\"", component_manifest, "pinned managed WebSocket client")
    if "connect_backend" in firmware or "SOCK_STREAM" in firmware:
        raise AssertionError("hosted firmware must not retain the raw TCP transport")
    if re.search(r"uint8_t\s+payload\[TUNNEL_MAX_PAYLOAD_BYTES\]", firmware):
        raise AssertionError("tunnel payload must not consume the network task stack")
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
