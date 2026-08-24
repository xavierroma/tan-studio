# 05: WooCommerce adapter family — Showroom, Prime Green, Smokin' Beans

**What to build:** Every WooCommerce-store lot flowing from `wc/store/v1` through Schema decode into normalized `Lot`s — including Showroom's structured attributes (the best schema of the six), Prime Green's spec tables mirrored into description HTML, and Smokin' Beans' "Cup Notes" prose. All three ride ticket 03's budgets; Showroom's sequential-with-gaps discipline is load-bearing.

Status: resolved
Blocked by: 02-normalizers, 03-polite-http

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/adapters/woo.ts`, the three WooCommerce store configs, and their tests. Shopify stores are ticket 04's; do not touch `src/adapters/shopify.ts`.

- `packages/green-coffee-sources/src/adapters/woo.ts` — shared adapter: `wc/store/v1` pagination (`?page=N&per_page=100`), Schema decode at the boundary, attribute/description mapping
- `packages/green-coffee-sources/src/adapters/configs/showroomcoffee.ts`
- `packages/green-coffee-sources/src/adapters/configs/primegreen.ts`
- `packages/green-coffee-sources/src/adapters/configs/smokinbeans.ts`
- `packages/green-coffee-sources/test/adapters/woo/*.test.ts`

## Key requirements (from spec)

- **Showroom Coffee config** (54 lots): attributes carry normalized Elevation, moisture, density, varietals + numeric score — map attributes directly; descriptions carry prose notes for tasting_notes_raw. Best-schema store; no HTML scraping needed.
- **Prime Green config** (18 lots): parse the description-HTML spec table — Country / Region / Farm Name / Process / "Growing Altitude X masl" / Varietal — consistent 18/18 per research.
- **Smokin' Beans config** (~217 lots, Woo category id 1172): labeled "Cup Notes" prose on 212/217 → tasting_notes_raw; altitude prose on 150/217 and varietal on 214 flow through ticket 02's parsers with evidence retained.
- Pagination streams page-by-page via the shared adapter; all decoded payloads hand off to ticket 02 normalizers; raw snippets preserved in `elevation_evidence` / `process_raw`.
- Malformed payloads fail decode loudly with a tagged error naming the store (spec user story 16).

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green: unit tests against committed fixtures sampled from recorded showroomcoffee / primegreen / smokinbeans payloads, covering edge cases (attribute-based elevation, spec-table HTML, Cup Notes prose with no altitude).
- [ ] A Prime Green fixture asserts `"Growing Altitude 1,900 masl"` parses to min=max=1900 with evidence retained.
- [ ] A Showroom fixture asserts numeric score + Elevation attribute land on the Lot without prose parsing.
- [ ] Zero network access during tests; `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0.

## Evidence

- Field locations & counts: `docs/12-green-coffee-sourcing-research.md` §store tables (Woo rows).
- Recorded payloads: `/Users/xavi/projects/tan-studio/coffee-farms/cache/` (showroomcoffee et al.), audit excerpts in `/Users/xavi/projects/tan-studio/coffee-farms/audits/woo-custom-new.md`, `woo-stores.md`; raw captures `coffee-farms/showroomcoffee.json|csv`.
- Spec: `.scratch/green-coffee-search/spec.md` §Per-store scrape contracts.

## Comments

Resolved (2026-08-23): adapters landed by parallel subagents; RawLot contract unified across shopify/woo in-session afterwards (tasting_notes_raw added; woo emits RawLot; nullable elevation). Gates green: typecheck 0 errors, 76/76 tests.
