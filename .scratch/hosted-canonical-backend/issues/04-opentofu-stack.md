# 04: OpenTofu stack

**What to build:** In-repo OpenTofu describes the weekend-recreate primitives: e2-micro in `us-west1` (zone `us-west1-a`, instance `tan-notebook` already exists — import, do not create a second e2-micro), disk within the always-free cap, firewall, GCS bucket, service account, and DNS for `studio.tan.coffee`. Applying it is what makes the box exist. This is not a multi-cloud abstraction.

**Blocked by:** 01 (GCP project, DNS, Google OAuth, budget alerts)

**Status:** completed

- [x] `tofu plan` against the operator project is valid (apply may be operator-run).
- [x] Resources covered: VM, persistent disk, VPC firewall (80/443; SSH not world-open), GCS bucket, service account for the VM, DNS for `studio.tan.coffee`.
- [x] State and credentials are not committed.
- [x] Apex `tan.coffee` is not required to point at this VM.
- [x] A short README in the infra tree states region, machine type, and that restore is ticket 06, not “recreate the VM and hope”.

## Comments

- 2026-08-23 — Live box is `tan-notebook` in `us-west1-a`. OpenTofu must **import** it. A second e2-micro in any free-tier region would consume the same monthly hours and start billing. Disk is 10 GB pd-standard.
- 2026-08-23 — Landed on `hosted/04-opentofu-stack` (`7ff392d`, ticket note `ad4b3a9`). `tofu plan` against `tan-coffee`: 4 add, 2 change, 0 destroy. Apply not run. First apply will stop the VM once to attach the service account and will disable world SSH in favor of IAP.
