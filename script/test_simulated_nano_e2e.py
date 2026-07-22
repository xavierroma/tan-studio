#!/usr/bin/env python3
"""Process-level Tan Studio smoke test using a stateful virtual Nano."""

from __future__ import annotations

import json
import os
import signal
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parent.parent
SERVICE = REPO / "apps/service/target/debug/tan-studio-service"
SIMULATOR = REPO / "apps/service/target/debug/tan-nano-simulator"
WEB_ROOT = REPO / "apps/web/dist"
ARTIFACT_ROOT = REPO / "tmp/simulation"
TOKEN = "f" * 64


def main() -> int:
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
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
    run_checked(
        ["bun", "run", "--cwd", "plugins/tan-studio", "build"], timeout=300
    )

    direct = run_direct_simulation()
    bridge = run_bridge_simulation()
    report = {
        "schemaVersion": 1,
        "directSession": direct,
        "authenticatedTunnel": bridge,
        "result": "pass",
    }
    report_path = ARTIFACT_ROOT / "latest-summary.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**report, "reportPath": str(report_path)}, indent=2))
    return 0


def run_direct_simulation() -> dict[str, Any]:
    run_dir = new_run_dir("direct")
    api_port, bridge_port = free_ports(2)
    database = run_dir / "tan-studio.sqlite"
    transcript = run_dir / "direct-transcript.jsonl"
    process, logs = start_service(
        run_dir,
        api_port,
        bridge_port,
        database,
        {
            "TAN_STUDIO_SIMULATED_NANO": "smoke",
            "TAN_STUDIO_SIMULATION_E2E": "1",
            "TAN_STUDIO_SIMULATION_TRANSCRIPT_PATH": str(transcript),
        },
    )
    try:
        wait_for_service(api_port, process, logs)
        first = wait_for_sync(api_port, process, logs)
        api_evidence = verify_api_and_idempotency(api_port)
    finally:
        stop_process(process, signal.SIGINT)
        logs.close()
    if process.returncode != 0:
        raise AssertionError(f"direct service exited {process.returncode}: {read_log(run_dir)}")
    if not transcript.is_file() or transcript.stat().st_size == 0:
        raise AssertionError("direct simulation transcript was not written")
    database_evidence = verify_database(database)
    return {
        "device": first,
        "api": api_evidence,
        "database": database_evidence,
        "transcript": str(transcript),
    }


def run_bridge_simulation() -> dict[str, Any]:
    run_dir = new_run_dir("bridge")
    api_port, bridge_port = free_ports(2)
    database = run_dir / "tan-studio.sqlite"
    transcript = run_dir / "bridge-transcript.jsonl"
    service, service_logs = start_service(
        run_dir, api_port, bridge_port, database, {}
    )
    simulator: subprocess.Popen[bytes] | None = None
    simulator_logs = None
    try:
        wait_for_service(api_port, service, service_logs)
        claim = api_request(api_port, "/api/v1/bridges/claims", method="POST")
        claim_token = claim.get("claimToken")
        if not isinstance(claim_token, str) or len(claim_token) != 64:
            raise AssertionError("bridge claim response is invalid")
        simulator_log_path = run_dir / "simulator.log"
        simulator_logs = simulator_log_path.open("wb")
        simulator_environment = os.environ.copy()
        simulator_environment["TAN_STUDIO_BRIDGE_CLAIM_TOKEN"] = claim_token
        simulator = subprocess.Popen(
            [
                str(SIMULATOR),
                "bridge",
                "--host",
                "127.0.0.1",
                "--port",
                str(bridge_port),
                "--bridge-id",
                "abcdefghijklmnopqrstuvwxyz",
                "--duration-seconds",
                "30",
                "--transcript",
                str(transcript),
            ],
            cwd=REPO,
            env=simulator_environment,
            stdout=simulator_logs,
            stderr=subprocess.STDOUT,
        )
        first = wait_for_sync(api_port, simulator, simulator_logs)
        run_browser_smoke(api_port, run_dir)
        run_mcp_smoke(api_port, run_dir)
        api_evidence = verify_api_and_idempotency(api_port)
        simulator.wait(timeout=40)
        if simulator.returncode != 0:
            raise AssertionError(
                f"virtual bridge exited {simulator.returncode}: "
                f"{simulator_log_path.read_text(encoding='utf-8', errors='replace')}"
            )
    finally:
        if simulator is not None and simulator.poll() is None:
            stop_process(simulator, signal.SIGTERM)
        if simulator_logs is not None:
            simulator_logs.close()
        stop_process(service, signal.SIGINT)
        service_logs.close()
    if service.returncode != 0:
        raise AssertionError(f"bridge service exited {service.returncode}: {read_log(run_dir)}")
    if not transcript.is_file() or transcript.stat().st_size == 0:
        raise AssertionError("bridge simulation transcript was not written")
    database_evidence = verify_database(database)
    return {
        "device": first,
        "api": api_evidence,
        "database": database_evidence,
        "transcript": str(transcript),
        "browser": "pass",
        "mcp": "pass",
    }


def start_service(
    run_dir: Path,
    api_port: int,
    bridge_port: int,
    database: Path,
    additions: dict[str, str],
) -> tuple[subprocess.Popen[bytes], Any]:
    log = (run_dir / "service.log").open("wb")
    environment = os.environ.copy()
    environment.update(
        {
            "TAN_STUDIO_HEADLESS": "1",
            "TAN_STUDIO_BIND_HOST": "127.0.0.1",
            "TAN_STUDIO_PORT": str(api_port),
            "TAN_STUDIO_BRIDGE_PORT": str(bridge_port),
            "TAN_STUDIO_DATABASE_PATH": str(database),
            "TAN_STUDIO_WEB_ROOT": str(WEB_ROOT),
            "TAN_STUDIO_LAN_TOKEN": TOKEN,
            "TAN_STUDIO_ALLOWED_ORIGINS": f"http://127.0.0.1:{api_port}",
            "TAN_STUDIO_ALLOWED_HOSTS": f"127.0.0.1:{api_port}",
            "RUST_LOG": "tan_studio_service=info",
            **additions,
        }
    )
    process = subprocess.Popen(
        [str(SERVICE)],
        cwd=REPO,
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    return process, log


def wait_for_service(api_port: int, process: subprocess.Popen[bytes], logs: Any) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            logs.flush()
            raise AssertionError(f"service stopped before startup: {read_log(logs.name)}")
        try:
            bootstrap = api_request(api_port, "/api/v1/system/bootstrap")
            if bootstrap.get("recoveryState") == "ready":
                return
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(0.05)
    raise AssertionError("service did not become ready")


def wait_for_sync(
    api_port: int, process: subprocess.Popen[bytes], logs: Any
) -> dict[str, Any]:
    deadline = time.monotonic() + 20
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        if process.poll() is not None:
            logs.flush()
            raise AssertionError(f"simulation stopped before sync: {read_log(logs.name)}")
        last = api_request(api_port, "/api/v1/device")
        if (
            last.get("connection") == "connected"
            and last.get("syncState") == "ready"
            and last.get("profileCount") == 2
            and last.get("logCount") == 3
        ):
            expected = {
                "importedLogCount": 3,
                "updatedLogCount": 0,
                "importWarningCount": 0,
                "quarantinedLogCount": 0,
                "importedProfileCount": 2,
                "profileWarningCount": 0,
                "quarantinedProfileCount": 0,
                "readOnly": True,
            }
            for key, value in expected.items():
                if last.get(key) != value:
                    raise AssertionError(f"unexpected device {key}: {last.get(key)!r}")
            return last
        time.sleep(0.05)
    raise AssertionError(f"simulated synchronization did not finish: {last}")


def verify_api_and_idempotency(api_port: int) -> dict[str, Any]:
    roast_page = api_request(api_port, "/api/v1/roasts")
    items = roast_page.get("items")
    if not isinstance(items, list) or [item.get("id") for item in items] != [3, 2, 1]:
        raise AssertionError(f"unexpected roast ordering: {items}")
    detail = api_request(api_port, "/api/v1/roasts/3")
    stream = detail.get("sampleStream")
    if not isinstance(stream, dict) or stream.get("rowCount") != 3:
        raise AssertionError(f"unexpected sample stream: {stream}")
    version = stream.get("streamVersion")
    series = api_request(
        api_port,
        f"/api/v1/roasts/3/series?streamVersion={version}&maxPoints=100",
    )
    points = series.get("points")
    if not isinstance(points, list) or len(points) != 3:
        raise AssertionError(f"unexpected series: {series}")

    repeated = api_request(api_port, "/api/v1/device/synchronize", method="POST")
    if repeated.get("syncState") != "ready" or repeated.get("importedLogCount") != 0:
        raise AssertionError(f"repeat synchronization was not idempotent: {repeated}")
    repeated_roasts = api_request(api_port, "/api/v1/roasts").get("items")
    if not isinstance(repeated_roasts, list) or len(repeated_roasts) != 3:
        raise AssertionError("repeat synchronization duplicated roasts")
    return {
        "roastIds": [item["id"] for item in items],
        "samplePoints": len(points),
        "repeatImportedLogs": repeated["importedLogCount"],
    }


def verify_database(path: Path) -> dict[str, int]:
    with sqlite3.connect(path) as connection:
        counts = {
            "roasts": scalar(connection, "SELECT count(*) FROM roasts"),
            "profiles": scalar(connection, "SELECT count(*) FROM profiles"),
            "seriesPoints": scalar(
                connection, "SELECT count(*) FROM roast_series_points"
            ),
            "nativeFiles": scalar(connection, "SELECT count(*) FROM native_files"),
            "invalidHashes": scalar(
                connection,
                "SELECT count(*) FROM native_files WHERE length(sha256) != 64",
            ),
        }
    expected = {
        "roasts": 3,
        "profiles": 4,
        "seriesPoints": 9,
        "nativeFiles": 5,
        "invalidHashes": 0,
    }
    if counts != expected:
        raise AssertionError(f"unexpected database evidence: {counts}")
    return counts


def run_browser_smoke(api_port: int, run_dir: Path) -> None:
    environment = os.environ.copy()
    environment.update(
        {
            "TAN_STUDIO_E2E_URL": f"http://127.0.0.1:{api_port}",
            "TAN_STUDIO_E2E_OUTPUT": str(run_dir / "playwright"),
        }
    )
    subprocess.run(
        [
            "bun",
            "run",
            "--cwd",
            "apps/web",
            "test:e2e",
            "--",
            "e2e/simulated-nano.smoke.spec.ts",
        ],
        cwd=REPO,
        env=environment,
        check=True,
        timeout=120,
    )


def run_mcp_smoke(api_port: int, run_dir: Path) -> None:
    environment = os.environ.copy()
    environment.update(
        {
            "TAN_STUDIO_URL": f"http://127.0.0.1:{api_port}",
            "TAN_STUDIO_API_TOKEN": TOKEN,
            "TAN_STUDIO_TIMEOUT_MS": "5000",
            "TAN_STUDIO_SYNC_DEVICE": "1",
        }
    )
    with (run_dir / "mcp.log").open("wb") as log:
        subprocess.run(
            [
                "bun",
                "run",
                "--cwd",
                "plugins/tan-studio",
                "test:live",
            ],
            cwd=REPO,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=120,
        )


def api_request(api_port: int, path: str, method: str = "GET") -> dict[str, Any]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{api_port}{path}",
        data=b"{}" if method == "POST" else None,
        method=method,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "X-Tan-Studio-Client": "tan-studio-api-v1",
        },
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read())


def scalar(connection: sqlite3.Connection, query: str) -> int:
    row = connection.execute(query).fetchone()
    if row is None:
        raise AssertionError(f"query returned no rows: {query}")
    return int(row[0])


def free_ports(count: int) -> list[int]:
    sockets: list[socket.socket] = []
    try:
        for _ in range(count):
            handle = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            handle.bind(("127.0.0.1", 0))
            sockets.append(handle)
        return [int(handle.getsockname()[1]) for handle in sockets]
    finally:
        for handle in sockets:
            handle.close()


def new_run_dir(name: str) -> Path:
    path = ARTIFACT_ROOT / f"{int(time.time() * 1000)}-{name}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def run_checked(command: list[str], timeout: int) -> None:
    subprocess.run(command, cwd=REPO, check=True, timeout=timeout)


def stop_process(process: subprocess.Popen[bytes], requested_signal: signal.Signals) -> None:
    if process.poll() is not None:
        return
    process.send_signal(requested_signal)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def read_log(path_or_name: str | Path) -> str:
    path = Path(path_or_name)
    if path.is_dir():
        path = path / "service.log"
    return path.read_text(encoding="utf-8", errors="replace")[-8_000:]


if __name__ == "__main__":
    raise SystemExit(main())
