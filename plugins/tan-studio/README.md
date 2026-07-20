# Tan Studio Codex plugin

This plugin gives Codex a compact, typed interface to Tan Studio. It is a thin adapter over the generated OpenAPI client: the Rust service remains the sole owner of SQLite, defaults, validation, USB synchronization, native files, and label artifacts.

## Controller layering

```text
Codex
  → MCP controller (mcp.ts)
  → TanStudioGateway port (gateway.ts)
  → generated OpenAPI adapter (api.ts)
  → Rust REST controller
  → the same Rust application services used by the web UI
  → SQLite / USB / files / printing ports
```

The MCP controller is intentionally unable to import the HTTP adapter, configuration, generated client, database, or device implementation. The composition root in `server.ts` injects `OpenApiTanStudioGateway`; tests inject an in-memory fake of the same port. The repository's architecture check enforces this dependency direction.

## Development

From the repository root:

```sh
bun install
bun run contract:generate
bun run --cwd plugins/tan-studio typecheck
bun run --cwd plugins/tan-studio test
bun run --cwd plugins/tan-studio build
```

The plugin manifest is `.codex-plugin/plugin.json`; `.mcp.json` starts the bundled `dist/server.js` stdio server with Bun. Runtime dependencies are bundled so an installed plugin does not depend on the repository's `node_modules`. The MCP process reads `~/.config/tan-studio/codex-plugin.json` and allows `TAN_STUDIO_URL`, `TAN_STUDIO_API_TOKEN`, `TAN_STUDIO_TOKEN_FILE`, `TAN_STUDIO_CONFIG_FILE`, and `TAN_STUDIO_TIMEOUT_MS` overrides. See the skill's [configuration reference](skills/tan-studio/references/configuration.md) for credential discovery.

`src/generated/api.ts` is generated from `apps/web/src/generated/openapi.json`. Do not edit it manually. Root contract checks fail if either the web or plugin client drifts from the Rust service's OpenAPI document.

The repeatable isolated and live MCP test clients are documented in the repository's [Codex MCP test plan](../../docs/07-codex-mcp-test-plan.md). They speak MCP over stdio; they are not a separate end-user CLI.

## Boundary

The plugin exposes curated workflow tools and read resources only, including coffee creation/update and local attachment upload through the typed API. It does not expose arbitrary REST calls, SQL, raw serial access, or speculative Kaffeelogic write commands. Agent-facing masses, temperatures, ratings, and label dimensions use human units and are converted to exact integer API units at the MCP-controller boundary, then validated again by the Rust API.
