#!/usr/bin/env python3
"""Read-only smoke test for the installed Tan Studio LAN service.

The launch token is read from disk and is never printed. The test exercises the
same HTTP surface used by the web client and MCP adapter, including its Host,
Origin, client identity, and bearer-token boundaries.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


DEFAULT_TOKEN_FILE = (
    Path.home()
    / "Library/Application Support/com.xavierroma.tanstudio/lan/token"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--connect-origin", default="http://127.0.0.1:8080")
    parser.add_argument("--authority", default="xrc.local:8080")
    parser.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN_FILE)
    parser.add_argument("--expect-bridge", action="store_true")
    parser.add_argument("--expect-device-connected", action="store_true")
    return parser.parse_args()


def request_json(
    connect_origin: str,
    authority: str,
    endpoint: str,
    token: str | None,
    *,
    expected_status: int = 200,
) -> Any:
    headers = {
        "Accept": "application/json",
        "Host": authority,
        "Origin": f"http://{authority}",
        "X-Tan-Studio-Client": "tan-studio-lan-v1",
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{connect_origin}{endpoint}", headers=headers)
    try:
        response = urlopen(request, timeout=5)
        status = response.status
        payload = response.read()
    except HTTPError as error:
        status = error.code
        payload = error.read()
    if status != expected_status:
        raise AssertionError(
            f"{endpoint} returned HTTP {status}; expected {expected_status}"
        )
    return json.loads(payload)


def main() -> int:
    arguments = parse_args()
    token = arguments.token_file.read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise AssertionError("LAN token file does not contain a valid token")

    health_durations_ms = []
    health = None
    for _ in range(5):
        started = time.monotonic()
        health = request_json(
            arguments.connect_origin, arguments.authority, "/healthz", None
        )
        health_durations_ms.append(round((time.monotonic() - started) * 1000))
    assert health is not None
    if max(health_durations_ms) >= 1_000:
        raise AssertionError(
            f"health endpoint exceeded its 1 s budget: {health_durations_ms} ms"
        )
    request_json(
        arguments.connect_origin,
        arguments.authority,
        "/api/v1/device",
        None,
        expected_status=401,
    )
    request_json(
        arguments.connect_origin,
        "hostile.invalid",
        "/api/v1/device",
        token,
        expected_status=403,
    )
    bootstrap = request_json(
        arguments.connect_origin,
        arguments.authority,
        "/api/v1/system/bootstrap",
        token,
    )
    device = request_json(
        arguments.connect_origin,
        arguments.authority,
        "/api/v1/device",
        token,
    )
    bridge_page = request_json(
        arguments.connect_origin,
        arguments.authority,
        "/api/v1/bridges",
        token,
    )

    if health.get("status") != "ok" or health.get("database") != "ready":
        raise AssertionError("service health or SQLite readiness check failed")
    if bootstrap.get("apiVersion") != "v1":
        raise AssertionError("unexpected API bootstrap version")
    if not isinstance(device.get("connection"), str):
        raise AssertionError("device snapshot is missing its connection state")
    bridges = bridge_page.get("items")
    if not isinstance(bridges, list):
        raise AssertionError("bridge response is not a typed page")
    for bridge in bridges:
        if not isinstance(bridge, dict) or bridge.get("state") not in {
            "connected",
            "offline",
        }:
            raise AssertionError("bridge response contains an invalid state")

    if arguments.expect_bridge and not bridges:
        raise AssertionError("no registered Tan Bridge was found")
    if (
        arguments.expect_device_connected
        and device.get("connection") != "connected"
    ):
        raise AssertionError(
            f"Nano connection is {device.get('connection')!r}, not 'connected'"
        )

    print(
        json.dumps(
            {
                "status": "ok",
                "apiVersion": bootstrap.get("apiVersion"),
                "database": health.get("database"),
                "healthDurationsMs": health_durations_ms,
                "deviceConnection": device.get("connection"),
                "bridgeCount": len(bridges),
                "bridgeStates": [bridge.get("state") for bridge in bridges],
                "security": {
                    "missingToken": 401,
                    "hostileHost": 403,
                },
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
