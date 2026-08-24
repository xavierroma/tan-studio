# 03: Hosted mode + Google operator session

**What to build:** A hosted launch of the same canonical backend speaks `studio.tan.coffee`, does not put a LAN token in the HTML, and lets only the allowlisted operator in via Sign in with Google. After login, the operator can use `/api/v1` with an HttpOnly Secure cookie. Desktop and LAN launch modes keep their existing tokens.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Hosted mode allows Host/Origin `studio.tan.coffee` and rejects a hostile Host.
- [x] Hosted HTML does not contain a bearer token or other session secret.
- [x] Unauthenticated `/api/v1` calls return 401.
- [x] Sign in with Google (authorization code) sets an HttpOnly, Secure, SameSite session cookie.
- [x] The allowlisted operator email can call `/api/v1`; any other Google account is refused without seeing the notebook.
- [x] Sign out clears the cookie; the next `/api/v1` call is unauthenticated.
- [x] Desktop bearer and LAN token paths still work in their launch modes.
- [x] CI uses a fake OIDC issuer; no live Google in tests.
- [x] `/healthz` stays unauthenticated and Host-restricted.
- [x] `/device/v1` is not claimed as a React route.

## Comments

Landed on `hosted/03-hosted-mode-oidc` (`2f4cbb1`, `a2f7b52`). `LaunchMode::Hosted`, Google authorization-code OIDC, HttpOnly Secure cookie, fake issuer in tests. Not merged to `main`. Claims/WebSocket are ticket 08.

## Comments

- 2026-08-23 — Ticket 01 locked the hosted OIDC redirect to `https://studio.tan.coffee/auth/google/callback` (origin `https://studio.tan.coffee`). Implement that path; do not invent a second callback.
