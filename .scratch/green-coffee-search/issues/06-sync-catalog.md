# 06: Sync pipeline — sqlite catalog, manifest, resumable CLI

**What to build:** One command that drives all six adapters through the catalog into `coffee-farms/data/lots.db`: upsert keyed by (store, sku), resumable after interruption, with a run manifest log — so the operator's multi-minute crawl never restarts from zero. Ships as the `sync` CLI entry point.

Status: ready-for-agent
Blocked by: 04-shopify-adapter, 05-woo-adapter

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/pipeline/`, `src/catalog/`, `bin/sync.ts`, and their tests. Embedding (ticket 07) and search/query code (ticket 08) are out of scope here — leave a stub-free seam where sync simply completes without them for now.

- `packages/green-coffee-sources/src/catalog/Catalog.ts` — `bun:sqlite` wrapped as an Effect service (spec explicitly rejects `@effect/sql` drivers); lots + meta tables; WAL mode
- `packages/green-coffee-sources/src/pipeline/Sync.ts` — Effect.gen orchestration across all six `StoreConfig`s; checkpoint/resume state in meta tables; JSONL snapshot writer
- `packages/green-coffee-sources/src/pipeline/StoreConfigs.ts` — the six store configs assembled from tickets 04/05
- `packages/green-coffee-sources/bin/sync.ts` — CLI via `Effect.runPromise` + `node:util` `parseArgs`
- `packages/green-coffee-sources/test/sync/*.test.ts`

## Key requirements (from spec)

- **Upsert semantics** keyed `(store, sku)` — re-syncs update rather than duplicate; offers stay distinct per store even for the same farm (spec user story 23).
- **Outputs**: `coffee-farms/data/lots.db` (gitignored) + `lots.jsonl` snapshot alongside; both rebuildable anytime (spec §Data policy).
- **Manifest log**: each run records stores attempted, lots written, wholesale-flagged counts (JA), errors per store — one broken store never poisons the sync (spec §Risks).
- **Resumable**: interrupted runs continue from checkpoint; combined with ticket 03's disk cache, no payload is fetched twice within a cache lifetime.
- **Integration test WITHOUT network**: run all adapters against FixtureHttpClient layers seeded with committed fixtures, assert expected lot counts per store within ±10% (SM 516, Showroom 54, Bodhi Leaf 37, JA 127 retail, Prime Green 18, Smokin' Beans ~217; total ~969 ±10%).
- Live sync is documented but NEVER executed in CI or by agents by default (see ticket 09).

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green, including the fixture-driven full-pipeline integration test asserting per-store count bands above.
- [ ] Integration test proves resume: kill/re-run simulation produces same final lot set as single run.
- [ ] `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0; `bun run boundaries` passes.
- [ ] `bin/sync.ts --help` prints flags; `--skip-embed` accepted (no-op until ticket 07 lands) so the flag exists before embeddings do.

## Evidence

- Counts & budgets table: `docs/12-green-coffee-sourcing-research.md` §store tables.
- Spec: `.scratch/green-coffee-search/spec.md` §Architecture overview (`sync`, `catalog` rows), §Data policy, §Risks (SM crawl time, JA leakage, drift isolation).
- Fixture material: `/Users/xavi/projects/tan-studio/coffee-farms/cache/`, `/Users/xavi/projects/tan-studio/coffee-farms/audits/`.
