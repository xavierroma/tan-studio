# 08: Search core — filtered cosine kNN + ranking + search CLI

**What to build:** The user's actual payoff: type "chocolatey brazil espresso" and get ranked, buyable lots across all six stores. Hard filters cut first (process, altitude, country, price/lb, stock), then load-vectors-once cosine kNN over survivors, ranked by similarity × cup score × freshness — printed by a `search` CLI.

Status: ready-for-agent
Blocked by: 07-embed-openai

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/db/`, `src/search/`, `bin/search.ts`, and their tests. Sync/embed code is tickets 06/07's; this ticket only reads the catalog those write.

- `packages/green-coffee-sources/src/db/query.ts` — loads vectors once per invocation from the sqlite embeddings table, in-process cosine kNN (fine at ≤2.5k vectors)
- `packages/green-coffee-sources/src/search/rank.ts` — hard-filter pre-application + `cosine × score boost × freshness decay`
- `packages/green-coffee-sources/src/search/query.ts` — query API consumed by the CLI
- `packages/green-coffee-sources/bin/search.ts` — CLI via `Effect.runPromise` + `node:util` `parseArgs`
- `packages/green-coffee-sources/test/search/*.test.ts`

## Key requirements (from spec)

- **Hard filters** applied before kNN: process enum, altitude min/max, country, max price/lb, in_stock, store (spec §Search design; user stories 2–6).
- **Ranking**: cosine similarity × cup-score boost × freshness decay on `updated_at` (user story 8).
- **CLI flags**: `--process --min-alt --max-alt --country --max-price` plus `-k` result count. Output per hit: title, store, url, altitude range, evidence snippet (`elevation_evidence`) so results stay auditable (user stories 9, 11).
- **Keyless fallback**: with no vectors present (keyless sync run), metadata filters still return unranked/filtered results rather than crashing (spec §Risks missing key).
- **Golden-query integration tests** over a fixture-seeded catalog using the fake embedding service from ticket 07: e.g., "chocolatey brazil espresso" must rank Brazil natural/pulped lots above Ethiopian washed florals; "bright floral ethiopian natural" and "high altitude gesha honey" assert plausible-origin/process top hits (spec golden smoke queries).

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green including all three golden-query tests asserting ordering invariants, zero network.
- [ ] A test asserts hard filters exclude out-of-stock and over-budget lots even when their vectors match strongly.
- [ ] `bin/search.ts --help` documents all flags; a manual smoke against a fixture-seeded DB prints ranked lots with store/url/altitude/evidence.
- [ ] `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0; `bun run boundaries` passes.

## Evidence

- Query flow, flags, golden queries: `.scratch/green-coffee-search/spec.md` §Search design, §Testing Decisions (golden queries).
- Ranking inputs (score availability per store): `docs/12-green-coffee-sourcing-research.md` §store tables.
