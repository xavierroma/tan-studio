# Tan Studio end-to-end verification

- **Verification date:** 2026-07-19
- **Host:** Apple Silicon Mac, macOS, local Rust service, Vite/React client
- **Data source:** Live Nano USB synchronization: 15 native roast logs and 16 roast profiles, cross-checked with Kaffeelogic Studio's synchronized device corpus

This report records what has been exercised against real user data. It is an evidence boundary, not a claim that every Kaffeelogic firmware or historical `.klog` variant has been observed.

## Result

Tan Studio imported all 15 available native logs transactionally with no warnings or quarantined files. SQLite contains 15 roast records, 15 sample-stream manifests, and 6,854 telemetry rows. `PRAGMA quick_check` returns `ok`. The migrated production database reports schema version 7 and projection version 4.

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
| 15 | 26 | 26 | 13 | 20,389 | Interrupted |

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

After live USB synchronization, native log 14 was also opened in both applications. Studio and Tan Studio agree on a 6:54 roast end, 219.8 °C end temperature, 661 numeric rows, 13 channels, roast level 1.4, and 120 g green load. SHA-256 reconciliation proved that Tan Studio retained the exact same bytes as Studio for the compared KLOG and KPRO corpus. A subsequent real roast produced log 15; Tan Studio imported its 26 samples, 20.389-second duration, level 2.5, 120 g load, real roast date, and interrupted result without a compatibility warning.

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

The following flows were exercised against the Rust API, generated TypeScript client, packaged Tauri application, and real local database:

- Roast history and pantry views use compact server-side summaries. View, query, and selection state live in the URL and survive reload.
- The packaged Tauri app opens native logs 13, 14, and 15, renders the ECharts telemetry view in macOS WebKit, and preserves short-number detail routes plus their graphs across reload. Roast detail loads telemetry separately from history rows, displays all native channels, keeps lines visible during chart hover, and provides an explicit History back action.
- The notebook defaults to an ungrouped, descending roast-number view. Unknown Nano clock dates sort without inventing timestamps and render as `Date unavailable`.
- Invalid roast references render a recoverable error view instead of crashing the application.
- The Coffee route uses the flat coffee resource rather than exposing provider, purchase, lot, or inventory tables. Search and selected coffee state are URL-backed.
- Roast preparation persists a single planned roast in the Rust service before the device starts. Its selected profile, coffee, level, load, free-text note, and arbitrary adjustments survive navigation. The selected profile is reflected in the URL.
- Roast import reconciles the resulting native log with the planned roast while preserving its coffee, exact profile snapshot, note, and adjustments.
- Brew defaults persist through `/api/v1/settings`, survive reload, and prefill V60, dose, water, grinder, kettle, water, and temperature without duplicating those resources into separate tables.
- An invalid brew roast reference produces a visible recoverable error and does not create a record.
- The universal Note resource can link one note to any combination of profiles, coffees, roasts, and brews. Create, patch, replace-links, and delete behavior is covered through the real HTTP contract.
- A generated label is a durable resource linked to its roast. The application renders deterministic physical-size SVG and QR content and distinguishes generated/submitted status from physically confirmed printing.
- Pantry queries derive remaining mass and rest/peak timing from roasts and brews, so an LLM can answer which coffee is available without reconstructing client state.
- The React client consumes the OpenAPI-generated client; it does not hand-maintain endpoint response types.
- The Profiles route loads the real typed API, exposes all 16 native files, keeps the selected profile in the URL, renders native temperature and fan curves with Studio-compatible cubic Bézier controls, and exposes only task-relevant guidance and relationships.
- Device status is live backend state: the packaged application displayed model `KN1007B`, firmware `7.20.6`, 16 profiles, 15 logs, and the explicit read-only capability boundary.

The HTTP integration test exercises the complete Profile → Coffee → Roast → Brew → multi-linked Note → Label → Pantry flow, optimistic concurrency, and the one-active-roast rule. It uses an isolated database; no fake catalog, brew, note, or label data was submitted to the user's production database. The packaged application database contains the 15 real roast logs and 16 real roast profiles.

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

The Nano enumerated as a macOS USB CDC modem and the packaged Tan Studio application completed passive discovery, SASSI negotiation, system-information lookup, directory inventory, file download, and transactional import. It reported model `KN1007B`, firmware `7.20.6`, SASSI v1, 16 profiles, and 15 roast logs. The earlier corpus was independently refreshed in Kaffeelogic Studio, and Tan Studio subsequently imported the newly created log 15. Tan Studio reacquired the USB connection after Studio quit without an application restart.

The final release candidate also exercised recovery from a half-open negotiation: the Refresh action closed the incomplete serial session, rediscovered the same CDC device, renegotiated SASSI, and returned the verified model, firmware, packet limit `4064`, 16-profile count, and 15-log count. Incomplete negotiations now time out and rescan instead of leaving the UI permanently stuck.

This read-only USB path is now E2E-passing. Device writes remain disabled until legitimate Studio traffic establishes the exact profile-write, command, acknowledgement, and recovery behavior. A supervised new roast, incremental live-log notification, cable interruption during a roast, and post-roast automatic synchronization remain the live-monitoring acceptance gates.
