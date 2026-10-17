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

After deploying d74e8bb, metadata-only diagnostics consistently locate remaining reconnect failures at AwaitingHandshake. The previous 750 ms replay-drain logic discarded every cached capability request and waited forever for a new request from a Nano whose USB session was still open. Retain the newest validated request during the settling interval and answer it if no fresh request arrives; if a newer CRC seed arrives while awaiting the time-sync acknowledgement, prefer that request. The regression test now completes negotiation from one replayed request without requiring the peer to repeat it. Full service tests still pass (90 + 1 + 21). Device inventory and the two reported new logs remain unverified until an actual complete sync succeeds.


## Post-reseat failure and receive-boundary reproduction (2026-10-17)

Run 43265 began at 17:00:29.725 UTC after the USB reseat restored negotiation. It failed at 17:00:53.901 with InvalidCrc during a file transfer: 77,480 decoded bytes, expected sequence 27. No roast imports. From 17:00:58 onward, WSS authenticates but SASSI remains AwaitingHandshake; the 17:09 report corresponds to this loop. The old diagnostics did not record a requested filename, packet kind, or received wire bytes during negotiation, so they cannot establish which file failed or where corruption occurred.

Two independent server defects reproduced with synthetic coalesced reads, failing before the fix: (1) final transfer response followed by type-32 notification silently drops the notification and its ACK; (2) handshake followed by a packet using its new seed is decoded in one batch using the old seed and fails CRC. Decode one frame at a time, retaining unread bytes between calls so state changes take effect before subsequent decoding. New handshake during transfer aborts incomplete content with an explicit reason. No retry, CRC bypass, device reset, firmware flash or file deletion is introduced.

Safe diagnostics now include bounded requested path, expected/received sequence, decoded byte count, numeric rejected-frame kind/length, negotiation wire-byte count and inventory counts. No frame contents, CRC seeds, tokens or credentials are logged. These fixtures prove software defects, not the exact cause of the historical packet-27 failure.

Atom setup firmware source also discards a USB receive queue enqueue failure and a bridge-mutex timeout without counters; these are possible loss paths, not yet measured on the deployed 0.3.2-hosted firmware. The repository source identifies itself as 0.3.1-hosted. Read-only setup.getStatus on the actual Atom is needed to verify build identity and reset/network diagnostics before attributing firmware behavior.
