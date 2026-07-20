# Tan Studio tool contract

## Read tools

| Tool                  | Use                                                                              |
| --------------------- | -------------------------------------------------------------------------------- |
| `tan_status`          | Service version, feature flags, database recovery state, and Kaffeelogic status. |
| `tan_list_pantry`     | Available roasted coffee, estimated mass, rest/peak window, and latest tasting.  |
| `tan_search_profiles` | Find profiles by text or related coffee/roast ID, bounded to 1–200 results.      |
| `tan_search_coffees`  | Find the flat coffee catalog by text or related profile/roast ID, up to 200.     |
| `tan_search_roasts`   | Find 1–200 lightweight roast summaries without telemetry.                        |
| `tan_get_context`     | Fetch a profile, coffee, roast, or brew with its available related records.      |
| `tan_get_roast`       | Fetch roast detail and, when requested, 50–2,000 downsampled telemetry points.   |

MCP resources mirror common reads at `tan://pantry`, `tan://device`, `tan://profiles/{id}`, `tan://coffees/{id}`, `tan://roasts/{id}`, and `tan://brews/{id}`.

## Write tools

| Tool               | Effect                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `tan_record_brew`  | Creates one brew linked to an existing roast. Omitted values use backend defaults.               |
| `tan_add_note`     | Creates one note and atomically links it to 1–10 resources. Source is recorded as `agent:codex`. |
| `tan_create_label` | Creates one roast-linked label request/artifact; it does not imply physical printing.            |
| `tan_sync_device`  | Imports Kaffeelogic profiles/logs into Tan Studio and does not write to the roaster.             |

There is deliberately no generic HTTP tool, SQL tool, raw serial tool, or device-write tool.

## Units and identifiers

Agent-facing write inputs use ordinary units:

- coffee and water mass: grams;
- water temperature: degrees Celsius;
- ratings: percent from 0 to 100;
- label dimensions: millimeters;
- resource identifiers: positive short integers.

The adapter converts them exactly at the API boundary:

- grams × 1,000 → milligrams;
- Celsius × 1,000 → milli-degrees Celsius;
- percent × 100 → basis points;
- millimeters × 1,000 → micrometers.

API responses retain their explicit integer storage units. Telemetry timestamps use elapsed milliseconds, and temperatures use milli-degrees Celsius unless the field name states otherwise.

## Failure behavior

Tan Studio returns RFC 9457 Problem Details. Tool failures include a stable `error` code, human-readable message, HTTP status, `retryable`, optional field errors, and an optional correlation ID. Do not retry validation, conflict, or not-found errors blindly.
