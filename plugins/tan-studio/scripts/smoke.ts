import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
)
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "./dist/server.js"],
  cwd: process.cwd(),
  env: inheritedEnvironment,
  stderr: "inherit",
})
const client = new Client({ name: "tan-studio-smoke", version: "0.1.0" })

try {
  await client.connect(transport)
  const tools = await client.listTools()
  const status = await call("tan_status")
  const pantry = await call("tan_list_pantry")
  const roasts = await call("tan_search_roasts", {})
  const roastItems = asItems(roasts)
  const firstRoastId = numericId(roastItems[0])
  const roast =
    firstRoastId === undefined
      ? undefined
      : await call("tan_get_roast", {
          roastId: firstRoastId,
          includeTelemetry: true,
          maxPoints: 100,
        })

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        toolCount: tools.tools.length,
        deviceConnection: nestedString(status, "device", "connection"),
        bridgeCount: nestedItems(status, "bridges").length,
        bridgeState: objectString(nestedItems(status, "bridges")[0], "state"),
        pantryCount: asItems(pantry).length,
        roastCount: roastItems.length,
        sampledRoastId: firstRoastId ?? null,
        telemetryPoints: roast === undefined ? 0 : seriesPointCount(roast),
      },
      null,
      2
    )}\n`
  )
} finally {
  await client.close()
}

async function call(name: string, argumentsValue?: Record<string, unknown>) {
  const result = await client.callTool({
    name,
    ...(argumentsValue !== undefined ? { arguments: argumentsValue } : {}),
  })
  if (result.isError) {
    throw new Error(
      `MCP tool ${name} failed: ${JSON.stringify(result.content)}`
    )
  }
  const structured = result.structuredContent
  if (structured === undefined || typeof structured !== "object") {
    throw new Error(`MCP tool ${name} returned no structured content`)
  }
  return (structured as { data: unknown }).data
}

function asItems(value: unknown): unknown[] {
  if (value === null || typeof value !== "object") return []
  const items = (value as { items?: unknown }).items
  return Array.isArray(items) ? items : []
}

function numericId(value: unknown): number | undefined {
  if (value === null || typeof value !== "object") return undefined
  const id = (value as { id?: unknown }).id
  return typeof id === "number" ? id : undefined
}

function nestedString(value: unknown, parent: string, child: string) {
  if (value === null || typeof value !== "object") return null
  const nested = (value as Record<string, unknown>)[parent]
  return objectString(nested, child)
}

function objectString(value: unknown, key: string) {
  if (value === null || typeof value !== "object") return null
  const result = (value as Record<string, unknown>)[key]
  return typeof result === "string" ? result : null
}

function nestedItems(value: unknown, parent: string): unknown[] {
  if (value === null || typeof value !== "object") return []
  const nested = (value as Record<string, unknown>)[parent]
  return asItems(nested)
}

function seriesPointCount(value: unknown): number {
  if (value === null || typeof value !== "object") return 0
  const series = (value as { series?: unknown }).series
  if (series === null || typeof series !== "object") return 0
  const points = (series as { points?: unknown }).points
  return Array.isArray(points) ? points.length : 0
}
