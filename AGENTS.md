# Tan Studio — Agent Guide

A calm, local-first Kaffelogic Nano 7 notebook: React/Vite frontend, one strongly typed Rust service (Tauri sidecar or Raspberry Pi appliance). See `README.md` for workspace layout and `bun run check` for the full gate.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) recorded as a `Status:` line per issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Visual design

For branding or UI work, read `docs/brand/brand-guide.md` and `docs/brand/README.md`. Reuse shared shadcn primitives whenever an equivalent exists. Keep record fields and relationships grounded in the runtime contract. The original plant is the adopted Tan logo: palette-only edits use `script/build_brand_assets.py`, not image regeneration. Reusable art contains black, red and transparent pixels; paper texture belongs to the layout, not the logo file.
