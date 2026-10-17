import { copyFile } from "node:fs/promises"

// Keep runtime MCP schemas beside the generated REST types, from the same source.
await copyFile(
  new URL("../../../apps/web/src/generated/openapi.json", import.meta.url),
  new URL("../src/generated/openapi.json", import.meta.url)
)
