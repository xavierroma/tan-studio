# Spec: Green coffee search — pipeline + search core

Status: ready-for-agent

Source research: `docs/12-green-coffee-sourcing-research.md`. Evidence audits: `coffee-farms/audits/`.
Execution shape: ticketed as `issues/01`–`09` in this directory (written as the next step).

## Problem Statement

A home-roaster consumer in California buys green coffee directly from US retailers, but every retailer is a separate site with its own vocabulary, layout, and half-buried product facts. One store publishes elevation as a structured attribute; another hides it inside marketing prose ("1350 all the way up to 1750 meters above sea level"); a third omits it entirely while burying the cupping score in a chart widget. There is no way to ask "which coffees across all stores match my taste?" — filtering by process, altitude, country, or price-per-pound means opening six tabs and reading pages by eye.

## Solution

One curated, normalized catalog built by politely scraping six tier-1 green-coffee retailers (~969 lots), plus a local search core over it. Every lot becomes a single typed record (origin, process, elevation range with raw evidence, price/lb, stock, tasting notes). Filtering works uniformly across stores, and free-text queries like "bright floral ethiopian natural" match against embedded tasting-notes vectors ranked by similarity, cup score, and listing freshness. This round delivers the pipeline and a search CLI only — no UI.

## User Stories

1. As a home roaster in California, I want one searchable catalog spanning all six retailers, so that I stop juggling browser tabs to comparison-shop green coffee.
2. As a home roaster, I want to filter by process method (washed, natural, honey, …), so that I can roast to a specific flavor profile.
3. As a home roaster, I want to filter by farm elevation range, so that I can target high-grown density-favoring lots.
4. As a home roaster, I want to filter by country and region, so that I can explore a single origin across every store that sells it.
5. As a budget-conscious buyer, I want to filter by maximum price per pound, so that I only see lots I'm willing to pay for.
6. As a buyer, I want out-of-stock lots excluded (or visible) at my choice, so that I never fall in love with an unavailable coffee.
7. As a taste-driven buyer, I want to type "chocolatey brazil espresso" and get ranked matches across stores, so that flavor — not store taxonomy — drives discovery.
8. As a taste-driven buyer, I want higher-cupping-score and fresher listings to rank higher for equal taste fit, so that the best coffee surfaces first.
9. As a skeptical buyer, I want the raw elevation/process evidence snippet kept alongside parsed values, so that I can trust (or correct) the machine-readable numbers.
10. As a retail-only buyer, I want JA Coffee's login-gated wholesale variants excluded from my catalog, so that I never see prices I can't actually purchase.
11. As a buyer shopping from California, I want only consumer-checkout, ships-to-CA stores in the catalog, so that every result is actually buyable by me.
12. As a cost-conscious operator, I want embedding vectors cached by content hash, so that unchanged coffees never cost me another API call on re-sync.
13. As an operator, I want a sync run to resume after interruption or rate-limit backoff, so that a flaky network doesn't restart a multi-minute crawl.
14. As a polite scraper, I want per-store rate budgets enforced (Sweet Maria's ≤3 concurrent, Showroom strictly sequential, others moderate), so that I never get stores throttled or blocked.
15. As a polite scraper, I want an honest identifying User-Agent sent with every request, so that stores can recognize and allowlist my traffic.
16. As a developer-maintainer, I want every store payload Schema-decoded at the boundary, so that silent upstream schema drift fails loudly instead of corrupting the catalog.
17. As a developer-maintainer, I want tests to run with zero network access against recorded fixtures, so that CI is fast, deterministic, and free.
18. As a developer-maintainer, I want normalizers as pure functions TDD'd against real evidence strings, so that weird prose formats become regression tests forever.
19. As a developer-maintainer, I want a missing `OPENAI_API_KEY` to defer only the embedding step gracefully, so that scraping, normalization, and metadata filtering still work keyless.
20. As a developer-maintainer, I want the HTTP transport behind a swappable Layer, so that adapters are exercised identically live (real client) and in tests (fixture client).
21. As a future-me, I want tier-2 stores added later as new adapters without redesigning the core, so that phase 2 is additive.
22. As a data hoarder, I want the rebuilt-anytime sqlite catalog and caches gitignored while code, tests, and recorded fixtures stay committed, so that the repo stays small and reproducible.
23. As a curious buyer, I want per-store offers kept distinct even when two stores sell the same farm, so that I compare actual purchasable offers rather than merged ghosts.

## Implementation Decisions

### Architecture overview (module map)

New TypeScript package `@tan-studio/green-coffee-sources`, registered in the bun/turbo workspace. Modules, dependency direction top-down:

| Module | Responsibility |
|---|---|
| `cli` | Entry points (`sync`, `search`) wired via `Effect.runPromise`; flags parsed with node:util `parseArgs` |
| `sync` | Orchestrator: drive each adapter, persist through catalog, checkpoint/resume |
| `search` | Hard-filter pre-application, kNN, ranking; exposes query API used by the CLI |
| `embeddings` | OpenAI `text-embedding-3-small` client; content-hash vector cache |
| `catalog` | `bun:sqlite` wrapped as an Effect service (explicitly **not** `@effect/sql` drivers — bun support uncertain) |
| `adapters/*` | One adapter per store platform: fetch + decode + hand off to normalizer (Shopify family; WooCommerce family) |
| `http` | Rate-limiting HttpClient service: `@effect/platform-node` HttpClient wrapped with per-store budgets, `Schedule` backoff on 429/503; the swappable seam (fixture client in tests) |
| `normalizers` | Pure functions: decoded store payloads → unified Lot |
| `domain` | Lot schema, process enum, elevation types, evidence types |

Effect TS 3.x idioms are mandatory throughout: `effect/Schema` decode of every untrusted store payload at the boundary; services defined as Layers; configuration via `Effect.Config` with `Redacted` for the OpenAI key.

### Per-store scrape contracts

Phase-1 stores, expected lot counts, field locations, and rate budgets (all verified in the research doc and audits):

| Store | Platform / endpoint | Lots | Fields & where they live | Rate budget |
|---|---|---|---|---|
| Sweet Maria's (sweetmarias.com) | Shopify collection JSON `/collections/green-coffee/products.json?limit=250&page=N` **plus per-PDP enrichment pass** | 516 | Collection JSON: identity, price, tags. PDP HTML: farm-notes prose contains "**meters above sea level**" phrasing — the word *altitude* never appears; cupping score lives in `data-chart-score`; process/cultivar in the spec table | Concurrency ≤3 with jitter — observed 429 at ~10 concurrent |
| Showroom Coffee (showroomcoffee.com) | WooCommerce Store API `/wp-json/wc/store/v1/products?category=16&per_page=100` | 54 | Attributes carry normalized Elevation, moisture, density, varietals + numeric score; descriptions carry prose notes. Best schema of the set | Sequential only, ~1.5–2 s gaps — server returned 500/504 under concurrency |
| Bodhi Leaf (bodhileafcoffee.com) | Shopify `/collections/green-coffee/products.json` | 37 | `body_html` has parseable `altitude:` key-value lines; tags encode process/flavor | Moderate; no PDP pass needed |
| JA Coffee (jacoffee.com) | Shopify `products.json` (no collection filter) | 127 retail (of 129 catalog) | masl ranges on ~83 lots, named processes on ~116, farm names in prose; country/varietal/process tags. Retail tier purchasable at 1 kg without login. **Exclude** wholesale "Login for price" variants from lots — their prices leak in JSON, so flag rather than silently drop | Moderate |
| Prime Green Coffee (primegreencoffee.org) | WooCommerce Store API | 18 | Description HTML contains structured spec tables — Country / Region / Farm Name / Process / "Growing Altitude X masl" / Varietal — consistent 18/18 | Moderate |
| Smokin' Beans (smokinbeans.com) | WooCommerce category id 1172 | ~217 | Labeled "Cup Notes" prose on 212/217; altitude prose on 150/217; varietal on 214 | Moderate |

Expected total: ~969 lots.

### Normalization rules

Unified Lot record — one row per purchasable store SKU (type shape distilled from research §4):

```
store, sku, url, title,
producer/farm/station, country, region, variety[],
process_enum, process_raw,
altitude_min_m, altitude_max_m, elevation_evidence,
score?, price, price_per_lb, size_lb, in_stock,
tasting_notes_raw, updated_at
```

- **Process enum**: `washed | natural | honey | pulped-natural | wet-hulled | anaerobic-* | decaf-swp | decaf-ea | other`. Map from structured tags/spec-table fields first, prose fallback second; always retain `process_raw`.
- **Elevation parser** handles all observed formats: "1350 all the way up to 1750 meters above sea level", "Elevation 2250", "1500-2200 masl", "exceeding 2,200 MASL", en-dashed "1,780–1,820", comma-grouped digits, and feet→meters conversion when feet units appear. Single values fill min = max. Always keep the raw snippet as `elevation_evidence` for auditability.
- Producer/station names differ across stores for the same physical farm: match loosely (normalized token sets), never assume equality; offers stay distinct rows.
- Wholesale/login-gated variants (JA Coffee) are excluded from lots but flagged in sync output.

Normalizers are pure functions, developed test-first against real evidence strings captured in `coffee-farms/audits/`.

### Search design

- **Embedding input**: `{title}. {producer}. {region}, {country}. {process}. {tasting_notes_raw}` — notes dominate the vector; model is OpenAI `text-embedding-3-small`. Raw descriptor strings embedded directly (vocab drift between stores is handled by the model); SCA flavor-wheel normalization deferred until recall proves insufficient.
- **Caching**: vector cached by content hash of the embedding input; unchanged coffees never re-embed.
- **Index**: vector stored as a BLOB column in the sqlite catalog; kNN = load-all + in-process cosine (fine at ≤2.5k vectors).
- **Query flow**: hard filters applied first (process enum, altitude range, country, max price/lb, stock), then cosine kNN over survivors.
- **Ranking**: cosine similarity × cup-score boost × freshness decay.
- **CLI flags**: `--process --min-alt --max-alt --country --max-price`.
- **Golden smoke queries**: "bright floral ethiopian natural", "chocolatey brazil espresso", "high altitude gesha honey".

### Data policy

- Committed to git: code, tests, recorded fixtures. Gitignored: crawl cache (`coffee-farms/cache/`), the sqlite database (`coffee-farms/data/lots.db`), snapshots — all rebuildable via `bun run --filter @tan-studio/green-coffee-sources sync`.
- No live network in tests, ever.
- Politeness budgets encoded per store as in the contracts table; identify with a real User-Agent string; backoff on 429/503 and resume mid-run required.
- Catalogs change weekly, not per-request — cache aggressively.

## Testing Decisions

- **What makes a good test here**: external behavior only. Feed a decoded real payload to a normalizer, assert the Lot; feed evidence strings to the elevation parser, assert meters; seed a catalog, run a search query, assert which lots come back and in what order. No poking internal helpers.
- **The seam** (deliberately singular): the HTTP transport Layer. Adapters receive an HttpClient service; production wires the rate-limiting live client, tests wire a fixture client serving recorded payloads. Everything above the seam — decode, normalize, persist, search — runs identically in both worlds. Normalizers being pure functions means their seam is just function application.
- **Fixtures**: recorded from payloads already captured during the research phase (cache directory), trimmed to representative responses per store including edge cases (JA wholesale variants, SM PDP prose, Prime Green spec tables). Committed alongside tests.
- **Embeddings**: tested against a fake deterministic embedding service; OpenAI is never called in tests. Content-hash invalidation gets a dedicated test (same text → cache hit; changed notes → re-embed).
- **Golden queries**: run as integration-style tests over a fixture-seeded catalog asserting plausible-result invariants (top hits match query origin/process/taste descriptors).
- **Prior art**: existing workspace packages run under `bun run --filter '@tan-studio/*' test` and `typecheck`; the new package plugs into the same turbo tasks and the repo-wide `bun run check` gate.

## Out of Scope

- **Any UI** — web or desktop. This round ships pipeline + search-core CLI only.
- **Tier-2 stores** (Invalsa, Dean's Beans, Burman, Fresh Roasted, Happy Mug, Coffee Bean Corral, Captain's, Mill City, Café Kreyol, Java Bean Plus, Roastmasters, …) — phase 2 additions.
- **Canada-domestic sourcing**; the consumer is located in California and every included store must ship there.
- **Data-enrichment-only sources** (Cafe Imports beanology JSON, Royal Coffee archive, Genuine Origin, Ally).
- **Cross-store farm-entity merging/linking** — offers stay separate; only loose token-set matching exists internally.
- **SCA flavor-wheel facet normalization** of tasting notes.
- **Scheduled/automated sync**; freshness cadence per store remains an open question from the research doc.

## Further Notes

### Risks

- **Store schema drift**: Shopify/Woo payloads change without notice. Mitigation: strict Schema decode at boundaries makes drift fail loudly per-store; adapters isolated so one broken store never poisons the sync.
- **Sweet Maria's crawl time**: 516 PDP fetches at concurrency ≤3 with jitter is a slow, minutes-long pass — resume/checkpoint support is mandatory, not optional polish.
- **Showroom fragility**: sequential-with-gaps discipline must be honored; any concurrency "optimization" regresses to 500/504s.
- **Missing `OPENAI_API_KEY`**: the embed step defers gracefully — sync completes, search falls back to metadata filters, and vectors backfill on the next keyed run.
- **Politeness drift**: robots/rate limits observed August 2026 may tighten; budgets live in one service so they're adjustable in one place.
- **JA price leakage**: wholesale prices present in JSON must be flagged in sync output, never surfaced as purchasable lots.

### Acceptance criteria

1. A full `sync` produces **~969 ±10% lots** across all six stores.
2. **≥90 % elevation coverage** among lots whose source publishes elevation data (with `elevation_evidence` retained).
3. All three golden smoke queries return plausible results over the synced catalog.
4. Repo gates green for the new package: typecheck, lint/format, and tests pass under `bun run check` — with zero network access during tests.
5. Wholesale-gated JA variants excluded and flagged; per-store rate budgets demonstrably enforced in the live client.
