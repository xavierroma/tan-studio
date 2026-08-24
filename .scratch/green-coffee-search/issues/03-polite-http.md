# 03: Polite HTTP — rate-limited client, disk cache, fixture layer

**What to build:** The single swappable seam of the whole pipeline: an HttpClient service that enforces each store's politeness budget, backs off when throttled, and caches payloads to disk so a minutes-long Sweet Maria's crawl can resume after interruption. Tests swap it for a fixture layer serving recorded payloads, so everything above the seam runs identically with zero network.

Status: resolved
Blocked by: 01-scaffold-domain

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/http/` and its tests only. Adapters (tickets 04/05) consume this layer but define no HTTP code themselves.

- `packages/green-coffee-sources/src/http/RateLimitedHttpClient.ts` — Effect service + Layer wrapping `@effect/platform-node` HttpClient
- `packages/green-coffee-sources/src/http/budgets.ts` — per-store budget table
- `packages/green-coffee-sources/src/http/cache.ts` — disk cache under `coffee-farms/cache/<store>/`
- `packages/green-coffee-sources/src/http/errors.ts` — typed errors
- `packages/green-coffee-sources/src/http/FixtureHttpClient.ts` — test Layer reading recorded payloads
- `packages/green-coffee-sources/test/http/*.test.ts`

## Key requirements (from spec)

- **Per-store budgets** from the spec's contracts table: Sweet Maria's concurrency ≤3 with jitter; Showroom strictly sequential with ~1.75 s gaps (observed 500/504 under concurrency); all others moderate default = concurrency 3 + ~300 ms spacing. Budgets live in ONE place so they're adjustable in one place (spec §Risks politeness drift).
- **Backoff**: `Schedule.exponential` on 429/503 responses with a max-retry bound; retries surface as typed errors when exhausted.
- **Typed errors**: at minimum `RateLimitedError` and `HttpError`; no thrown strings.
- **Disk cache**: content-addressed by URL + request params under `coffee-farms/cache/<store>/`, checked before any network call — enables resume mid-run after interruption or backoff (spec user stories 13, 22; §Risks SM crawl time). Cache dir is gitignored per ticket 01; recorded fixtures used by tests are committed alongside tests instead.
- **User-Agent**: honest identifying UA string on every request (spec user story 15).
- **FixtureHttpClient**: a Layer implementing the same HttpClient interface, serving committed recorded payloads keyed by URL — the seam adapters and integration tests wire in. No test ever touches the network.

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green: unit tests prove budget enforcement (e.g., Showroom requests never overlap and respect gaps; SM never exceeds 3 concurrent) using fake clocks where possible.
- [ ] A test asserts exponential backoff triggers on 429/503 and exhausts into `RateLimitedError`.
- [ ] A test proves cache hit avoids a network request and enables resume across two "runs".
- [ ] FixtureHttpClient serves an adapter-shaped request end-to-end inside a vitest suite with zero sockets opened.
- [ ] `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0.

## Evidence

- Budgets & observed failures: `docs/12-green-coffee-sourcing-research.md` §Per-store scrape contracts table; `/Users/xavi/projects/tan-studio/coffee-farms/audits/woo-custom-new.md` (Showroom 500/504), `shopify-new.md` (SM 429 at ~10 concurrent).
- Recorded payload material for fixtures: `/Users/xavi/projects/tan-studio/coffee-farms/cache/` (per store), audit excerpts in `/Users/xavi/projects/tan-studio/coffee-farms/audits/`.
- Spec: `.scratch/green-coffee-search/spec.md` §Architecture overview (`http` row), §Testing Decisions ("The seam").
## Comments

Resolved in-session (2026-08-23): all acceptance criteria green — typecheck 0 errors, vitest 63/63 package-wide, prettier clean, boundaries pass.
