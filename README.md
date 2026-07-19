# Tan Studio

Tan Studio is a local-first, modern replacement for Kaffelogic Studio. The same React/Vite interface and Rust service run either in a Tauri desktop shell or as an always-on Raspberry Pi appliance.

## Implemented workspace

```text
apps/web          React 19, Vite, TanStack, Zustand, ECharts and shadcn/Base UI
apps/service      Axum/OpenAPI API, SQLite, SASSI USB session and native-log ingestion
apps/desktop      Tauri 2 shell and signed-sidecar packaging foundation
packages/domain   Framework-free product model and invariants
packages/application  Use cases and outward-facing ports
packages/api-contract Versioned Zod transport contracts
packages/device-sassi Incremental SASSI framing and verified CRC codec
packages/native-format-adapters Lossless native text/table parsing
packages/printing-adapters Canonical label model and deterministic SVG/QR rendering
packages/ui        CLI-managed shadcn `base-nova` components and Bali theme tokens
```

Install and run the local browser development stack with Bun:

```sh
bun install
bun run dev
```

The web app is served at `http://127.0.0.1:1420`; the development service binds only to `127.0.0.1:4317` and uses the development-only token. Desktop production gets a fresh 256-bit launch token and random loopback port from the Tauri shell.

## Raspberry Pi appliance

The appliance serves the website and authenticated API at `http://tan-studio.local`, remains active when no browser is open, and automatically discovers a Nano connected to the Pi by USB. Docker is used on the build Mac only; the Pi runs native ARM64 executables under systemd.

With Docker Desktop running and SSH key access configured, deploy or update with:

```sh
bun run deploy:pi
```

Build a reusable artifact without deploying it with `bun run build:pi`. Fresh-Pi setup, paths, overrides, backup, and rollback behavior are documented in [`deploy/raspberry-pi/README.md`](deploy/raspberry-pi/README.md).

The current implementation is the compatibility foundation plus an offline product vertical slice: catalog/lot reads, the roast database, log detail and telemetry charts, SASSI framing, native `.klog` parsing/import, deterministic label rendering, and the secured desktop/service lifecycle are executable. The Rust USB actor implements Nano CDC discovery, the SASSI v1 handshake, status reads, profile/log directory listing, log download, validation, and transactional import. The local 13-log corpus is verified end to end; the filesystem-sync path still requires a final hardware run when macOS exposes the connected Nano as a serial device. Device writes, automated print submission, persisted profile editing, and AI/remote adapters remain capability-disabled until their implementation and verification gates pass. Packaged builds fail closed and never replace unavailable device, roast, or print state with sample data.

## Connect a Nano 7

1. Quit Kaffelogic Studio so it releases the serial port.
2. Connect the powered Nano directly with a USB data cable.
3. Run `bun run dev`, then open `http://127.0.0.1:1420/devices`.

Tan Studio automatically selects the Kaffelogic RP2040 CDC device (`VID 0x2e8a`, `PID 0x000a`); users do not select or type a `/dev` path. A successful connection shows the model, firmware, negotiated SASSI version, and `read-only`. Device identity and the ephemeral OS path stay inside the Rust service and are not returned to the browser.

Run the complete verification gate with:

```sh
bun run check
```

Build the target-specific Rust sidecar before packaging the desktop application:

```sh
bun run --cwd apps/desktop build:service
```

## Product and engineering references

- [`docs/01-current-product-discovery.md`](docs/01-current-product-discovery.md) - evidence-tagged inventory of the existing Studio and Nano 7 feature set
- [`docs/02-usb-protocol-and-file-formats.md`](docs/02-usb-protocol-and-file-formats.md) - USB/TCP transport, SASSI framing, `.kpro` and `.klog` formats, and implementation cautions
- [`docs/03-product-requirements-document.md`](docs/03-product-requirements-document.md) - full product requirements, architecture, user journeys, acceptance criteria, and delivery plan
- [`docs/04-technical-specification.md`](docs/04-technical-specification.md) - normative clean architecture, modules, contracts, schema, API, USB, native-format, printing, frontend, security, packaging, and verification specification
- [`docs/05-e2e-verification.md`](docs/05-e2e-verification.md) - real-log reconciliation, Kaffeelogic Studio parity results, exercised UI/API workflows, and the remaining hardware gate
- [`mockups/kaffelogic-modern-studio.excalidraw`](mockups/kaffelogic-modern-studio.excalidraw) - editable multi-frame Excalidraw UI board
- [`mockups/README.md`](mockups/README.md) - mockup index and review notes
- [`mockups/previews/overview.png`](mockups/previews/overview.png) - rendered overview of all eleven workflow frames

## Discovery status

Discovery is based on official Kaffelogic documentation, a read-only inspection of Kaffelogic Studio 7.4.3 on macOS, local `.kpro`/`.klog` samples, static interoperability analysis of the installed application, and a bounded hardware-in-the-loop session. Tan Studio sent only Studio-compatible type-3 time synchronization and type-13 operational/system information requests. No profile or filesystem write, firmware write, format, delete, roast-control, or remote-control action was performed.

The PRD and mockups include the full green-coffee lineage—provider, purchase, coffee identity, physical lot, roast history, multiple tastings, and next-roast plan—plus a database-scale roast notebook and calm Bali-house visual system.

The Nano initially was not powered/enumerating, but a follow-up after power-on verified the expected RP2040 CDC ACM interfaces and full-speed USB device node. After Studio exited, a host-side observation captured repeated type-2 SASSI requests and verified their identity fields, advertised limits, changing seed, and CRC. The implemented adapter then reproduced Studio's 115200 8N1/DTR serial setup, sent a type-3 time-sync response, validated the matching type-4 acknowledgement, and read type-14 responses for information codes 9 and 3. During the latest E2E run macOS again exposed no USB modem node, so the remaining gates are a filesystem inventory/pull against the re-enumerated device, a supervised live-roast capture, and separately reviewed write operations.
