# Tan Studio — Agent Guide

A calm, local-first Kaffelogic Nano 7 notebook: React/Vite frontend, one strongly typed Rust service (Tauri sidecar or Raspberry Pi appliance). See `README.md` for workspace layout and `bun run check` for the full gate.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) recorded as a `Status:` line per issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
