# Raspberry Pi deployment

Tan Studio runs directly under systemd; Docker is used only to build a pinned,
Linux ARM64 release. This keeps the production USB path native and makes the
same artifact reusable across Raspberry Pi OS or Debian ARM64 installations.

## Fresh Pi

1. Flash a 64-bit Raspberry Pi OS Lite or Debian image.
2. Set hostname `tan-studio`, configure Wi-Fi and enable SSH.
3. Create the `xavi` administrator (or override `TAN_STUDIO_PI_HOST`).
4. Install a deployment key once:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_tan_studio
   ssh-copy-id -i ~/.ssh/id_ed25519_tan_studio.pub xavi@tan-studio.local
   ```

5. Start Docker Desktop on the build Mac, then deploy:

   ```bash
   bun run deploy:pi
   ```

For an address that is not yet available through mDNS:

```bash
TAN_STUDIO_PI_HOST=xavi@10.0.0.245 bun run deploy:pi
```

The installer is idempotent across machines and preserves the LAN token and
database. Releases are immutable under `/opt/tan-studio/releases`; the active
release is `/opt/tan-studio/current`. SQLite, quarantined sources and backups
live under `/var/lib/tan-studio`.

Updates stop the service, copy a pre-deployment database backup, switch the
release symlink, restart, and require `/healthz` to pass. A failed health check
restores the previous application symlink.
