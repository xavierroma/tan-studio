# /// script
# requires-python = ">=3.12"
# dependencies = ["pyserial==3.5"]
# ///

"""Provision a Tan Bridge without exposing its secrets in output or argv."""

from __future__ import annotations

import argparse
import getpass
import json
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import serial


BACKEND_HOST = "xrc.local"
BACKEND_PORT = 8081
CONNECT_ORIGIN = "http://127.0.0.1:8080"
AUTHORITY = "xrc.local:8080"
CLIENT_ID = "tan-studio-lan-v1"
MAX_LINE_BYTES = 4_096
DEFAULT_TOKEN_FILE = (
    Path.home()
    / "Library/Application Support/com.xavierroma.tanstudio/lan/token"
)


def api_json(
    endpoint: str,
    token: str,
    *,
    method: str = "GET",
    expected_status: int = 200,
) -> Any:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Host": AUTHORITY,
        "Origin": f"http://{AUTHORITY}",
        "X-Tan-Studio-Client": CLIENT_ID,
    }
    if method == "POST":
        headers["Content-Type"] = "application/json"
    request = Request(
        f"{CONNECT_ORIGIN}{endpoint}",
        data=b"{}" if method == "POST" else None,
        method=method,
        headers=headers,
    )
    try:
        response = urlopen(request, timeout=5)
        status = response.status
        payload = response.read()
    except HTTPError as error:
        status = error.code
        payload = error.read()
    if status != expected_status:
        raise RuntimeError(
            f"{endpoint} returned HTTP {status}; expected {expected_status}"
        )
    return json.loads(payload)


def exchange(
    device: serial.Serial,
    operation: str,
    payload: dict[str, object],
) -> dict[str, object]:
    request_id = str(uuid.uuid4())
    encoded = json.dumps(
        {
            "schemaVersion": 1,
            "requestId": request_id,
            "type": operation,
            "payload": payload,
        },
        separators=(",", ":"),
    ).encode()
    if len(encoded) + 1 > MAX_LINE_BYTES:
        raise RuntimeError("setup request exceeds the protocol limit")
    device.write(encoded + b"\n")
    device.flush()
    response_line = device.readline(MAX_LINE_BYTES + 1)
    if not response_line.endswith(b"\n") or len(response_line) > MAX_LINE_BYTES:
        raise RuntimeError("bridge returned an invalid JSON Lines frame")
    response = json.loads(response_line)
    if not isinstance(response, dict) or response.get("requestId") != request_id:
        raise RuntimeError("bridge response correlation failed")
    error = response.get("error")
    if isinstance(error, dict):
        code = error.get("code", "unknown_error")
        raise RuntimeError(f"bridge rejected {operation}: {code}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("bridge returned an invalid result")
    return result


def wait_for_backend(bridge_id: str, token: str, timeout_seconds: int) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        page = api_json("/api/v1/bridges", token)
        items = page.get("items") if isinstance(page, dict) else None
        if isinstance(items, list):
            for item in items:
                if (
                    isinstance(item, dict)
                    and item.get("bridgeId") == bridge_id
                    and item.get("firmwareVersion") == "0.2.2-local"
                    and item.get("state") == "connected"
                ):
                    return
        time.sleep(1)
    raise RuntimeError("bridge did not authenticate with the LAN backend in time")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", help="explicit /dev/cu.usbmodem... setup port")
    parser.add_argument("--ssid", required=True)
    parser.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN_FILE)
    parser.add_argument("--backend-timeout", type=int, default=45)
    return parser.parse_args()


def main() -> int:
    arguments = parse_args()
    if not arguments.port.startswith("/dev/cu.usbmodem"):
        raise RuntimeError("an explicit /dev/cu.usbmodem... setup port is required")
    if not 1 <= len(arguments.ssid.encode("utf-8")) <= 32:
        raise RuntimeError("SSID must contain between 1 and 32 UTF-8 bytes")

    launch_token = arguments.token_file.read_text(encoding="utf-8").strip()
    if len(launch_token) < 32:
        raise RuntimeError("LAN token file does not contain a valid token")
    credential = getpass.getpass("Wi-Fi password: ")
    if len(credential.encode("utf-8")) > 63:
        raise RuntimeError("Wi-Fi password exceeds the firmware limit")

    with serial.Serial(
        arguments.port,
        115_200,
        timeout=15,
        write_timeout=2,
    ) as device:
        device.dtr = True
        time.sleep(0.25)
        device.reset_input_buffer()
        status = exchange(device, "setup.getStatus", {})
        firmware = status.get("firmware")
        backend = status.get("backend")
        bridge_id = status.get("bridgeId")
        if (
            not isinstance(firmware, dict)
            or firmware.get("version") != "0.2.2-local"
            or firmware.get("build") != "local-lan-v3"
            or not isinstance(backend, dict)
            or backend.get("host") != BACKEND_HOST
            or backend.get("port") != BACKEND_PORT
            or not isinstance(bridge_id, str)
        ):
            raise RuntimeError("connected firmware does not match the LAN release")

        claim = api_json(
            "/api/v1/bridges/claims",
            launch_token,
            method="POST",
            expected_status=201,
        )
        if (
            not isinstance(claim, dict)
            or claim.get("backendHost") != BACKEND_HOST
            or claim.get("backendPort") != BACKEND_PORT
            or not isinstance(claim.get("claimToken"), str)
        ):
            raise RuntimeError("backend returned an incompatible bridge claim")
        result = exchange(
            device,
            "setup.configure",
            {
                "ssid": arguments.ssid,
                "credential": credential,
                "claimToken": claim["claimToken"],
            },
        )
        if result.get("accepted") is not True:
            raise RuntimeError("bridge did not accept the configuration")

    credential = ""
    wait_for_backend(bridge_id, launch_token, arguments.backend_timeout)
    print(
        json.dumps(
            {
                "firmware": "0.2.2-local",
                "build": "local-lan-v3",
                "configurationAccepted": True,
                "backendHost": BACKEND_HOST,
                "backendPort": BACKEND_PORT,
                "backendAuthenticated": True,
                "secretsRedacted": True,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
