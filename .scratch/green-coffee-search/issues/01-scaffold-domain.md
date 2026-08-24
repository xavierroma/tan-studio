# 01: Scaffold `@tan-studio/green-coffee-sources` package + Lot domain model

**What to build:** A registered, typechecking workspace package that later tickets build inside, plus the typed `Lot` domain model every adapter/normalizer/search module shares. Nothing here touches network, scraping, or search — it is the tracer bullet's rails.

Status: resolved
Blocked by: None (can start immediately)

## Scope — files this ticket creates (exact paths)

Other tickets must not create or edit these; this ticket must not touch anything else.

- `packages/green-coffee-sources/package.json` — name `@tan-studio/green-coffee-sources`, `private: true`, `type: module`, exports entry (`"."` → `./src/index.ts`), scripts `test` / `typecheck` matching sibling packages (see `packages/domain/package.json`).
- `packages/green-coffee-sources/tsconfig.json` — mirrors sibling package tsconfigs.
- `packages/green-coffee-sources/src/index.ts` — barrel exporting the domain model.
- `packages/green-coffee-sources/src/domain/Lot.ts` — `effect/Schema` model: `store, sku, url, title, producer/farm/station, country, region, variety[], process_enum, process_raw, altitude_min_m, altitude_max_m, elevation_evidence, score?, price, price_per_lb, size_lb, in_stock, tasting_notes_raw, updated_at` exactly as spec §Normalization rules.
- `packages/green-coffee-sources/src/domain/Process.ts` — `ProcessEnum`: `washed | natural | honey | pulped-natural | wet-hulled | anaerobic-* | decaf-swp | decaf-ea | other`.
- `.gitignore` — add `coffee-farms/cache/` and `coffee-farms/data/` (append only; do not reorder existing lines).

Dependency registration (bun workspaces already glob `packages/*`, so creating the directory is the registration): turbo picks up tasks via existing config patterns — match how sibling packages declare `test`/`typecheck` scripts so `turbo` tasks apply unchanged.

## Key requirements (from spec)

- All deps added **once, in this ticket**, so later tickets never edit `package.json`: `effect@^3`, `@effect/platform`, `@effect/platform-node` (runtime); `@effect/vitest` + `vitest` + `typescript` (devDeps). Match sibling versions where they exist: `typescript ^5.9.3`, `vitest ^4.0.18` (see `apps/web/package.json`). Effect packages have no in-repo precedent — pin latest Effect 3.x line.
- Catalog persistence is `bun:sqlite` (spec explicitly rejects `@effect/sql` drivers) — no DB deps needed yet.
- `Lot` schema must decode untrusted payloads at the boundary later, so encode it with Schema classes/structs, not bare TS interfaces.

## Acceptance criteria

- [ ] `bun install` links the new workspace package without errors.
- [ ] `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0.
- [ ] `bun run --filter @tan-studio/green-coffee-sources test` runs (empty suite ok) and exits 0.
- [ ] `bun run boundaries` passes.
- [ ] `git check-ignore -q coffee-farms/cache/x && echo ignored` confirms gitignore covers cache/data paths.
- [ ] `Lot` schema round-trips a representative lot through `Schema.decodeUnknownSync` / encode.

## Evidence

- Spec: `.scratch/green-coffee-search/spec.md` §Architecture overview (module map), §Normalization rules.
- Sibling conventions: `packages/domain/package.json`, `apps/web/package.json` (version pins), root `package.json` (workspaces globs, `boundaries` script).

## Comments

Resolved by subagent (2026-08-23): scaffold + Lot/Process domain schemas; gates green.
