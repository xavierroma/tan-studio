#!/usr/bin/env python3
"""Run the virtual Nano through a real Atom without touching the production DB."""

from __future__ import annotations

import argparse
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parent.parent
SERVICE = REPO / "apps/service/target/debug/tan-studio-service"
SIMULATOR = REPO / "apps/service/target/debug/tan-nano-simulator"
WEB_ROOT = REPO / "apps/web/dist"
APP_SUPPORT = Path.home() / "Library/Application Support/com.xavierroma.tanstudio"
PRODUCTION_DATABASE = APP_SUPPORT / "store/tan-studio.sqlite"
TOKEN_FILE = APP_SUPPORT / "lan/token"
ARTIFACT_ROOT = REPO / "tmp/atom-hil"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", help="explicit Tan Bridge /dev/cu.usbmodem... port")
    parser.add_argument("--duration-seconds", type=int, default=60)
    arguments = parser.parse_args()
    if not arguments.port.startswith("/dev/cu.usbmodem"):
        parser.error("an explicit /dev/cu.usbmodem path is required")
    if not 5 <= arguments.duration_seconds <= 8 * 60 * 60:
        parser.error("duration must be between 5 seconds and 8 hours")

    run_checked(
        [
            "cargo",
            "build",
            "--manifest-path",
            "apps/service/Cargo.toml",
            "--bins",
        ],
        timeout=300,
    )
    run_checked(["bun", "run", "--cwd", "apps/web", "build"], timeout=300)
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if len(token) != 64 or not all(character in "0123456789abcdef" for character in token):
        raise RuntimeError("production LAN token is invalid")

    run_dir = ARTIFACT_ROOT / str(int(time.time() * 1000))
    run_dir.mkdir(parents=True, exist_ok=False)
    copied_database = run_dir / "tan-studio.sqlite"
    transcript = run_dir / "atom-transcript.jsonl"
    before = read_diagnostics(arguments.port)
    backup_database(PRODUCTION_DATABASE, copied_database)

    service: subprocess.Popen[bytes] | None = None
    simulator: subprocess.Popen[bytes] | None = None
    service_log = (run_dir / "service.log").open("wb")
    simulator_log = (run_dir / "simulator.log").open("wb")
    restored = False
    failure: str | None = None
    after: dict[str, Any] | None = None
    try:
        run_checked(["./script/mac_lan.sh", "stop"], timeout=30)
        environment = os.environ.copy()
        environment.update(
            {
                "TAN_STUDIO_HEADLESS": "1",
                "TAN_STUDIO_BIND_HOST": "0.0.0.0",
                "TAN_STUDIO_PORT": "8080",
                "TAN_STUDIO_BRIDGE_PORT": "8081",
                "TAN_STUDIO_DATABASE_PATH": str(copied_database),
                "TAN_STUDIO_WEB_ROOT": str(WEB_ROOT),
                "TAN_STUDIO_LAN_TOKEN": token,
                "TAN_STUDIO_ALLOWED_ORIGINS": (
                    "http://xrc.local:8080,http://127.0.0.1:8080"
                ),
                "TAN_STUDIO_ALLOWED_HOSTS": "xrc.local:8080,127.0.0.1:8080",
                "RUST_LOG": "tan_studio_service=info",
            }
        )
        service = subprocess.Popen(
            [str(SERVICE)],
            cwd=REPO,
            env=environment,
            stdout=service_log,
            stderr=subprocess.STDOUT,
        )
        wait_for_health(service)
        simulator = subprocess.Popen(
            [
                str(SIMULATOR),
                "cdc",
                "--port",
                arguments.port,
                "--duration-seconds",
                str(arguments.duration_seconds),
                "--transcript",
                str(transcript),
            ],
            cwd=REPO,
            stdout=simulator_log,
            stderr=subprocess.STDOUT,
        )
        wait_for_simulated_sync(service, simulator, arguments.duration_seconds)
        simulator.wait(timeout=arguments.duration_seconds + 15)
        if simulator.returncode != 0:
            failure = f"CDC simulator exited {simulator.returncode}"
    except Exception as error:  # The evidence report is written before re-raising.
        failure = f"{type(error).__name__}: {error}"
    finally:
        if simulator is not None and simulator.poll() is None:
            stop_process(simulator, signal.SIGTERM)
        if service is not None:
            stop_process(service, signal.SIGINT)
        service_log.close()
        simulator_log.close()
        # Measure while no backend is running. Restoring production first can
        # itself exercise a broken firmware tunnel and contaminate the HIL
        # watchdog delta that this report is intended to isolate.
        try:
            after_port = resolve_port(arguments.port)
            after = read_diagnostics(after_port)
        except Exception as error:
            detail = f"post-run diagnostics failed: {type(error).__name__}"
            failure = f"{failure}; {detail}" if failure else detail
        try:
            run_checked(["./script/mac_lan.sh", "start"], timeout=60)
            restored = True
        except Exception as error:
            detail = f"production restore failed: {type(error).__name__}"
            failure = f"{failure}; {detail}" if failure else detail

    deltas = diagnostic_deltas(before, after) if after is not None else None
    database = database_evidence(copied_database)
    report = {
        "schemaVersion": 1,
        "result": (
            "pass"
            if failure is None
            and deltas is not None
            and all(value == 0 for value in deltas.values())
            and database["simulatedLogs"] == 3
            and database["simulatedProfiles"] == 2
            else "fail"
        ),
        "durationSeconds": arguments.duration_seconds,
        "before": before,
        "after": after,
        "counterDeltas": deltas,
        "database": database,
        "transcript": str(transcript),
        "productionServiceRestored": restored,
        "failure": failure,
    }
    report_path = run_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**report, "reportPath": str(report_path)}, indent=2))
    return 0 if report["result"] == "pass" else 1


def read_diagnostics(port: str) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "./script/read_tan_bridge_diagnostics.py",
            port,
            "--attempts",
            "30",
        ],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    result = json.loads(completed.stdout)
    diagnostics = result.get("diagnostics")
    if not isinstance(diagnostics, dict):
        raise RuntimeError("Atom diagnostics are absent")
    return result


def backup_database(source: Path, destination: Path) -> None:
    with sqlite3.connect(source) as source_connection:
        with sqlite3.connect(destination) as destination_connection:
            source_connection.backup(destination_connection)


def wait_for_health(process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("temporary backend stopped before startup")
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/healthz", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.1)
    raise RuntimeError("temporary backend did not become healthy")


def wait_for_simulated_sync(
    service: subprocess.Popen[bytes],
    simulator: subprocess.Popen[bytes],
    duration_seconds: int,
) -> None:
    # The CDC simulator deliberately waits through up to fifteen seconds of
    # macOS re-enumeration before its requested run duration begins.
    deadline = time.monotonic() + 15 + min(duration_seconds, 30)
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        if service.poll() is not None:
            raise RuntimeError("temporary backend stopped during HIL")
        if simulator.poll() is not None:
            raise RuntimeError("CDC simulator stopped before synchronization")
        request = urllib.request.Request(
            "http://127.0.0.1:8080/api/v1/device",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
                "Host": "127.0.0.1:8080",
                "X-Tan-Studio-Client": "tan-studio-api-v1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                last = json.loads(response.read())
        except OSError:
            time.sleep(0.1)
            continue
        if (
            last.get("connection") == "connected"
            and last.get("syncState") == "ready"
            and last.get("profileCount") == 2
            and last.get("logCount") == 3
        ):
            return
        time.sleep(0.1)
    raise RuntimeError(f"real Atom did not complete the virtual Nano sync: {last}")


def resolve_port(previous: str) -> str:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if Path(previous).exists():
            return previous
        candidates = sorted(Path("/dev").glob("cu.usbmodem*"))
        if len(candidates) == 1:
            return str(candidates[0])
        time.sleep(0.25)
    raise RuntimeError("Tan Bridge CDC port did not reappear")


def diagnostic_deltas(before: dict[str, Any], after: dict[str, Any]) -> dict[str, int]:
    before_diagnostics = before["diagnostics"]
    after_diagnostics = after["diagnostics"]
    return {
        key: int(after_diagnostics[key]) - int(before_diagnostics[key])
        for key in (
            "bootCount",
            "brownoutCount",
            "watchdogCount",
            "interruptWatchdogCount",
            "taskWatchdogCount",
            "otherWatchdogCount",
        )
    }


def database_evidence(path: Path) -> dict[str, int]:
    with sqlite3.connect(path) as connection:
        return {
            "simulatedLogs": int(
                connection.execute(
                    "SELECT count(*) FROM native_files "
                    "WHERE source_modified_at='202607220000000' AND kind='klog'"
                ).fetchone()[0]
            ),
            "simulatedProfiles": int(
                connection.execute(
                    "SELECT count(*) FROM native_files "
                    "WHERE source_modified_at='202607220000000' AND kind='kpro'"
                ).fetchone()[0]
            ),
        }


def run_checked(command: list[str], timeout: int) -> None:
    subprocess.run(
        command,
        cwd=REPO,
        check=True,
        timeout=timeout,
        stdout=sys.stderr,
    )


def stop_process(process: subprocess.Popen[bytes], requested_signal: signal.Signals) -> None:
    if process.poll() is not None:
        return
    process.send_signal(requested_signal)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
