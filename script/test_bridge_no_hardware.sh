#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

cargo test --manifest-path apps/service/Cargo.toml
bun run --filter @tan-studio/device-sassi test
bun run --cwd plugins/tan-studio test
python3 ./script/test_tan_bridge_setup_contract.py
./script/test_tan_bridge_setup_host.sh
./script/test_tan_bridge_host.sh
python3 ./script/test_simulated_nano_e2e.py
