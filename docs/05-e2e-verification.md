# Tan Studio end-to-end verification

- **Verification date:** 2026-07-19
- **Host:** Apple Silicon Mac, macOS, local Rust service, Vite/React client
- **Data source:** Live Nano USB synchronization: 14 native roast logs and 16 roast profiles, cross-checked with Kaffeelogic Studio's synchronized device corpus

This report records what has been exercised against real user data. It is an evidence boundary, not a claim that every Kaffeelogic firmware or historical `.klog` variant has been observed.

## Result

Tan Studio imported all 14 available native logs transactionally with no warnings or quarantined files. SQLite contains 14 roast records, 14 sample-stream manifests, and 6,828 telemetry rows. `PRAGMA quick_check` returns `ok`.

Tan Studio also imported all 16 profiles displayed by Kaffeelogic Studio's Nano sync-folder view with zero compatibility warnings. Each original `.kpro` byte stream is retained by SHA-256, and every profile produced both a sampled temperature curve and a sampled fan curve through the typed `/api/v1/profiles` contract.

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
| 14 | 661 | 661 | 13 | 414,444 | Completed |

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

After live USB synchronization, native log 14 was also opened in both applications. Studio and Tan Studio agree on a 6:54 roast end, 219.8 °C end temperature, 661 numeric rows, 13 channels, roast level 1.4, and 120 g green load. SHA-256 reconciliation proved that Tan Studio retained the exact same bytes as Studio for all 14 KLOG files and all 16 KPRO files.

Log 14 and nine earlier logs contain no `roast_date`; their Nano filesystem timestamp is the `2001-01-01 01:01:00 UTC` clock sentinel. Studio's macOS file panel displays this as 31 December 2000 at 17:01 in Pacific time. Tan Studio preserves the source timestamp for provenance but exposes the roast date as unknown, labels it `Date unavailable`, and orders the notebook by descending short roast number instead of presenting the sentinel as a real date.

### Profile corpus parity

Studio and Tan Studio agree on the 16 profile filenames, displayed names, designer metadata, schema versions, recommended levels, and ordered curve controls in the cached Nano sync corpus:

| File | Display name | Schema | Recommended level |
| --- | --- | ---: | ---: |
| `(KL) Natural light v1.1.kpro` | KL Natural | 1.4 | 1.1 |
| `(KL) Natural v1.1.kpro` | Natural Light | 1.4 | 1.1 |
| `(KL) Washed v1.1.kpro` | KL Washed | 1.4 | 0.8 |
| `0-1200m Rest v1.0.kpro` | 0-1200m Rest | 1.4 | 3.0 |
| `0-1200m RTD v1.0.kpro` | 0-1200m RTD | 1.6 | 3.0 |
| `1200-1500m Rest v1.0.kpro` | 1200-1500m Rest | 1.4 | 3.0 |
| `1200-1500m RTD v1.0.kpro` | 1200-1500m RTD | 1.4 | 3.0 |
| `1500-2000m Rest v1.0.kpro` | 1500-2000m Rest | 1.4 | 3.2 |
| `1500-2000m RTD v1.0.kpro` | 1500-2000m RTD | 1.6 | 3.1 |
| `2000-2700m Rest v1.0.kpro` | 2000-2700m Rest | 1.4 | 3.2 |
| `2000-2700m RTD v1.0.kpro` | 2000-2700m RTD | 1.6 | 3.2 |
| `[KL] Classic.kpro` | K-logic classic | 1.4 | 3.3 |
| `Cupping v1.0.kpro` | Cupping | 1.4 | 2.0 |
| `Decaf v1.0.kpro` | Decaf | 1.4 | 3.0 |
| `Robusta v1.0.kpro` | Robusta | 1.6 | 3.0 |
| `Super dark v1.0.kpro` | Super dark | 1.4 | 5.6 |

The curve renderer uses the same cubic Bézier grouping as Studio: each node is followed by its left and right absolute control coordinates, and a segment uses the current node, its right handle, the next node's left handle, and the next node. Two official profiles contain crossing handle x-coordinates, so imports require strictly increasing node times but do not incorrectly reject those valid handles. The source control coordinates remain unchanged; sampling exists only for display.

## UI and API workflow checks

The following flows were exercised against the Rust API and the real local database:

- Roast notebook search, grouping, sorting, date, provider, process, score, and status controls are URL-backed and survive reload.
- The packaged Tauri app opens native logs 13 and 14, renders the ECharts telemetry view in macOS WebKit, and preserves short-number detail routes plus their graphs across reload. Roast detail loads telemetry separately from notebook rows, displays all native channels, and provides an explicit Notebook back action.
- The notebook defaults to an ungrouped, descending roast-number view. Unknown Nano clock dates sort without inventing timestamps and render as `Date unavailable`.
- Invalid roast references render a recoverable error view instead of crashing the application.
- Catalog acquisition creates provider, coffee, purchase, lot, and inventory records transactionally; the new lot survives reload.
- Catalog search and selected-lot state are URL-backed.
- Brew defaults persist through the API and survive reload.
- An invalid brew roast reference produces a visible recoverable error and does not create a record.
- The React client consumes the OpenAPI-generated client; it does not hand-maintain endpoint response types.
- The Profiles route loads the real typed API, exposes all 16 native files, keeps the selected profile in the URL, renders temperature and fan curves, and displays native metadata instead of prototype data.

Temporary catalog and preference values created solely for E2E testing were removed or restored after verification. The packaged application database contains the 14 real roast logs and 16 real roast profiles.

The existing desktop database was also upgraded from the former TypeScript companion's migration ledger to the canonical Rust ledger after hash validation and an automatic backup. The executable launch check requires both the desktop shell and its Rust sidecar to remain alive, preventing a shell-only false positive.

## Parser safety boundary

Zero warnings for this corpus does not prove universal compatibility. Safety comes from the import behavior:

- Original bytes are retained by content hash before projection.
- Profile projections additionally require a source file whose native kind is `kpro`, valid bounded JSON, and a transactional profile revision; SQLite triggers reject a mismatched or malformed projection.
- Known metadata and every numeric channel are parsed; unknown metadata remains in the native projection.
- Numeric, timestamp, channel-count, row-count, and SQLite `STRICT`/trigger constraints are checked before commit.
- A file import is atomic. A malformed or incompatible file is quarantined with diagnostics rather than partially inserted.
- Re-import is idempotent by content hash and native identity.
- Parser and schema versions remain attached to provenance so projections can be rebuilt after parser improvements.

The automated test suite includes fragmented SASSI frame parsing, CRC mutation rejection, RFC 3339 fallback dates, all-channel native-log parsing, transactional re-import, migration application, API field allowlisting, and generated-schema compatibility.

## Hardware status and remaining gate

The Nano enumerated as a macOS USB CDC modem and the packaged Tan Studio application completed passive discovery, SASSI negotiation, system-information lookup, directory inventory, file download, and transactional import. It reported model `KN1007B`, firmware `7.20.6`, SASSI v1, 16 profiles, and 14 roast logs. The same inventory was independently refreshed in Kaffelogic Studio. Tan Studio reacquired the USB connection after Studio quit without an application restart.

This read-only USB path is now E2E-passing. Device writes remain disabled until legitimate Studio traffic establishes the exact profile-write, command, acknowledgement, and recovery behavior. A supervised new roast, incremental live-log notification, cable interruption during a roast, and post-roast automatic synchronization remain the live-monitoring acceptance gates.
