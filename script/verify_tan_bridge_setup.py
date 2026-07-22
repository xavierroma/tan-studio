# /// script
# requires-python = ">=3.12"
# dependencies = ["pyserial==3.5"]
# ///

from __future__ import annotations

import argparse
import json
import uuid

import serial


BACKEND_HOST = "bridge.tanstudio.xroma.dev"
MAX_LINE_BYTES = 4_096


def exchange(device: serial.Serial, request_object: dict[str, object]) -> dict[str, object]:
    encoded = json.dumps(request_object, separators=(",", ":")).encode()
    if len(encoded) + 1 > MAX_LINE_BYTES:
        raise AssertionError("test request exceeds the protocol limit")
    device.write(encoded + b"\n")
    response_line = device.readline(MAX_LINE_BYTES + 1)
    if not response_line.endswith(b"\n") or len(response_line) > MAX_LINE_BYTES:
        raise AssertionError("bridge returned an invalid JSON Lines frame")
    response = json.loads(response_line)
    if set(response) not in ({"schemaVersion", "requestId", "result"}, {"schemaVersion", "requestId", "error"}):
        raise AssertionError("bridge returned an invalid response envelope")
    if response["schemaVersion"] != 1:
        raise AssertionError("bridge response schema drifted")
    return response


def request(device: serial.Serial, operation: str, payload: dict[str, object]) -> dict[str, object]:
    request_id = str(uuid.uuid4())
    response = exchange(
        device,
        {
            "schemaVersion": 1,
            "requestId": request_id,
            "type": operation,
            "payload": payload,
        },
    )
    if response["requestId"] != request_id:
        raise AssertionError("bridge response correlation failed")
    if "error" in response:
        raise AssertionError(f"bridge returned {response['error']!r}")
    result = response["result"]
    if not isinstance(result, dict):
        raise AssertionError("bridge result is not an object")
    return result


def expect_error(
    device: serial.Serial,
    request_object: dict[str, object],
    expected_code: str,
) -> None:
    response = exchange(device, request_object)
    if response["requestId"] != request_object["requestId"]:
        raise AssertionError("error response correlation failed")
    error = response.get("error")
    if not isinstance(error, dict) or error.get("code") != expected_code:
        raise AssertionError(f"expected {expected_code}, received {response!r}")


def validate_negative_paths(device: serial.Serial) -> None:
    unknown_property_id = str(uuid.uuid4())
    expect_error(
        device,
        {
            "schemaVersion": 1,
            "requestId": unknown_property_id,
            "type": "setup.getStatus",
            "payload": {},
            "futureFlag": True,
        },
        "invalid_request",
    )

    duplicate_id = str(uuid.uuid4())
    duplicate_request = {
        "schemaVersion": 1,
        "requestId": duplicate_id,
        "type": "setup.getStatus",
        "payload": {},
    }
    first_response = exchange(device, duplicate_request)
    if "result" not in first_response:
        raise AssertionError("first use of duplicate test request failed")
    expect_error(device, duplicate_request, "invalid_request")

    unsupported_id = str(uuid.uuid4())
    expect_error(
        device,
        {
            "schemaVersion": 1,
            "requestId": unsupported_id,
            "type": "setup.configure",
            "payload": {},
        },
        "unsupported_operation",
    )

    device.write(b"x" * MAX_LINE_BYTES + b"\n")
    oversized_response = json.loads(device.readline(MAX_LINE_BYTES + 1))
    error = oversized_response.get("error")
    if not isinstance(error, dict) or error.get("code") != "invalid_request":
        raise AssertionError("oversized request did not receive a typed error")


def validate_status(status: dict[str, object]) -> None:
    if set(status) != {"protocolVersion", "bridgeId", "firmware", "lifecycle", "wifi", "backend", "claim"}:
        raise AssertionError("status properties drifted")
    if status["protocolVersion"] != 1:
        raise AssertionError("unexpected setup protocol version")
    backend = status["backend"]
    if not isinstance(backend, dict) or backend != {"state": "offline", "host": BACKEND_HOST}:
        raise AssertionError("unexpected backend status")
    encoded = json.dumps(status).lower()
    for forbidden in ("password", "credential", "claimtoken"):
        if forbidden in encoded:
            raise AssertionError(f"status leaked {forbidden}")


def validate_scan(scan: dict[str, object]) -> int:
    if set(scan) != {"scanId", "networks"}:
        raise AssertionError("scan properties drifted")
    networks = scan["networks"]
    if not isinstance(networks, list) or len(networks) > 12:
        raise AssertionError("scan is not a bounded network list")
    expected = {"networkId", "ssid", "authMode", "channel", "rssi"}
    for network in networks:
        if not isinstance(network, dict) or set(network) != expected:
            raise AssertionError("network properties drifted")
        if not isinstance(network["ssid"], str) or len(network["ssid"]) > 32:
            raise AssertionError("network SSID was not sanitized")
    return len(networks)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", help="Tan Bridge setup /dev/cu.usbmodem... path")
    args = parser.parse_args()
    if not args.port.startswith("/dev/cu.usbmodem"):
        parser.error("the explicit ESP32-S3 /dev/cu.usbmodem... path is required")

    with serial.Serial(args.port, 115_200, timeout=15, write_timeout=2) as device:
        device.dtr = True
        device.reset_input_buffer()
        status = request(device, "setup.getStatus", {})
        validate_status(status)
        scan = request(device, "setup.scanWifi", {})
        network_count = validate_scan(scan)
        validate_negative_paths(device)

    firmware = status["firmware"]
    bridge_id = status["bridgeId"]
    print(
        json.dumps(
            {
                "bridgeId": bridge_id,
                "firmware": firmware,
                "lifecycle": status["lifecycle"],
                "wifiState": status["wifi"],
                "visibleNetworkCount": network_count,
                "ssidValuesRedacted": True,
                "unknownPropertiesRejected": True,
                "duplicateRequestIdsRejected": True,
                "unsupportedOperationsRejected": True,
                "oversizedLinesRejected": True,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
