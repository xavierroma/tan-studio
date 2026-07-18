# Tan Studio

Tan Studio is a local-first, modern desktop replacement for Kaffelogic Studio, built around a Tauri shell, transport-neutral React/Vite interface, and Bun companion service.

## Deliverables

- [`docs/01-current-product-discovery.md`](docs/01-current-product-discovery.md) - evidence-tagged inventory of the existing Studio and Nano 7 feature set
- [`docs/02-usb-protocol-and-file-formats.md`](docs/02-usb-protocol-and-file-formats.md) - USB/TCP transport, SASSI framing, `.kpro` and `.klog` formats, and implementation cautions
- [`docs/03-product-requirements-document.md`](docs/03-product-requirements-document.md) - full product requirements, architecture, user journeys, acceptance criteria, and delivery plan
- [`docs/04-technical-specification.md`](docs/04-technical-specification.md) - normative clean architecture, modules, contracts, schema, API, USB, native-format, printing, frontend, security, packaging, and verification specification
- [`mockups/kaffelogic-modern-studio.excalidraw`](mockups/kaffelogic-modern-studio.excalidraw) - editable multi-frame Excalidraw UI board
- [`mockups/README.md`](mockups/README.md) - mockup index and review notes
- [`mockups/previews/overview.png`](mockups/previews/overview.png) - rendered overview of all eleven workflow frames

## Status

Discovery is based on official Kaffelogic documentation, a read-only inspection of Kaffelogic Studio 7.4.3 on macOS, local `.kpro`/`.klog` samples, and static interoperability analysis of the installed application. No roaster commands, firmware writes, formats, deletes, or remote-control actions were performed.

The PRD and mockups include the full green-coffee lineage—provider, purchase, coffee identity, physical lot, roast history, multiple tastings, and next-roast plan—plus a database-scale roast notebook and calm Bali-house visual system.

The Nano initially was not powered/enumerating, but a follow-up after power-on verified the expected RP2040 CDC ACM interfaces and full-speed USB device node. After Studio exited, a read-only host-side observation captured repeated type-2 SASSI requests and verified their identity fields, advertised limits, changing seed, and CRC. No application bytes or explicit modem-control operations were sent. The remaining transport gates are the host response, complete handshake, status/filesystem traffic, transfers, and supervised live-roast capture.
