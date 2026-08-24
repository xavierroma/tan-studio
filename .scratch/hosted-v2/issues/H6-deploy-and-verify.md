# H6: Deploy current main and prove the whole surface works

**What to build:** `https://studio.tan.coffee` runs current main, and every client surface is verified live.

**Blocked by:** H1, H2, H7

**Status:** blocked

- [ ] The deployed `applicationVersion` matches the merged HEAD, not the old pre-upstream build.
- [ ] Browser: sign in with Google as the operator, load the notebook UI, and read real data. No `origin_not_allowed`.
- [ ] A non-operator Google account is refused.
- [ ] MCP: a tool call against `TAN_STUDIO_URL=https://studio.tan.coffee` with a minted API token returns real data.
- [ ] HTTP API: `curl` with a minted token returns real data; without one, 401.
- [ ] `/healthz` public; every `/api/v1/**` route unauthenticated returns 401.
- [ ] Reboot the VM once more and confirm the whole surface returns unaided.
- [ ] Record the deployed SHA and what was verified on the ticket.
