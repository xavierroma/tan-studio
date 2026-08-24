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
