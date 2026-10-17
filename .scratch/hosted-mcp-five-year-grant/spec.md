# Five-year hosted MCP grant and branded plugin

Status: ready-for-human

Operator confirmed the exact grant on 2026-10-17: Xavier Codex - Tan Studio, full read/write across the existing 16 hosted tools, five calendar years from issuance. Direct main publication and deployment are authorized. The user also requested the existing Tan Studio logo, a repo commit, and account installation.

Implement an explicit calendar-year term, retaining the default 30 days and existing 1–90 day choices. Reject simultaneous day/year inputs and unsupported year values. Preserve all authentication, revocation, rate, size and concurrency controls. Test calendar arithmetic including leap days and full-write metadata.

Use existing project artwork in portable plugin metadata. Keep secrets out of code, packages, logs and chat. Issuance must occur in the operator's signed-in browser, where the user receives the secret once and transfers it personally. Browser control and account-install tools are unavailable in this execution session; do not bypass the operator session or substitute local installation for account installation.

## Validation

Service: 91 unit, 1 bridge integration, 21 hosted HTTP tests passed. Credential UI: 3 tests passed. Workspace typechecks, web production build, generated API contracts and architecture boundaries passed. Native AMD64 CI and deployed verification follow publication. No production credential has been issued; the signed-in user must receive its one-time value directly.
