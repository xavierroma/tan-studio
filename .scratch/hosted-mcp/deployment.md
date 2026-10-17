# Hosted MCP direct deployment — 17 October 2026

Status: in progress

Xavier authorized direct publication to main and deployment on 17 October 2026. The earlier PR-only plan is superseded. No PR is needed. The existing hosted deployment workflow remains authoritative.

The implementation integrates upstream `4b8ec415f885dc471911e61bf9b200cc444434a7` and preserves its bridge migration 15, authenticated WebSocket and TLS settings. MCP adds migration 16. Historical verification and the previous review bundle refer to implementation `a226c53e`; the deployment revision additionally changes the isolated AMD64 workflow to run on pushes to main.

Native AMD64 verification runs on GitHub's Ubuntu x64 runner, using the existing Docker verification image. Runtime tests have no external network, host mounts, published ports or production credentials. The workflow has a read-only repository token, retains no checkout credential, and performs no deployment. Deployment proceeds through the repository's existing hosted installer only after the native runtime gate passes.

The script's default `~/.ssh/id_ed25519_tan_studio` is absent on this Mac. The existing `~/.ssh/google_compute_engine` key documented in `.scratch/hosted-v2/issues/H2-deploy-pipeline.md` successfully accesses the existing host without modifying authorization. Use the supported `TAN_STUDIO_HOSTED_SSH_KEY` override.

Pre-deployment inspection: existing service, Caddy and Litestream are active; live database schema is 15; VM is Linux x86_64 with about 450 MiB available memory and 5.8 GiB free disk. Existing current release is `6c4af912173d-dirty-20260831002234`.

Deployment authorization covers the hosted MCP service and its authenticated HTTPS route. No new agent credential, SSH key, cloud IAM grant or firewall change is authorized or required. Creating persistent agent access remains a separate action. The release's dedicated non-login local service identity isolates Bun from notebook data and operator credentials.

Rollback strategy after migration 16: disable the MCP route/service while retaining the compatible Rust release. The prior schema-15 binary cannot safely reopen schema 16. Confirm a consistent pre-deploy snapshot and its integrity before installation; preserve Litestream replication. Restoring the old database would discard later writes and requires a separate recovery decision.
