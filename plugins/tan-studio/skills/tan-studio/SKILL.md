---
name: tan-studio
description: Inspect and manage the user's Tan Studio coffee data through its local API. Use when the user asks about green coffees, roasting profiles, roast history or telemetry, rested pantry coffee, brews, tasting notes, roast labels, or the connected Kaffeelogic Nano.
---

# Tan Studio

Use the Tan Studio MCP tools as the authoritative interface to the user's coffee records. Keep identifiers as short Tan Studio integers and let the backend persist all durable state.

## Start with context

1. Call `tan_status` when service or device availability matters.
2. Resolve an unknown coffee, profile, or roast with the relevant search tool.
3. Call `tan_get_context` before comparing outcomes or recommending a change.
4. Use `tan_get_roast` with telemetry only when curve data materially affects the answer.

Use `tan_list_pantry` for “what should I brew?” questions. Respect each roast's rest state, estimated remaining mass, and latest tasting feedback.

## Record user observations

Treat the user's stated measurements and sensory observations as facts. Keep suggestions or inferred causes visibly distinct from observations.

- Use `tan_record_brew` for a brewing session. Omit fields the user did not provide so the backend applies the user's defaults.
- Use `tan_add_note` for observations that should link to one or more profiles, coffees, roasts, or brews.
- Link a tasting note to the brew and roast when both are known.
- Preserve the user's wording in unstructured notes; do not manufacture flavor notes, scores, measurements, or inventory amounts.
- Report the persisted numeric ID after a successful write.

Read [references/tool-contract.md](references/tool-contract.md) before a write or telemetry request if field semantics or units are unclear.

## Handle labels and the device honestly

Use `tan_create_label` to create a roast-linked label record or artifact. Do not say a label physically printed unless the returned backend status proves it.

Use `tan_sync_device` only to import data from the Kaffeelogic. The current operation is read-only toward the roaster. There is no tool for raw serial access, arbitrary HTTP, SQL, profile upload, roast control, firmware changes, or device-file deletion.

## Recover cleanly

On an API error, report its stable code and correlation ID. Retry only when `retryable` is true. If configuration fails, follow [references/configuration.md](references/configuration.md); never ask the user to paste a token into conversation or store one in the repository.
