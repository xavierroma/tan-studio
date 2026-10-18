# Tan Studio Hosted: operator grant record

This record belongs to the notebook operator's own setup. It is **not** part of the downloadable Codex plugin (`apps/web/codex-plugin-package.ts` ships `plugins/tan-studio-hosted` from an allowlist), and it grants nothing to anyone else. Every other user chooses their own label, access and lifetime in Settings → Agents.

Moved verbatim from `plugins/tan-studio-hosted/README.md` (version 1.0.1):

## Approved grant — user completes secure issuance

Approved label: **Xavier Codex - Tan Studio**. The original approved grant covered 16 hosted workflow tools. On 2026-10-17 the operator requested complete programmatic API exposure. The catalog now derives one `tan_api_*` tool per versioned OpenAPI operation, alongside those workflow tools. Read/write grants and the REST API's operator-session checks still apply; no operating-system or physical-roaster access is added.

Approved term: **five calendar years from issuance**. Select **Five calendar years** in the signed-in Agent connections form. If issued on 2026-10-17, expiry is 2031-10-17 at the issuance time. The server calculates the calendar expiry; it retains the 30-day default for other grants. The exact expiry appears in the credential list after issuance. This package contains no credential and does not issue one. Keep revocation available; internal REST delegations still last at most 60 seconds and check parent revocation.

The operator confirmed this exact full read/write five-year grant on 2026-10-17. Do not ask to approve it again within that authorized setup. The user must create it in their own signed-in browser so its one-time value stays with them, then enter that value into the client's private credential field. Account-wide installation is separate from the local marketplace route and has not been completed.
