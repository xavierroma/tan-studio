# 09: Close-out — docs usage section, full gates, first-sync runbook

**What to build:** The round ends with the repo telling the truth: docs/12 gains a usage section with real sync + search CLI examples, every gate is green for the new package, and the user holds an exact command list for their first live sync — which nobody has run on their behalf.

Status: ready-for-agent
Blocked by: 08-search-core

## Scope — files this ticket creates (exact paths)

Parallel-safe boundary: this ticket edits ONLY `docs/12-green-coffee-sourcing-research.md` (append a Usage section) and reports results. Any gate failure routes back to the owning ticket (01–08) rather than being patched here.

- `docs/12-green-coffee-sourcing-research.md` — appended "Usage" section: `sync` and `search` CLI examples, flag reference, cache/data locations, resume behavior
- Final report → appended to this ticket file under `## Comments` when done

## Key requirements (from spec)

- **Full gates green**: package typecheck + test, repo-scoped format check, boundaries script — all runnable commands listed below. Zero network access during tests must hold.
- **Data policy verified**: `.gitignore` covers `coffee-farms/cache/` and `coffee-farms/data/lots.db` (+ snapshots); code, tests, fixtures committed; caches rebuildable via sync (spec §Data policy, user story 22).
- **Acceptance sweep** against spec §Acceptance criteria 1–5 as far as verifiable without a live crawl: fixture-based counts (~969 ±10%), elevation coverage ≥90% among lots whose source publishes it, golden queries plausible, gates green, JA wholesale excluded+flagged, budgets enforced in the live client's code path.
- **No live crawl. No commit** unless the user explicitly asks afterward.

## Acceptance criteria

- [ ] `bun run --filter @tan-studio/green-coffee-sources typecheck` exits 0
- [ ] `bun run --filter @tan-studio/green-coffee-sources test` exits 0 with zero network
- [ ] `bun run format:check` scoped to the new package paths passes (`prettier --check packages/green-coffee-sources`)
- [ ] `bun run boundaries` passes
- [ ] `git check-ignore coffee-farms/cache/x coffee-farms/data/lots.db` confirms both ignored
- [ ] docs/12 usage section shows working CLI invocations matching the implemented flags
- [ ] Final report (appended below) lists exact commands for the user's first real sync, including expected duration caveat for Sweet Maria's PDP pass and the `OPENAI_API_KEY` prerequisite note

## Evidence

- Spec acceptance list: `.scratch/green-coffee-search/spec.md` §Acceptance criteria, §Out of Scope (nothing UI-shaped slipped in), §Risks.
- Research doc to append to: `/Users/xavi/projects/tan-studio/docs/12-green-coffee-sourcing-research.md`.
- Gitignore/data-policy targets: `/Users/xavi/projects/tan-studio/coffee-farms/cache/`, `coffee-farms/data/`.
