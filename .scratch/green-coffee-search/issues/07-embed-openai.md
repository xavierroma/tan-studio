# 07: OpenAI embeddings with content-hash vector cache

**What to build:** Tasting-note vectors for every lot, embedded once and never re-paid for: `text-embedding-3-small` calls batched and cached by the SHA-256 of the exact embedded string in sqlite. A missing `OPENAI_API_KEY` degrades to a tagged error that sync tolerates — scraping and metadata filtering keep working keyless.

Status: ready-for-agent
Blocked by: 06-sync-catalog

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/embed/`, its tests, and (if needed) a small additive edit to `bin/sync.ts` wiring `--skip-embed`. Search code (`db/`, `bin/search.ts`) is ticket 08's.

- `packages/green-coffee-sources/src/embed/EmbeddingService.ts` — service interface + Layer
- `packages/green-coffee-sources/src/embed/OpenAI.ts` — OpenAI implementation, batched requests
- `packages/green-coffee-sources/src/embed/cache.ts` — SHA-256-keyed vector cache over the catalog's sqlite (embeddings table, BLOB vectors)
- `packages/green-coffee-sources/test/embed/*.test.ts`

## Key requirements (from spec)

- **Embedding input** exactly per spec §Search design: `{title}. {producer}. {region}, {country}. {process}. {tasting_notes_raw}` — notes dominate; raw descriptor strings embedded directly (no SCA flavor-wheel normalization this round).
- **Config**: key read via `Effect.Config` + `Redacted`; never logged, never serialized.
- **Cache**: keyed by SHA-256 of the embedded string, stored as BLOB in an `embeddings` table of the existing sqlite DB — unchanged coffees cost zero API calls on re-sync (spec user story 12). Content-hash invalidation gets a dedicated test.
- **Missing key** = tagged `ConfigError`; `sync --skip-embed` completes the run without vectors, leaving backfill for the next keyed run (spec user story 19, §Risks).
- **Tests**: fake deterministic embedding service (hash-derived vector); OpenAI is NEVER called in tests — no network, no key needed (spec §Testing Decisions).

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green: same text → cache hit (fake service call count doesn't grow); changed tasting note → re-embed.
- [ ] A test asserts batched requests chunk inputs rather than one-request-per-lot (asserted against a counting fake).
- [ ] A test proves missing key yields tagged `ConfigError` and `--skip-embed` path completes without it.
- [ ] No test reads `OPENAI_API_KEY` from the real environment; `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0.

## Evidence

- Model & input composition: `docs/12-green-coffee-sourcing-research.md` §search/embedding discussion.
- Spec: `.scratch/green-coffee-search/spec.md` §Search design (embedding input + caching), §Testing Decisions (fake embedding), §Risks (missing key).
