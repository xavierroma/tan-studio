# Operator notes for hosted studio.tan.coffee

Public facts for tickets 01 / 03 / 04. Secrets live in repo-root `.env` (gitignored) and GCP Secret Manager, not here.

## GCP

| | |
| --- | --- |
| Project ID | `tan-coffee` |
| Project number | `1033405121253` |
| Display name | tan coffee |
| Region | `us-west1` (zone `us-west1-a`) |
| Owner | `operator@example.com` |
| Billing account | `<billing account, see console>` (My Maps Billing Account) |
| Budget | `tan-coffee hosted notebook`, **$5 USD / calendar month**, 50% / 90% / 100% of current spend, filtered to this project. Mail goes to the billing admin. |

Enabled APIs: Compute Engine, Cloud Storage, IAM, IAM Credentials, Cloud DNS, Cloud Billing, Cloud Billing Budgets, Secret Manager.

## VM (`tan-notebook`)

| | |
| --- | --- |
| Zone | `us-west1-a` |
| Machine | non-preemptible `e2-micro` (always-free SKU in this region) |
| External IP | `136.67.36.35` (promoted to static address `tan-notebook-ip`) |
| Disk | 10 GB **pd-standard** (always-free SKU; 30 GB-months cap) |
| OS | Debian 13 |
| Network tag | `tan-studio` (HTTP/S firewall `allow-studio-http-https`) |
| SSH | still `default-allow-ssh` from `0.0.0.0/0` (ticket 04 should lock this) |

## DNS

Apex `tan.coffee` stays on Vercel nameservers (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`) for the public site.

`studio.tan.coffee` is a public Cloud DNS zone in this project so OpenTofu can write the VM address later:

| | |
| --- | --- |
| Zone name | `studio-tan-coffee` |
| DNS name | `studio.tan.coffee.` |
| Nameservers | `ns-cloud-a1.googledomains.com` … `a4` |

Delegation is live: public NS for `studio.tan.coffee` is Cloud DNS; public A is `136.67.36.35`. Apex stays on Vercel.

## OIDC (ticket 03 must match)

| | |
| --- | --- |
| Origin | `https://studio.tan.coffee` |
| Redirect | `https://studio.tan.coffee/auth/google/callback` |
| Operator email | `operator@example.com` (`.env` `OPERATOR_GOOGLE_EMAIL`) |
| Client ID / secret | `.env` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`) and Secret Manager secrets `google-oauth-client-id` / `google-oauth-client-secret` |

gcloud’s default project on this machine is still `daisy-hcp`. Pass `--project=tan-coffee` (or switch config) when touching this stack.
