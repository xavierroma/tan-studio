# Hosted MCP verification — 16 October 2026

Status: ready-for-human

Implementation commit: `8e7bd8ffff17cc0fcef9919c8892112ec8a37615`.
Baseline: `6c4af912173dcad06221139ce6838fd6b938a2fc`.
This follow-up changes verification fixtures and documentation only; production behavior is unchanged.

## Desktop failure comparison

A fresh, separate checkout of the unchanged baseline ran `bun install --frozen-lockfile` and `bun run --cwd apps/desktop build` on the same Mac (Darwin arm64, Bun 1.4.2, Rust 1.97.1, Xcode 27.1). It failed with `E0463: can't find crate for ctor_proc_macro`, the same first failure as the MCP branch. The baseline working tree remained clean. A targeted dependency-cache retry on the MCP branch failed loading `libdarling_macro` with `mis-aligned LINKEDIT string pool`.

`git diff 6c4af91 8e7bd8f -- apps/desktop package.json` is empty. Both checkouts have identical desktop hashes:

- Cargo.toml: `1413a267af7da089f894af08a663753a22a5a62f281cd0f8ab7fa020b91a3488`
- Cargo.lock: `1d0299487d9fa4739fcd7cc05e082c51a4a2502c5f5859aa4accffe228bc7459`

The packaging failure therefore reproduces before the MCP implementation. No unrelated desktop/compiler workaround was added. The complete `bun run check` remains blocked at this pre-existing packaging step.

## Exact test counts

The original full gate passed all typechecks, **286 tests**, and **118 hosted shell assertions**, before desktop packaging failed:

| Suite | Passed |
|---|---:|
| Rust service unit tests | 87 |
| Rust hosted integration tests | 16 |
| MCP plugin | 31 |
| Web UI | 27 |
| Desktop | 8 |
| Serial bridge | 3 |
| UI package | 1 |
| Domain | 7 |
| Device Sassi | 23 |
| Native format adapters | 17 |
| Application | 7 |
| API contract | 13 |
| Printing adapters | 9 |
| Companion | 37 |

Follow-up verification passed:

- Native macOS arm64, Bun 1.4.2: **1 targeted end-to-end test**, now using a real ephemeral loopback HTTP listener and official client fetch, private Unix authorization and real Rust REST. **31 MCP tests** and plugin typecheck also passed again.
- Native Docker Linux aarch64, Bun 1.4.2, Rust 1.97.1: **134 tests** (31 MCP + 87 Rust unit + 16 Rust hosted integration), **0 failures**. The end-to-end test starts the actual bundled `http-server.js` subprocess with the production entrypoint's fixed ports inside the isolated container. It verifies readiness, unauthenticated 401, 8/16 scoped catalogs, reads/writes, server attribution, stale revisions, and MCP-token rejection by REST.
- Docker execution used `--network none`, no mounts and no published ports. Temporary databases/credentials/socket are fixture-only and removed with the container. No production resources were contacted.

Counts across the repeated runs are not distinct test cases; do not add them together.

## Linux target distinction

The Linux AMD64 release build succeeded, and its Rust executable generated OpenAPI under local emulation. Its bundled HTTP JavaScript matches the checked-in SHA-256. However, QEMU on this ARM Mac crashes AMD64 Bun 1.4.2 before the smoke script executes. Native ARM64 Linux passing does not establish AMD64 runtime success.

The checked-in `deploy/hosted/Dockerfile.verify` and `verify-mcp-runtime.sh` provide a reproducible native test route. For the remaining AMD64 check, run them on a **non-production native x86-64 Linux machine with Docker**, for example a dedicated Debian 13 test VM. Build-time dependency downloads are needed; runtime is isolated with `--network none`. No credentials, production configuration, domain or public ports are needed. Actual systemd/Caddy ownership/restart and e2-micro memory/load validation remain separate rollout checks.

## Review and eventual activation

The branch is local and unpushed; this task created no GitHub PR. A small patch/docs/checksums bundle supports remote review. The full Linux release remains at `dist/hosted/hosted-mcp-review-20261016` in the isolated implementation checkout.

Nothing was deployed or enabled, and no real agent credential was created. Eventual approval must identify:

1. The concrete reviewed release to install on the hosted VM, including schema 15 migration, snapshot and service restarts.
2. Enabling public authenticated `/mcp`, including the dedicated Unix identity, private socket configuration, Bun systemd service and Caddy route.
3. The specific agent/client, whether it supports bearer headers, read-only versus write access, and credential expiry. Default proposed grant is read only for 30 days; no grant has been approved or made.

OAuth-only clients require another implementation milestone. A schema-14 binary cannot be used as a simple rollback after migration; disable MCP while retaining compatible Rust.

## Evidence files

- `/tmp/tan-studio-full-check.log`
- `/tmp/tan-studio-baseline-build.log`
- `/tmp/tan-studio-desktop-build-retry.log`
- `/tmp/tan-studio-native-macos-e2e.log`
- `/tmp/tan-studio-native-linux-build.log`
- `/tmp/tan-studio-native-linux-tests.log`
- `/tmp/tan-studio-followup-typecheck.log`
- `/tmp/tan-studio-followup-mcp-tests.log`
