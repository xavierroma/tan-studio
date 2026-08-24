# GCP e2-micro, SQLite, GCS, OpenTofu

The canonical backend runs on a GCP always-free e2-micro VM in `us-west1` (Oregon, zone `us-west1-a`). Always-free compute is the same in `us-west1`, `us-central1`, and `us-east1`; Oregon is closer to the operator than Iowa. The notebook stays in SQLite and is continuously replicated to a GCS bucket in the same project (Litestream or equivalent). Attachments live in that bucket. The operator accepted US residency for this data to keep compute at $0.

Provision the VM, disk, firewall, bucket, DNS, and service account with OpenTofu in this repo. That is a weekend recreate, not a multi-cloud abstraction.

One hostname on that VM: `studio.tan.coffee`. It serves the UI, `/api/v1`, and the Tan Bridge session at `wss://studio.tan.coffee/device/v1/session`. The bridge is not a separate deployment; it is a route on the same notebook service. This replaces the earlier `bridge.tanstudio.xroma.dev` constant. Apex `tan.coffee` is the public site and landing page; it is not the notebook.

Supabase Free was rejected: it pauses, has no automatic backups, and caps uploads at 50 MB.

**Superseded in part by [ADR-0005](./0005-lan-only-bridge-transport.md).** The `wss://studio.tan.coffee/device/v1/session` route named above was never built, and hosted mode runs no bridge listener. The rest of this decision — region, SQLite, GCS replication, OpenTofu, one hostname — stands.
