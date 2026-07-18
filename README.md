# Tan Studio

Tan Studio is a local-first, modern desktop replacement for Kaffelogic Studio, built around a Tauri shell, transport-neutral React/Vite interface, and Bun companion service.

## Implemented workspace

```text
apps/web          React 19, Vite, TanStack, Zustand, ECharts and shadcn/Base UI
apps/companion    Authenticated Hono API, SQLite migrations, catalog and roast data
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

The web app is served at `http://127.0.0.1:1420`; the development companion binds only to `127.0.0.1:4317`, uses the development-only token, and seeds a representative local workspace. Production gets a fresh 256-bit launch token and random loopback port from the Tauri shell.

The current implementation is the compatibility foundation plus an offline product vertical slice: catalog/lot reads, the roast database, log detail and telemetry charts, lossless parsers, SASSI framing, deterministic label rendering, and the secured desktop/companion lifecycle are executable. Hardware connection, device writes, automated print submission, persisted profile editing, and AI/remote adapters remain capability-disabled until their implementation and verification gates pass. Packaged builds fail closed and never replace unavailable device, roast, or print state with sample data; the sample workspace is enabled only by the explicit development setting in `apps/web/.env.development`.

Run the complete verification gate with:

```sh
bun run check
```

Build the target-specific Bun sidecar before packaging the desktop application:

```sh
bun apps/desktop/scripts/build-sidecar.ts
```

## Product and engineering references

- [`docs/01-current-product-discovery.md`](docs/01-current-product-discovery.md) - evidence-tagged inventory of the existing Studio and Nano 7 feature set
- [`docs/02-usb-protocol-and-file-formats.md`](docs/02-usb-protocol-and-file-formats.md) - USB/TCP transport, SASSI framing, `.kpro` and `.klog` formats, and implementation cautions
- [`docs/03-product-requirements-document.md`](docs/03-product-requirements-document.md) - full product requirements, architecture, user journeys, acceptance criteria, and delivery plan
- [`docs/04-technical-specification.md`](docs/04-technical-specification.md) - normative clean architecture, modules, contracts, schema, API, USB, native-format, printing, frontend, security, packaging, and verification specification
- [`mockups/kaffelogic-modern-studio.excalidraw`](mockups/kaffelogic-modern-studio.excalidraw) - editable multi-frame Excalidraw UI board
- [`mockups/README.md`](mockups/README.md) - mockup index and review notes
- [`mockups/previews/overview.png`](mockups/previews/overview.png) - rendered overview of all eleven workflow frames

## Discovery status

Discovery is based on official Kaffelogic documentation, a read-only inspection of Kaffelogic Studio 7.4.3 on macOS, local `.kpro`/`.klog` samples, and static interoperability analysis of the installed application. No roaster commands, firmware writes, formats, deletes, or remote-control actions were performed.

The PRD and mockups include the full green-coffee lineage—provider, purchase, coffee identity, physical lot, roast history, multiple tastings, and next-roast plan—plus a database-scale roast notebook and calm Bali-house visual system.

The Nano initially was not powered/enumerating, but a follow-up after power-on verified the expected RP2040 CDC ACM interfaces and full-speed USB device node. After Studio exited, a read-only host-side observation captured repeated type-2 SASSI requests and verified their identity fields, advertised limits, changing seed, and CRC. No application bytes or explicit modem-control operations were sent. The remaining transport gates are the host response, complete handshake, status/filesystem traffic, transfers, and supervised live-roast capture.
