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

The plugin manifest is `.codex-plugin/plugin.json`; `.mcp.json` starts the bundled `dist/server.js` stdio server with Bun. Runtime dependencies are bundled so an installed plugin does not depend on the repository's `node_modules`. The default service is `https://studio.tan.coffee`. The MCP process reads `~/.config/tan-studio/mcp.json` and allows `TAN_STUDIO_URL`, `TAN_STUDIO_API_TOKEN`, `TAN_STUDIO_TOKEN_FILE`, `TAN_STUDIO_CONFIG_FILE`, and `TAN_STUDIO_TIMEOUT_MS` overrides. See the skill's [configuration reference](skills/tan-studio/references/configuration.md) for credential discovery.

`src/generated/api.ts` and `src/generated/openapi.json` are generated from `apps/web/src/generated/openapi.json`. Do not edit it manually. Root contract checks fail if either the web or plugin client drifts from the Rust service's OpenAPI document.

The repeatable isolated and live MCP test clients are documented in the repository's [Codex MCP test plan](../../docs/07-codex-mcp-test-plan.md). They speak MCP over stdio; they are not a separate end-user CLI.

## Boundary

The plugin exposes every versioned OpenAPI operation as a `tan_api_*` tool, plus the existing workflow tools and read resources. Runtime input schemas come from the same generated OpenAPI contract as the REST types. The Rust authority derives the same operation names and exact method/path grants from its own OpenAPI document. New operations and fields therefore do not need a second hand-written MCP schema or route allowlist.

API tools use `path`, `query`, `headers`, and `body` objects. They retain the exact REST field names, integer units, optional fields, null clearing, and `If-Match` revision headers. Binary attachment content uses `contentBase64`. No caller can supply a different URL, HTTP method, authorization header, SQL, or serial command. Existing API permission checks still apply, including operator-session requirements for credential and bridge administration. Read-only hosted credentials see GET tools only.

For example, link coffee 4 to roast 29 without changing any measurement:

```json
{
  "name": "tan_api_update_roast",
  "arguments": {
    "path": { "id": 29 },
    "headers": { "If-Match": "\"revision:2\"" },
    "body": { "coffeeId": 4 }
  }
}
```

The convenience equivalent is `tan_update_roast` with `roastId`, `revision`, and `coffeeId`. Set `coffeeId` to null to clear it. `greenInputGrams` records a measured input separately from the device's Boost load retained in native metadata. Convenience tools keep their human units; API tools use the units named in the REST fields.

Request, response and execution limits remain in force. Hosted MCP does not read local files. A large local file uses the stdio upload helper; the API byte-content tools work within the MCP transport size limit. Device synchronization can continue after a request times out: inspect `tan_api_list_device_sync_runs` and the imported records before another sync request.
