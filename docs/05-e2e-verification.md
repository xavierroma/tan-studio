# Tan Studio end-to-end verification

- **Verification date:** 2026-07-19
- **Host:** Apple Silicon Mac, macOS, local Rust service, Vite/React client
**Data source:** 13 native roast logs from Kaffeelogic Studio's application-support directory

This report records what has been exercised against real user data. It is an evidence boundary, not a claim that every Kaffeelogic firmware or historical `.klog` variant has been observed.

## Result

Tan Studio imported all 13 available native logs transactionally with no warnings or quarantined files. SQLite contains 13 roast records, 13 sample-stream manifests, and 6,167 telemetry rows. `PRAGMA quick_check` returns `ok`.

Every imported stream's declared row count matches both the native file's parsed numeric-row count and the number of rows persisted in SQLite:

| Native log | Parsed rows | SQLite rows | Channels | Duration (ms) | Process result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 25 | 25 | 13 | 6,010 | Interrupted |
| 2 | 776 | 776 | 13 | 539,136 | Completed |
| 3 | 746 | 746 | 13 | 496,071 | Completed |
| 4 | 778 | 778 | 13 | 539,213 | Completed |
| 5 | 634 | 634 | 13 | 390,540 | Completed |
| 6 | 4 | 4 | 13 | 0 | Interrupted |
| 7 | 20 | 20 | 13 | 3,198 | Interrupted |
| 8 | 35 | 35 | 13 | 18,997 | Interrupted |
| 9 | 4 | 4 | 13 | 0 | Interrupted |
| 10 | 709 | 709 | 13 | 465,425 | Completed |
| 11 | 883 | 883 | 13 | 594,720 | Completed |
| 12 | 794 | 794 | 13 | 556,257 | Completed |
| 13 | 759 | 759 | 13 | 521,216 | Completed |

Interrupted roasts remain valid roast records and retain all available samples. The notebook labels and filters these separately instead of presenting them as successful roasts awaiting tasting.

## Kaffeelogic Studio parity check

Native log 13 was opened in Kaffeelogic Studio and in Tan Studio. The following values agree:

| Observation | Kaffeelogic Studio | Tan Studio |
| --- | ---: | ---: |
| Roast end time | 8:41 | 8:41 |
| Roast end temperature | 216.6 °C | 216.6 °C |
| Native data rows | 759 | 759 |
| Native channels | 13 | 13 |
| Roasting level | 2.0 | 2.0 |
| Green load | 50 g | 50 g |

The end annotation uses the mean-temperature channel, matching Studio, while preserving the independently offset spot-temperature channel for charting. Tan Studio retains and visualizes the native temperature, mean temperature, profile, profile ROR, actual ROR, desired ROR, power, fan, PID, and incidental channel values present in the file.

## UI and API workflow checks

The following flows were exercised against the Rust API and the real local database:

- Roast notebook search, grouping, sorting, date, provider, process, score, and status controls are URL-backed and survive reload.
- The packaged Tauri app opens native log 13, renders the ECharts telemetry view in macOS WebKit, and preserves `/roasts/13` plus its graph across reload. Roast detail loads telemetry separately from notebook rows, displays all native channels, and provides an explicit Notebook back action.
- Invalid roast references render a recoverable error view instead of crashing the application.
- Catalog acquisition creates provider, coffee, purchase, lot, and inventory records transactionally; the new lot survives reload.
- Catalog search and selected-lot state are URL-backed.
- Brew defaults persist through the API and survive reload.
- An invalid brew roast reference produces a visible recoverable error and does not create a record.
- The React client consumes the OpenAPI-generated client; it does not hand-maintain endpoint response types.

Temporary catalog and preference values created solely for E2E testing were removed or restored after verification. The retained development database contains the 13 real roast logs.

The existing desktop database was also upgraded from the former TypeScript companion's migration ledger to the canonical Rust ledger after hash validation and an automatic backup. The executable launch check requires both the desktop shell and its Rust sidecar to remain alive, preventing a shell-only false positive.

## Parser safety boundary

Zero warnings for this corpus does not prove universal compatibility. Safety comes from the import behavior:

- Original bytes are retained by content hash before projection.
- Known metadata and every numeric channel are parsed; unknown metadata remains in the native projection.
- Numeric, timestamp, channel-count, row-count, and SQLite `STRICT`/trigger constraints are checked before commit.
- A file import is atomic. A malformed or incompatible file is quarantined with diagnostics rather than partially inserted.
- Re-import is idempotent by content hash and native identity.
- Parser and schema versions remain attached to provenance so projections can be rebuilt after parser improvements.

The automated test suite includes fragmented SASSI frame parsing, CRC mutation rejection, RFC 3339 fallback dates, all-channel native-log parsing, transactional re-import, migration application, API field allowlisting, and generated-schema compatibility.

## Hardware status and remaining gate

At the end of this verification macOS exposed no `/dev/cu.usbmodem*` or `/dev/tty.usbmodem*` node, and the Nano was absent from the USB system report. Consequently, live USB discovery and an on-device sync cannot truthfully be marked E2E-passing in this run. The service fails closed as disconnected/read-only; it does not issue speculative writes.

Once the Nano enumerates, the remaining acceptance run is:

1. Confirm passive SASSI capability discovery.
2. Compare the service's device log inventory with Studio's inventory.
3. Import into a disposable database and repeat row/channel/hash reconciliation.
4. Run one live roast with Studio closed and compare the completed log against the device file.
5. Keep all device writes disabled until a legitimate Studio session capture validates the command protocol.
