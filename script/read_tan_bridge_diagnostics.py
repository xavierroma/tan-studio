#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pyserial==3.5"]
# ///

"""Read one redacted Tan Bridge setup status without scanning or mutation."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Any

import serial


MAX_LINE_BYTES = 4_096


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", help="explicit /dev/cu.usbmodem... Tan Bridge port")
    parser.add_argument("--attempts", type=int, default=10)
    arguments = parser.parse_args()
    if not arguments.port.startswith("/dev/cu.usbmodem"):
        parser.error("an explicit /dev/cu.usbmodem path is required")
    if not 1 <= arguments.attempts <= 60:
        parser.error("attempts must be between 1 and 60")

    last_error = "unavailable"
    for attempt in range(1, arguments.attempts + 1):
        try:
            status = read_status(Path(arguments.port))
            bridge_id = status.get("bridgeId")
            diagnostics = status.get("diagnostics")
            firmware = status.get("firmware")
            if (
                not isinstance(bridge_id, str)
                or not isinstance(diagnostics, dict)
                or not isinstance(firmware, dict)
            ):
                raise RuntimeError("status schema is incomplete")
            print(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "portProduct": "Tan Bridge Setup Development",
                        "bridgeIdSha256": hashlib.sha256(bridge_id.encode()).hexdigest(),
                        "firmware": firmware,
                        "lifecycle": status.get("lifecycle"),
                        "wifi": status.get("wifi"),
                        "backend": status.get("backend"),
                        "diagnostics": diagnostics,
                        "attempt": attempt,
                        "secretsRedacted": True,
                    },
                    separators=(",", ":"),
                )
            )
            return 0
        except (OSError, RuntimeError, serial.SerialException, json.JSONDecodeError) as error:
            last_error = type(error).__name__
            time.sleep(0.5)
    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "error": "status_unavailable",
                "lastErrorType": last_error,
                "attempts": arguments.attempts,
            },
            separators=(",", ":"),
        )
    )
    return 2


def read_status(port: Path) -> dict[str, Any]:
    request_id = str(uuid.uuid4())
    encoded = json.dumps(
        {
            "schemaVersion": 1,
            "requestId": request_id,
            "type": "setup.getStatus",
            "payload": {},
        },
        separators=(",", ":"),
    ).encode()
    with serial.Serial(str(port), 115_200, timeout=2, write_timeout=2) as device:
        device.dtr = True
        time.sleep(0.1)
        device.reset_input_buffer()
        device.write(encoded + b"\n")
        device.flush()
        line = device.readline(MAX_LINE_BYTES + 1)
    if not line.endswith(b"\n") or len(line) > MAX_LINE_BYTES:
        raise RuntimeError("invalid setup response")
    response = json.loads(line)
    if not isinstance(response, dict) or response.get("requestId") != request_id:
        raise RuntimeError("setup correlation failed")
    result = response.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("setup status failed")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
