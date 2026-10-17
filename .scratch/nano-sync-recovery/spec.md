# Recover hosted Nano synchronization

Status: in progress

The operator reported two new roasts missing on 17 October 2026, shortly after the MCP deployment. Read-only production comparison proves all 25 roast rows are byte-for-field equal to the pre-deployment snapshot. Latest imported native log number is 24. The last successful sync was run 4851 on 6 September; on 17 October the old service produced 38,408 device_busy failures before the release. Bridge authentication succeeds, but 31 SASSI negotiation timeouts occurred in the hour before deployment. After deployment, complete-file reads also returned timeouts and invalid CRCs. These are not evidence of notebook data loss.

Confirmed defects in the existing Rust session loop (also present in upstream main before MCP):

- The busy filesystem path retries every poll and inserts another failed sync run rather than waiting for the unlock notification.
- Type-32 incremental-file notifications are decoded but ignored, whereas the documented protocol and older TypeScript adapter acknowledge every notification with type 1, including final fragments.
- A completed initial sync permanently sets sync_attempted; a later roast's busy/unlock notifications do not schedule another sync.

Fix: acknowledge incremental notifications during idle and complete-file transfers, defer imports while busy, poll read-only operational status every five seconds to recover a missed unlock, and schedule complete-file imports after unlock/notifications. Import only verified full files through existing transactional importers; do not persist provisional incremental fragments or relax CRC checks. Add metadata-only failure diagnostics for transfer kind, received byte count, expected sequence and negotiation phase; never log raw frames, device credentials or file contents.

Regression tests use the virtual Nano plus an ACK-gated transfer that cannot finish until a type-32 notification is acknowledged. They verify no busy sync-history flood, resync after unlock, and notification ACKs during idle/transfer. Full service tests pass: 90 unit + 1 hosted bridge + 21 hosted mode. Native AMD64 CI and actual-device verification follow publication directly to main.

Separate deliverable: portable Codex hosted plugin under plugins/tan-studio-hosted, following current official root plugin.json/mcp.json schemas with bearer API-key metadata and no token. Requested five-year write grant remains unissued. Current server maximum is 90 days; exact capability/expiry approval and a server limit change are needed before issuance. No authentication or scope limits are changed by this fix.
