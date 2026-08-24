# 05: Deploy binary + Caddy + systemd

**What to build:** The operator can reach `https://studio.tan.coffee` in a browser, sign in with Google, and use the hosted notebook UI. TLS is terminated on the VM. A reboot brings Caddy and the service back without SSH.

**Blocked by:** 01 (GCP project, DNS, Google OAuth, budget alerts), 03 (Hosted mode + Google operator session), 04 (OpenTofu stack)

**Status:** claimed

- [ ] The hosted Rust service and built UI run under systemd on the VM.
- [ ] Caddy (or equivalent) terminates TLS for `studio.tan.coffee`, redirects HTTP to HTTPS, and will later support WebSocket on `/device/v1/session` with idle ≥ 90 s and no response buffering.
- [ ] OIDC client secret and session keys come from the environment or secret store, not the image.
- [ ] After reboot, `/healthz` on the allowed Host succeeds without manual steps.
- [ ] The operator can complete Sign in with Google on the live origin and load the UI.
- [ ] Deploy is repeatable (new binary/UI release without hand-editing unit files).
