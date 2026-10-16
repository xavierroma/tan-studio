// Invoked only by the Rust isolated integration test; never uses user config.
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { createHostedHandler, productionOptions } from "../src/http"
import { OpenApiTanStudioGateway } from "../src/api"
import { strict as assert } from "node:assert"

const socket = process.env.TAN_TEST_SOCKET!,
  baseUrl = process.env.TAN_TEST_API_URL!
if (!socket || !baseUrl?.startsWith("http://127.0.0.1:"))
  throw new Error("isolated fixture required")
const options = productionOptions(socket)
options.gateway = (p, signal, correlationId) =>
  new OpenApiTanStudioGateway(
    { baseUrl, token: p.token ?? "no-grant", timeoutMs: 5000 },
    fetch,
    { signal, correlationId, host: "studio.tan.coffee" }
  )
options.log = () => {}
const handle = createHostedHandler(options)
async function connect(token: string) {
  const c = new Client(
    { name: "hosted-fixture", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  )
  await c.connect(
    new StreamableHTTPClientTransport(
      new URL("https://studio.tan.coffee/mcp"),
      {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => {
          const r = new Request(input, init)
          r.headers.set("Host", "studio.tan.coffee")
          return handle(
            r,
            token === process.env.TAN_TEST_READ_TOKEN ? "read" : "write"
          )
        },
      }
    )
  )
  return c
}
const reader = await connect(process.env.TAN_TEST_READ_TOKEN!),
  writer = await connect(process.env.TAN_TEST_WRITE_TOKEN!)
try {
  assert.equal((await reader.listTools()).tools.length, 8)
  assert.equal((await writer.listTools()).tools.length, 16)
  const created = await writer.callTool({
    name: "tan_create_coffee",
    arguments: { name: "Isolated MCP integration", provider: "Fixture" },
  })
  assert.notEqual(created.isError, true)
  const coffee = (created.structuredContent as any).data
  assert.ok(coffee.id > 0)
  const context = await reader.callTool({
    name: "tan_get_context",
    arguments: { resourceType: "coffee", id: coffee.id },
  })
  assert.notEqual(context.isError, true)
  const note = await writer.callTool({
    name: "tan_add_note",
    arguments: {
      body: "fixture-only note",
      links: [{ resourceType: "coffee", resourceId: coffee.id }],
    },
  })
  assert.notEqual(note.isError, true)
  assert.match(
    (note.structuredContent as any).data.attributes.agent,
    /^mcp-agent:/
  )
  const update = await writer.callTool({
    name: "tan_update_coffee",
    arguments: {
      coffeeId: coffee.id,
      revision: coffee.revision,
      name: "Updated fixture",
    },
  })
  assert.notEqual(update.isError, true)
  const conflict = await writer.callTool({
    name: "tan_update_coffee",
    arguments: {
      coffeeId: coffee.id,
      revision: coffee.revision,
      name: "Stale fixture",
    },
  })
  assert.equal(conflict.isError, true)
  assert.match(JSON.stringify(conflict), /412/)
  const raw = await fetch(baseUrl + "/api/v1/coffees", {
    headers: {
      Host: "studio.tan.coffee",
      Authorization: `Bearer ${process.env.TAN_TEST_READ_TOKEN}`,
      "X-Tan-Studio-Client": "tan-studio-api-v1",
    },
  })
  assert.equal(raw.status, 401)
  console.info(
    "Hosted MCP → Unix auth → Rust REST: read/write, attribution, revision conflict, audience isolation passed"
  )
} finally {
  await reader.close()
  await writer.close()
}
