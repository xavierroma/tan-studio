# Tan Studio

Tan Studio is a calm, local-first Kaffelogic Nano 7 notebook. A React/Vite interface talks to one strongly typed Rust service, whether it runs as a Tauri macOS sidecar or an always-on Raspberry Pi appliance.

## Product model

The public API is intentionally small:

```text
Profile 1-N Roast N-1 Coffee
Roast   1-N Brew
Roast   1-N Label
Note    N-M Profile | Coffee | Roast | Brew
Settings singleton
```

All public resources use short positive integer IDs. KLOG/KPRO source files, telemetry, and device synchronization remain internal lossless evidence.

See the current [product requirements](docs/03-product-requirements-document.md) and [technical specification](docs/04-technical-specification.md).

## Workspace

```text
apps/web       React 19, Vite 8, TanStack Router/Query, ECharts, shadcn/Base UI
apps/service   Rust Axum/OpenAPI API, SQLite, KLOG/KPRO, SASSI and USB session
apps/desktop   Tauri 2 shell and Rust sidecar packaging
packages/ui    shadcn base-nova components and Bali/coffee semantic tokens
packages/printing-adapters  physical label document and deterministic SVG/QR
```

The historical TypeScript companion/packages are not used in production. Runtime and OpenAPI authority live in `apps/service`.

## Development

Requires Bun and Rust:

```sh
bun install
bun run dev
```

The UI is at `http://127.0.0.1:1420`; the development Rust service is at `127.0.0.1:4317`.

Run the full gate:

```sh
bun run check
```

Generate the API client after Rust contract changes:

```sh
bun run contract:generate
```

## Connect a Nano 7

1. Quit Kaffelogic Studio so it releases the serial port.
2. Connect and power the Nano with a USB data cable.
3. Open Devices and choose Refresh or Synchronize.

The Rust service discovers the Kaffelogic RP2040 CDC device (`VID 0x2e8a`, `PID 0x000a`), negotiates SASSI, lists profile/log directories, downloads files, validates them, and imports them transactionally. Users never enter a `/dev` path.

Read-only discovery and file synchronization are implemented. Unverified profile/device write commands are absent.

## macOS executable

```sh
bun run build
```

The Tauri build creates `Tan Studio.app` and verifies that both the shell and its Rust sidecar launch.

## Raspberry Pi appliance

The Pi serves the same built UI and API at `http://tan-studio.local`, with the Nano attached to the Pi over USB.

```sh
bun run build:pi
bun run deploy:pi
```

Docker is used on the build Mac for a reproducible ARM64 artifact; the Pi runs native binaries under systemd. See [the Pi deployment guide](deploy/raspberry-pi/README.md).

## Website on the Mac LAN

Until the Raspberry Pi is available, the same headless Rust service can run persistently on the Mac and serve both the UI and API:

```sh
bun run lan:install
bun run lan:status
```

The installer builds an immutable release under the application's support directory, reuses the desktop database, generates a private LAN session token, and registers a per-user `launchd` service. It prints both the `.local` and numeric LAN URLs plus the token file required by non-browser API clients. Keep the desktop application closed while LAN mode is running because only one process can own the Nano USB serial port.

```sh
bun run lan:stop
bun run lan:start
```

## References

- [Existing Studio feature discovery](docs/01-current-product-discovery.md)
- [USB, SASSI, KPRO and KLOG evidence](docs/02-usb-protocol-and-file-formats.md)
- [Current product requirements](docs/03-product-requirements-document.md)
- [Current technical specification](docs/04-technical-specification.md)
- [Real-device and Studio parity evidence](docs/05-e2e-verification.md)
- [Editable Excalidraw board](mockups/kaffelogic-modern-studio.excalidraw)
