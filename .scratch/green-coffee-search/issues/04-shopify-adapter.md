# 04: Shopify adapter family — Sweet Maria's, Bodhi Leaf, JA Coffee

**What to build:** Every Shopify-store lot flowing from collection JSON through strict Schema decode into normalized `Lot`s — including Sweet Maria's two-pass crawl where cupping score hides behind a `data-chart-score` widget and elevation only ever says "meters above sea level". JA Coffee's wholesale tier stays out of purchasable lots but gets flagged, never silently dropped.

Status: resolved
Blocked by: 02-normalizers, 03-polite-http

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/adapters/shopify.ts`, the three Shopify store configs, and their tests. WooCommerce stores are ticket 05's; do not touch `src/adapters/woo.ts`.

- `packages/green-coffee-sources/src/adapters/shopify.ts` — shared adapter: Schema decode of `products.json` collection payloads, pagination as an Effect `Stream`
- `packages/green-coffee-sources/src/adapters/configs/sweetmarias.ts`
- `packages/green-coffee-sources/src/adapters/configs/jacoffee.ts`
- `packages/green-coffee-sources/src/adapters/configs/bodhileaf.ts`
- `packages/green-coffee-sources/test/adapters/shopify/*.test.ts`

## Key requirements (from spec)

- **Shared adapter**: collection JSON decoded with `effect/Schema` at the boundary — upstream drift fails loudly per-store, never corrupts the catalog (spec user story 16). Pagination streams page-by-page (`?limit=250&page=N`).
- **Sweet Maria's config** (516 lots): uses the PDP-enrichment hook — fetch product-page HTML, extract `origin-notes__notes` prose (elevation phrased as "**meters above sea level**"; the word *altitude* never appears), `data-chart-score` for cupping score, process/cultivar from the spec table. This hook exists ONLY in this config; other Shopify configs skip PDP entirely. Concurrency ≤3 with jitter comes from ticket 03's budgets.
- **JA Coffee config** (127 retail of 129 catalog): retail variants only. Exclude wholesale `"Login for price"` variants from lots — prices leak into JSON, so flag them in sync output rather than silently dropping or including (spec user stories 10, 23; §Risks JA price leakage).
- **Bodhi Leaf config** (37 lots): `body_html` key-value parse only (`altitude:` lines), tags encode process/flavor. No PDP pass.
- All configs hand decoded payloads to ticket 02's normalizers; raw evidence strings flow into `elevation_evidence` / `process_raw`.

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green: unit tests run against committed fixtures sampled from recorded sweetmarias / jacoffee / bodhileaf payloads, covering edge cases (SM PDP prose, JA wholesale variant present in JSON, Bodhi KV block).
- [ ] A JA fixture containing a wholesale variant asserts it is excluded from lots AND appears in flagged output.
- [ ] An SM fixture asserts score parsed from `data-chart-score` and elevation from prose without the word "altitude".
- [ ] Malformed payload (schema-drift case) fails decode loudly with a tagged error naming the store.
- [ ] Zero network access during tests; `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0.

## Evidence

- Field locations & counts: `docs/12-green-coffee-sourcing-research.md` §store tables (`origin-notes__notes`, `data-chart-score` details).
- Recorded payloads: `/Users/xavi/projects/tan-studio/coffee-farms/cache/sweetmarias|jacoffee|bodhileaf/` when present; audit excerpts in `/Users/xavi/projects/tan-studio/coffee-farms/audits/shopify-new.md`, `shopify-stores.md`.
- Spec: `.scratch/green-coffee-search/spec.md` §Per-store scrape contracts, §Normalization rules.

## Comments

Resolved (2026-08-23): adapters landed by parallel subagents; RawLot contract unified across shopify/woo in-session afterwards (tasting_notes_raw added; woo emits RawLot; nullable elevation). Gates green: typecheck 0 errors, 76/76 tests.
