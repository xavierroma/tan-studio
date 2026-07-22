#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
test_binary="$(mktemp -t tan-bridge-setup-policy.XXXXXX)"
trap 'rm -f "${test_binary}"' EXIT

cc -std=c11 -Wall -Wextra -Werror -pedantic \
  -I "${repo_root}/firmware/tan-bridge-setup/main" \
  "${repo_root}/firmware/tan-bridge-setup/main/tunnel_policy.c" \
  "${repo_root}/firmware/tan-bridge-setup/host-tests/test_tunnel_policy.c" \
  -o "${test_binary}"
"${test_binary}"
