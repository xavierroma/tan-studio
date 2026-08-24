# H1: Hosted mode + Google operator session, on current main

**What to build:** The service can launch in hosted mode on `studio.tan.coffee`, behind Google sign-in restricted to one operator email, and the SPA it serves can actually call its own API.

**Blocked by:** nothing

**Status:** completed

- [ ] `TAN_STUDIO_HOSTED=1` selects a `hosted()` config in `apps/service/src/config.rs`.
- [ ] Google OIDC login: `/auth/google` -> Google, `/auth/google/callback` -> signed session cookie. Only `TAN_STUDIO_OPERATOR_EMAIL` may sign in; every other Google account is rejected.
- [ ] Unauthenticated `/api/v1/**` returns 401; `/healthz` stays public.
- [ ] **The same-origin SPA works.** Browsers omit `Origin` on same-origin GETs, so hosted mode MUST set `allow_originless_requests: true`, exactly as `headless()` already does. Getting this wrong is the live bug this ticket exists to fix.
- [ ] A cross-origin request with a foreign `Origin` is still rejected.
- [ ] The web app shows a sign-in state and does not wedge when unauthenticated.
- [ ] Tests cover: operator allowed, non-operator rejected, unauthenticated 401, originless same-origin allowed, foreign origin rejected.

## Reference implementation

Branch `hosted/03-hosted-mode-oidc`, commit `2f4cbb1`, written against the OLD base. Port it; do not merge it.

`git show 2f4cbb1 -- apps/service/src/config.rs apps/service/src/operator_session.rs apps/service/src/api.rs apps/service/src/lib.rs apps/service/src/main.rs apps/service/src/static_ui.rs apps/service/tests/hosted_mode.rs apps/web/src/components/app-shell.tsx apps/web/src/lib/companion-client.ts`

That reference set `allow_originless_requests: false`, which is the bug. Do not copy that line.

## Differences on current main you must handle

- `ServiceConfig` has a new field `bridge_port: Option<u16>`. Hosted mode should set it to `None` (no LAN bridge listener on a public host).
- `LaunchMode` currently has only `Desktop` and `Headless`; add `Hosted`.
- There are now three config constructors (`development`, `desktop`, `headless`); follow their shape.
- Upstream added `tan_bridge.rs` / `lan_bridge.rs`. Do not touch them in this ticket.

## Environment contract (the installer already writes these)

`TAN_STUDIO_HOSTED=1`, `TAN_STUDIO_BIND_HOST=127.0.0.1`, `TAN_STUDIO_PORT=8080`, `TAN_STUDIO_DATABASE_PATH`, `TAN_STUDIO_WEB_ROOT`, `TAN_STUDIO_VERSION`, `TAN_STUDIO_PUBLIC_ORIGIN=https://studio.tan.coffee`, `TAN_STUDIO_OIDC_ISSUER=https://accounts.google.com`, `TAN_STUDIO_OIDC_REDIRECT_URI=https://studio.tan.coffee/auth/google/callback`, `TAN_STUDIO_OIDC_CLIENT_ID`, `TAN_STUDIO_OIDC_CLIENT_SECRET`, `TAN_STUDIO_OPERATOR_EMAIL`, `TAN_STUDIO_SESSION_SECRET` (64 hex).

Derive `allowed_origins` and `allowed_hosts` from `TAN_STUDIO_PUBLIC_ORIGIN`. Keep that behaviour.

## Comments

- 2026-08-24 — Merged to `hosted/v2`. `ServiceConfig::hosted()` sets `allow_originless_requests: true` with two tests that were confirmed to fail when it is flipped back. 15 hosted integration tests against an in-process OIDC issuer signing real RS256 id_tokens: operator allowed end to end, non-operator refused with no cookie set, foreign origin rejected even with a valid session, and `studio.tan.coffee.evil.example` rejected. Verified live after deploy: an originless same-origin GET now returns 401 (judged on session) instead of 403, and both foreign-origin shapes return 403 `origin_not_allowed`. The reported bug is gone.
