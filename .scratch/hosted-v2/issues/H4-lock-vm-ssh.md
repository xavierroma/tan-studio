# H4: Close public SSH on the VM

**What to build:** SSH to `tan-notebook` is no longer open to the whole internet, and deploys still work afterwards.

**Blocked by:** H6 (do this only after a verified deployment, so a lockout cannot strand a broken release)

**Status:** ready-for-agent

- [ ] `default-allow-ssh` from `0.0.0.0/0` no longer applies to this VM.
- [ ] SSH ingress is restricted — IAP range `35.235.240.0/20`, or the operator's own address, whichever keeps the deploy path working.
- [ ] **`bun run deploy:hosted` still succeeds after the change.** If the answer is IAP-only, the deploy script must tunnel through IAP; prove it end to end, do not assume.
- [ ] HTTP/HTTPS ingress is unchanged and the site stays up throughout.
- [ ] The change is expressed in the OpenTofu stack under `infra/`, not clicked in the console.
- [ ] `tofu plan` output is recorded on the ticket before apply.

Danger: this ticket can lock the operator out of their own VM. Verify the new path works **before** removing the old one.

## Observed state (2026-08-24, project `tan-coffee`)

| Rule | Source | Allow | Target tags |
| --- | --- | --- | --- |
| `allow-studio-http-https` | `0.0.0.0/0` | tcp:80, tcp:443 | `tan-studio` — correct, keep |
| `default-allow-ssh` | `0.0.0.0/0` | tcp:22 | **none — applies to every instance** |
| `default-allow-internal` | `10.128.0.0/9` | all | none |
| `default-allow-icmp` | `0.0.0.0/0` | icmp | none |

`default-allow-ssh` is the rule to close, and note it is untagged, so it is project-wide rather than specific to this VM.

## The trap

`script/deploy_hosted.sh` SSHes directly to the public IP. Restricting SSH to the IAP range `35.235.240.0/20` therefore **breaks the deploy path** unless the script is switched to `gcloud compute ssh --tunnel-through-iap` (or an equivalent tunnel). Pinning to the operator's current home address instead keeps the script working but rots the moment their IP changes.

Prefer IAP plus a deploy script that tunnels: it survives an IP change and needs no standing public SSH. Whichever is chosen, prove `bun run deploy:hosted` still completes **before** removing the existing rule.

