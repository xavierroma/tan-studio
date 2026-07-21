from __future__ import annotations

import json
import sys
from pathlib import Path


EXPECTED_OPERATIONS = {
    ("get", "/bridge/v1/status", "getBridgeStatus"),
    ("get", "/bridge/v1/files", "listBridgeFiles"),
    ("get", "/bridge/v1/files/{hash}", "downloadBridgeFile"),
    ("get", "/bridge/v1/events", "observeBridgeEvents"),
    ("post", "/bridge/v1/synchronize", "synchronizeBridge"),
}


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: test_api_contract.py OPENAPI RUST_CLIENT")
    document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rust_client = Path(sys.argv[2]).read_text(encoding="utf-8")

    assert document["openapi"] == "3.1.0"
    assert document["security"] == [{"pairedMutualTls": []}]
    assert document["components"]["securitySchemes"]["pairedMutualTls"] == {
        "type": "mutualTLS"
    }

    operations = {
        (method, path, operation["operationId"])
        for path, path_item in document["paths"].items()
        for method, operation in path_item.items()
        if method in {"get", "post"}
    }
    assert operations == EXPECTED_OPERATIONS
    lowered_paths = " ".join(document["paths"]).lower()
    assert "command" not in lowered_paths
    assert "raw" not in lowered_paths
    assert "serial" not in lowered_paths

    schemas = document["components"]["schemas"]
    assert schemas["UsbState"]["enum"] == [
        "booting",
        "usbDetached",
        "usbEnumerated",
        "observing",
        "readOnlyReady",
        "recovering",
        "faulted",
    ]
    assert set(schemas["BridgeEvent"]["required"]) == {
        "schemaVersion",
        "bridgeId",
        "bootId",
        "seq",
        "monotonicMs",
        "type",
        "payload",
    }
    assert schemas["FeatureFlags"]["additionalProperties"] is False
    assert set(schemas["FeatureFlags"]["required"]) == {
        "sassiTransmit",
        "wifi",
        "api",
        "pairing",
        "ota",
    }

    for _, path, operation_id in EXPECTED_OPERATIONS:
        assert json.dumps(path) in rust_client
        assert json.dumps(operation_id) in rust_client
    assert "Raw" not in rust_client
    assert "Command" not in rust_client
    print("bridge OpenAPI and Rust mock-client contract agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
