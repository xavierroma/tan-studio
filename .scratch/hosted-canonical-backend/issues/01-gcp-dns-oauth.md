# 01: GCP project, DNS, Google OAuth, budget alerts

**What to build:** The operator can log into a GCP project in `us-west1` that is ready to receive the studio VM, a GCS bucket, and Sign in with Google on `studio.tan.coffee`. Apex `tan.coffee` is not pointed at this service.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] A GCP billing account and project exist; Compute Engine, Cloud Storage, and IAM APIs are enabled.
- [x] A budget alert is on, so free-tier overage is visible.
- [x] DNS for `studio.tan.coffee` is in the operator’s control (registrar or Cloud DNS) and will be updatable by OpenTofu or a documented record.
- [x] A Google OAuth client of type Web exists with authorized origin `https://studio.tan.coffee` and redirect `https://studio.tan.coffee` (callback path as the hosted mode implements). Client ID and secret are stored as secrets, not in git.
- [x] The operator Google email to allowlist is written down for hosted config.
- [x] Apex `tan.coffee` is left for the public site; this ticket does not serve the notebook there.

## Answer

Project `tan-coffee` in `us-west1` is ready for the studio VM and Sign in with Google.

- VM `tan-notebook` (`e2-micro`, `us-west1-a`) has static IP `136.67.36.35`. Apex `tan.coffee` stays on Vercel. `studio.tan.coffee` is a Cloud DNS zone (`studio-tan-coffee`); public NS is `ns-cloud-a1`–`a4.googledomains.com` and public A is that IP.
- Budget `tan-coffee hosted notebook` is $5/month on billing account `019874-118FAB-BDEC6E`.
- Web OAuth client: origin `https://studio.tan.coffee`, redirect `https://studio.tan.coffee/auth/google/callback`. Client ID/secret in gitignored `.env` and Secret Manager (`google-oauth-client-id` / `google-oauth-client-secret`).
- Operator allowlist: `romaxavier12@gmail.com`.

Public facts: `../operator-notes.md`. Next unblocked: ticket 04 (OpenTofu import of this VM).

## Comments

- 2026-08-23 — CLI work on project `tan-coffee` (1033405121253), billing `019874-118FAB-BDEC6E`:
  - Enabled IAM, IAM Credentials, Cloud DNS, Cloud Billing, Billing Budgets, Secret Manager. Compute Engine and Cloud Storage were already on.
  - Created Cloud DNS zone `studio-tan-coffee` for `studio.tan.coffee.` (NS `ns-cloud-a1`–`a4.googledomains.com`). Apex still on Vercel.
  - Created monthly budget `tan-coffee hosted notebook` at $5 (50/90/100%). Billing admin `romaxavier12@gmail.com` gets the default mail.
  - Hosted OIDC redirect locked to `https://studio.tan.coffee/auth/google/callback`.
  - Remaining: Vercel NS delegation for `studio`, Google Auth Platform branding + authorized domain + Web client. Wizard: `setup-gcp-dns-oauth.sh` in the parent directory.
- 2026-08-23 — Instance `tan-notebook` is a non-preemptible e2-micro in `us-west1-a` (Oregon). Always-free e2-micro is valid in `us-west1` / `us-central1` / `us-east1`; keep Oregon, do not recreate in Iowa. Static IP `136.67.36.35` (`tan-notebook-ip`), firewall `allow-studio-http-https` (tag `tan-studio`), Cloud DNS A for `studio.tan.coffee`. Disk is 10 GB **pd-balanced** (not the free pd-standard SKU). SSH still world-open.
- 2026-08-23 — Operator marked this ticket done. DNS delegation and OAuth client are live; facts in `operator-notes.md`.
- 2026-08-23 — Operator finished wizard: public `studio.tan.coffee` NS is Cloud DNS, A is `136.67.36.35`; OAuth client ID/secret in `.env` and Secret Manager; allowlist `romaxavier12@gmail.com`. Ticket completed.
- 2026-08-23 — Boot disk swapped to 10 GB pd-standard (snapshot, replace, delete snapshot). Instance running, IP still `136.67.36.35`.
