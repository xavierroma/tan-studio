# /// script
# requires-python = ">=3.11"
# dependencies = ["pyserial==3.5"]
# ///

import argparse
import json
import sys
import time

import serial


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read the previous passive Tan USB role-probe session."
    )
    parser.add_argument("port", help="ESP32-S3 probe /dev/cu.usbmodem... path")
    args = parser.parse_args()

    if not args.port.startswith("/dev/cu.usbmodem"):
        parser.error("the explicit ESP32-S3 /dev/cu.usbmodem... path is required")

    # This sentinel line coding is part of the probe's fail-closed diagnostic
    # gate. USB CDC transports the bytes independently of the nominal bitrate.
    with serial.Serial(args.port, 921600, timeout=0.25, write_timeout=1) as device:
        device.reset_input_buffer()
        time.sleep(0.1)  # Let DTR and line-coding callbacks reach the probe task.
        device.write(b"TAN_PROBE_DUMP\r")
        device.flush()

        deadline = time.monotonic() + 3
        response = bytearray()
        while time.monotonic() < deadline:
            chunk = device.read(512)
            if chunk:
                response.extend(chunk)
                if b"\n" in response:
                    break

    if not response:
        print("Probe did not return a diagnostic response.", file=sys.stderr)
        return 1

    try:
        document = json.loads(response.splitlines()[0])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"Invalid probe response: {error}", file=sys.stderr)
        return 1

    print(json.dumps(document, indent=2, sort_keys=True))
    previous = document.get("previous", {})
    if not document.get("previousAvailable"):
        print("No previous attachment session is available yet.", file=sys.stderr)
        return 2
    if previous.get("attached", 0) == 0:
        print("Previous host did not attach to the USB device.", file=sys.stderr)
        return 3
    if previous.get("rxBytes", 0) == 0:
        print("USB attached, but the previous host sent no CDC bytes.", file=sys.stderr)
        return 4
    if previous.get("sassiFrames", 0) == 0:
        print("CDC bytes arrived, but no complete SASSI frame was observed.", file=sys.stderr)
        return 5

    print("Nano USB host/source and SASSI traffic confirmed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
