# H6: Deploy current main and prove the whole surface works

**What to build:** `https://studio.tan.coffee` runs current main, and every client surface is verified live.

**Blocked by:** H1, H2, H7

**Status:** ready-for-human

- [ ] The deployed `applicationVersion` matches the merged HEAD, not the old pre-upstream build.
- [ ] Browser: sign in with Google as the operator, load the notebook UI, and read real data. No `origin_not_allowed`.
- [ ] A non-operator Google account is refused.
- [ ] MCP: a tool call against `TAN_STUDIO_URL=https://studio.tan.coffee` with a minted API token returns real data.
- [ ] HTTP API: `curl` with a minted token returns real data; without one, 401.
- [ ] `/healthz` public; every `/api/v1/**` route unauthenticated returns 401.
- [ ] Reboot the VM once more and confirm the whole surface returns unaided.
- [ ] Record the deployed SHA and what was verified on the ticket.

## Comments

- 2026-08-24 — Deployed and verified except for the one step an agent must not take. Live release `99cf737ae0f2` on `https://studio.tan.coffee`, matching merged HEAD (the `-dirty` suffix comes from untracked directories in the working tree, not modified tracked files).

  Verified live from outside the VM: `/healthz` public and ok; an originless same-origin GET returns **401** rather than the old **403**, which is the reported bug fixed; `Origin: https://evil.example` and `https://studio.tan.coffee.evil.example` both 403 `origin_not_allowed`; unknown bearer 401; unrecognized client id 401 (so `allowed_client_ids` is load-bearing again); `GET /auth/logout` 405; `/api/v1/openapi.json` 401 unauthenticated; `/` 200; `/auth/google` 302 to Google with the correct redirect URI. A reboot was performed earlier and the whole surface returned unaided.

  **Outstanding, needs the operator:** completing Google sign-in, and minting an API token to prove the MCP and `curl` paths against the live origin. Minting is deliberately gated behind the operator's browser session, so it cannot be automated; writing a credential digest straight into the live database was refused by safety policy, correctly. Sign in at `https://studio.tan.coffee/auth/google`, then Settings -> Access -> Mint token.
