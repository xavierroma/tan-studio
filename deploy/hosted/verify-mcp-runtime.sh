#!/usr/bin/env bash
# Intended for the isolated native Docker image. No host mounts or public ports.
set -euo pipefail
[[ -f /.dockerenv ]] || { echo 'Use the isolated Docker verification image.' >&2; exit 2; }
[[ "${TAN_TEST_BUNDLED_MCP:-}" == 1 ]] || exit 2
uname -sm
bun --version
rustc --version
bun run --cwd plugins/tan-studio test
cargo test --locked --manifest-path apps/service/Cargo.toml
