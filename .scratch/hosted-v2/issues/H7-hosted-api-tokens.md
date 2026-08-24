# H7: API tokens so MCP and HTTP clients work against the hosted origin

**What to build:** The MCP server and a plain HTTP client can call `https://studio.tan.coffee/api/v1/**` with a credential the operator can mint and revoke — without weakening the one-operator guarantee and without reusing the launch token.

**Blocked by:** H1 (hosted mode must exist first; this edits the same files)

**Status:** completed

## Why this exists

In hosted mode `authenticated_for_api` accepts only the signed `tan_operator_session` cookie, and `launch_token` is `""`. An MCP client or `curl` passes the Host and Origin gates and is then rejected `401 unauthenticated` — that check is the first and only failure. Hosted `allowed_client_ids` is currently dead code: nothing consults it.

The MCP plugin already sends `Authorization: Bearer <token>` and `X-Tan-Studio-Client: tan-studio-api-v1` (`plugins/tan-studio/src/api.ts:70-76`) and its base URL is configurable and already accepts https (`plugins/tan-studio/src/config.ts:52-72`). So the plugin needs **no code change** beyond pointing `TAN_STUDIO_URL` at the hosted origin — it needs a credential the server will accept.

- [ ] A hosted API token is **per-client, hashed at rest, and individually revocable**. Store `(id, label, sha256(secret), created_at, last_used_at, revoked_at)`; never store the secret.
- [ ] The operator mints one from behind their session; the secret is shown exactly once.
- [ ] `authenticated_for_api` for `LaunchMode::Hosted` accepts **cookie OR a valid API token**. Compare digests in constant time. A revoked or unknown token is 401.
- [ ] `allowed_client_ids` becomes load-bearing in hosted mode again — check it on both branches, not just the SPA one. It is defence in depth that is currently silently absent.
- [ ] **Do not reuse `TAN_STUDIO_LAN_TOKEN`.** A single global static bearer has no attribution and no revocation short of a redeploy; that is indistinguishable from a second permanent anonymous operator.
- [ ] CSRF: the session cookie is `SameSite=Lax` and these routes now also accept `Authorization`. Keep the Origin gate, and require `X-Tan-Studio-Client` on cookie-authenticated mutations — a cross-site form post cannot set a custom header.
- [ ] `/api/v1/openapi.json` sits inside the authenticated nest. Decide deliberately whether the contract is fetchable with an API token (it should be) and test it.
- [ ] Tests: MCP-shaped request with a valid token succeeds; revoked token 401; unknown token 401; cookie path still works; wrong client id rejected; no token 401.

## Fix in passing

`cursor_key` is derived from `launch_token` (`api.rs:54`), which is empty in hosted mode — pagination cursors are HMAC'd with an **empty key**. Derive it from the session secret or its own random key instead. Cover it with a test.

## Definition of done

From a machine that is not the VM, with only a minted token:

```
TAN_STUDIO_URL=https://studio.tan.coffee TAN_STUDIO_API_TOKEN=<minted> bun run --filter @tan-studio/codex-plugin <an mcp tool call>
curl -H "Authorization: Bearer <minted>" -H "X-Tan-Studio-Client: tan-studio-api-v1" https://studio.tan.coffee/api/v1/coffees
```

both return real data, and the browser SPA still works.

## Comments

- 2026-08-24 — Merged to `hosted/v2`. Migration `0014_hosted_api_tokens.sql` stores only SHA-256 digests with a `revoked_at_ms` column; acceptance is constant-time with no early exit. `authenticated_for_api` now returns a `Credential` enum (operator session, API token, launch token). `allowed_client_ids` moved into `recognized_client` and is checked on every placement, so it is load-bearing in hosted mode again. `cursor_key` derives from the session secret with a random fallback, so hosted cursors are no longer HMAC'd with an empty key. `/auth/logout` is POST-only.

  Verified live: unknown bearer 401, unrecognized client id 401, `GET /auth/logout` 405, `/api/v1/openapi.json` 401 unauthenticated.

  **Not verified live: the positive token path.** Minting requires the operator's browser session, which needs a Google sign-in an agent must not perform. Covered in-process by tests; needs one operator action to confirm against the real origin.
