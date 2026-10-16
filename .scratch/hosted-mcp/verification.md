# Integrated hosted MCP verification — 16 October 2026

Status: local review candidate; no push, PR, CI dispatch, deployment, public enablement or real agent access.

Base: upstream `4b8ec415f885dc471911e61bf9b200cc444434a7`. The local merge preserves the hosted bridge WebSocket, operator-only bridge enrollment/revocation, TLS RSA/ISRG Root X1 settings, hosted stdio defaults and native Rust cross compilation. Bridge migration `0015_bridge_revocation.sql`, ADR 0008 and the bridge session implementation/tests are unchanged from upstream. Agent credentials use migration **16** and ADR **0009**. A new upgrade test verifies an existing revoked bridge and the migration-15 hash survive, and that no agent credential is created by migration.

**Obsolete:** release `hosted-mcp-review-20261016`, commits `8e7bd8f`/`fa3ca67` as standalone candidates, and both previously delivered review bundles. They predate upstream migration 15 and must not be installed. The integrated patch must be applied against the exact base above, not the earlier base.

## Integrated checks

- Architecture boundaries, all workspace typechecks, Rust formatting and workflow YAML/Prettier checks pass.
- **296 application tests pass**, including the real HTTP MCP end-to-end fixture. The full test command then found an upstream ShellCheck SC2016 warning on a deliberately literal Docker variable. A narrow documented suppression fixes it; the affected hosted suite was rerun and **122 shell assertions pass**. Application tests were not repeated for that comment-only test-script correction.
- Web and both MCP bundles build successfully. Generated contracts were regenerated after the merge.
- Caddy 2 validates the merged TLS configuration both with and without the optional MCP route, using local fixture settings and network-disabled containers.

| Suite | Passed |
|---|---:|
| Rust service unit | 88 |
| Rust hosted bridge integration | 1 |
| Rust hosted mode integration | 21 |
| MCP plugin | 32 |
| Web UI | 28 |
| Desktop | 8 |
| Serial bridge | 3 |
| UI package | 1 |
| Domain | 7 |
| Device Sassi | 23 |
| Native format adapters | 17 |
| Application | 7 |
| API contract | 14 |
| Printing adapters | 9 |
| Companion | 37 |

Native Linux ARM64 runtime verification passed **142 tests** (32 MCP + 88 Rust unit + 1 hosted bridge + 21 hosted mode), zero failures, using the actual bundled HTTP entrypoint and a network-disabled container with no mounts or published ports. The integrated Linux AMD64 release build also passed: both Rust and Bun are verified x86-64 ELF files, and the released HTTP bundle exactly matches the checked-in SHA-256 `91e3cdff4bcb80612374232ad563e7382aa9d55d0a68e223fe52bd8950a73711`. Release output: `dist/hosted/hosted-mcp-integrated-20261016`. Repeated architecture runs are not additional distinct test cases.

## AMD64 workflow prepared locally

`.github/workflows/hosted-mcp-verify.yml` is PR-only, restricted to the same-repository `codex/hosted-mcp` branch targeting main. It uses `ubuntu-24.04`, asserts x86_64, builds `Dockerfile.verify` for linux/amd64 and executes tests with `--network none`, no host mounts and no published ports. The checkout action is pinned to its observed official v4 SHA and uses `persist-credentials: false`; the token has only `contents: read`. There are no secret references, cloud credentials, deployment environments, push triggers or manual dispatch triggers. Dependency downloads occur only during the image build.

The workflow has **not been pushed or run**. Native AMD64 runtime verification remains outstanding. Earlier AMD64 Bun under QEMU on this ARM Mac crashed before the smoke script ran; ARM64 success cannot establish AMD64 runtime compatibility. Creating the PR after approval will itself trigger this workflow; it needs no dispatch call. Deployment, public enablement and granting a real agent access remain separate decisions.

## Desktop packaging limitation

The earlier complete `bun run check` passed typechecks and tests, then failed during desktop packaging. A fresh separate checkout of baseline `6c4af912173dcad06221139ce6838fd6b938a2fc` reproduced the same first failure, `E0463: can't find crate for ctor_proc_macro`, on Darwin arm64, Bun 1.4.2, Rust 1.97.1 and Xcode 27.1. A targeted dependency-cache retry on the MCP branch failed loading `libdarling_macro` with `mis-aligned LINKEDIT string pool`.

Desktop code and manifests are unchanged by this integration. Both compared checkouts had identical desktop hashes:

- Cargo.toml: `1413a267af7da089f894af08a663753a22a5a62f281cd0f8ab7fa020b91a3488`
- Cargo.lock: `1d0299487d9fa4739fcd7cc05e082c51a4a2502c5f5859aa4accffe228bc7459`

No unrelated compiler workaround was added. Integrated desktop typechecks and eight tests pass. Desktop release packaging was not repeated; the complete all-artifact gate remains limited by that pre-existing packaging failure.

## Operational limits

No production resource was modified or authenticated notebook call made, and no real credential was created. Test databases, credentials, sockets and processes are disposable fixtures. The future endpoint is `https://studio.tan.coffee/mcp`; this report does not establish that it is live. Authentication is per-agent bearer, default read only for 30 days; OAuth-only clients are unsupported.

Actual systemd ownership/restart, VM memory/load and authenticated production verification remain rollout checks. After schema 16, do not restore a schema-15 binary over the upgraded database; disable MCP while retaining compatible Rust. A database restore requires accounting for writes since the snapshot.

## Local evidence

- `/tmp/tan-studio-integrated-typecheck.log`
- `/tmp/tan-studio-integrated-tests.log`
- `/tmp/tan-studio-integrated-hosted-tests.log`
- `/tmp/tan-studio-integrated-web-build.log`
- `/tmp/tan-studio-integrated-caddy.log`
- `/tmp/tan-studio-integrated-caddy-disabled.log`
- `/tmp/tan-studio-integrated-linux-build.log`
- `/tmp/tan-studio-integrated-linux-tests.log`
- `/tmp/tan-studio-integrated-release.log`
- Historical desktop comparison: `/tmp/tan-studio-baseline-build.log` and `/tmp/tan-studio-desktop-build-retry.log`
