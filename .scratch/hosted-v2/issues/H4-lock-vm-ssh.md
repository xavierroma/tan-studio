# H4: Close public SSH on the VM

**What to build:** SSH to `tan-notebook` is no longer open to the whole internet, and deploys still work afterwards.

**Blocked by:** H6 (do this only after a verified deployment, so a lockout cannot strand a broken release)

**Status:** ready-for-human

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

## Comments

- 2026-08-24 — **Blocked on permission, not on knowledge.** The plan is settled and the prerequisites are confirmed: the VM carries the `tan-studio` network tag, and the operator account is project owner. Creating the firewall rule was refused by this environment's safety policy, which gates network security changes. It needs a human.

  `default-allow-ssh` still allows `tcp:22` from `0.0.0.0/0`, and it is untagged, so it covers every instance in the project.

  Do it in this order — the additive rule and the proof come **before** the removal, so a failure cannot strand the box:

  ```
  gcloud compute firewall-rules create allow-studio-ssh --project=tan-coffee \
    --network=default --direction=INGRESS --action=allow --rules=tcp:22 \
    --source-ranges=35.235.240.0/20 --target-tags=tan-studio \
    --description="SSH via IAP TCP forwarding only"

  gcloud compute ssh tan-notebook --zone=us-west1-a --project=tan-coffee --tunnel-through-iap --command='echo ok'
  ```

  Only once that prints `ok`: `script/deploy_hosted.sh` must be switched to tunnel through IAP, because it currently SSHes straight to `136.67.36.35` and will break the moment public SSH closes. Prove `bun run deploy:hosted` still completes, and only then:

  ```
  gcloud compute firewall-rules delete default-allow-ssh --project=tan-coffee
  ```

  Leave HTTP/HTTPS (`allow-studio-http-https`) alone. Note also that `infra/` OpenTofu has still never been applied, so the stack does not describe live reality; a blind `tofu apply` would create unrelated resources and stop/start the VM, which is why this was not routed through it.
