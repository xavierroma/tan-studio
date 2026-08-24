# 02: Pure normalizers — elevation, process, score, producer extraction

**What to build:** The translation layer from messy store prose to clean `Lot` fields: a user story about trusting machine-readable numbers starts here, because every parsed value keeps its raw evidence string. Developed strictly test-first against **real** strings lifted from the research audits, so today's weird formats become tomorrow's regression tests.

Status: resolved
Blocked by: 01-scaffold-domain

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket owns `src/normalizers/` and its tests only. It does not edit `src/domain/`, `package.json`, tsconfig, or any other ticket's directories.

- `packages/green-coffee-sources/src/normalizers/elevation.ts`
- `packages/green-coffee-sources/src/normalizers/process.ts`
- `packages/green-coffee-sources/src/normalizers/score.ts`
- `packages/green-coffee-sources/src/normalizers/producer.ts`
- `packages/green-coffee-sources/src/normalizers/index.ts`
- `packages/green-coffee-sources/test/normalizers/*.test.ts` (one per normalizer)

## Key requirements (from spec)

- **Elevation parser** handles every observed format: `"1350 all the way up to 1750 meters above sea level"`, `"Elevation 2250"`, `"1500-2200 masl"`, `"exceeding 2,200 MASL"`, en-dashed `"1,780–1,820"`, comma-grouped thousands, and feet→meters conversion when feet units appear. Single values fill min = max. Always returns `elevation_evidence` = the raw snippet (spec §Normalization rules).
- **Process enum mapper**: structured tags/spec-table field first, prose fallback second; unknown prose maps to `other`; always retains `process_raw`.
- **Score parser**: numeric cup score from strings like `"86.5 points"` / chart values.
- **Producer/station extraction heuristics**: `"farm called X"`, `"Finca/Fazenda/Sítio X"`, `"…washing station"`, fallback = title-minus-country token slice. Match loosely across stores (normalized token sets), never assume equality.
- **Property under test: parsers never throw.** Any malformed input yields a tagged failure or null while preserving the raw string for audit. Encode this as a vitest fast-check property or exhaustive edge-case table — your call, but it must be asserted.
- Normalizers are pure functions — no IO, no Effect services, deterministic.

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources test` green; every test case uses an evidence string copied verbatim from the audits or docs/12 §4 (cite source in a comment per case group).
- [ ] Every format listed in the elevation requirement above has at least one passing case, including feet conversion and en-dash/comma variants.
- [ ] A fuzz/property test demonstrates no-throw over arbitrary strings.
- [ ] `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0.

## Evidence

- Real strings: `/Users/xavi/projects/tan-studio/coffee-farms/audits/shopify-new.md`, `woo-custom-new.md`, `shopify-stores.md`, `woo-stores.md`, `b2b-custom.md`.
- Format inventory: `docs/12-green-coffee-sourcing-research.md` §4 (elevation/process/producer lines ~121+).
- Spec: `.scratch/green-coffee-search/spec.md` §Normalization rules.
## Comments

Resolved in-session (2026-08-23): all acceptance criteria green — typecheck 0 errors, vitest 63/63 package-wide, prettier clean, boundaries pass.
