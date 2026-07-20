import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { OpenApiTanStudioGateway } from "./api"
import { loadConfig } from "./config"
import { createTanStudioServer } from "./mcp"

async function main(): Promise<void> {
  const config = await loadConfig()
  const server = createTanStudioServer(new OpenApiTanStudioGateway(config))
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error"
  process.stderr.write(`Tan Studio MCP server failed: ${message}\n`)
  process.exitCode = 1
})
