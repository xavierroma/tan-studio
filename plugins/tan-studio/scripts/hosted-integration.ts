// Invoked only by the Rust isolated integration test; never uses user config.
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { createHostedHandler, productionOptions } from "../src/http"
import { OpenApiTanStudioGateway } from "../src/api"
import { strict as assert } from "node:assert"
import { z } from "zod"
import { apiOperations } from "../src/operations"

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
// The bundled fixed-port mode is used only inside the isolated Docker test.
const bundled = process.env.TAN_TEST_BUNDLED_MCP === "1"
if (bundled && baseUrl !== "http://127.0.0.1:8080")
  throw new Error("bundled fixture requires isolated port 8080")
const server = bundled
  ? undefined
  : Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => handle(request, "isolated-loopback-client"),
    })
const child = bundled
  ? Bun.spawn([process.execPath, "plugins/tan-studio/dist/http-server.js"], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TAN_STUDIO_MCP_ENABLED: "1",
        TAN_STUDIO_MCP_AUTH_SOCKET: socket,
      },
      stdout: "inherit",
      stderr: "inherit",
    })
  : undefined
const mcpOrigin = `http://127.0.0.1:${bundled ? 8082 : server!.port}`
async function connect(token: string) {
  const c = new Client(
    { name: "hosted-fixture", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  )
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const r = new Request(input, init)
        r.headers.set("Host", "studio.tan.coffee")
        return fetch(r)
      },
    })
  )
  return c
}
let reader: Client | undefined,
  writer: Client | undefined,
  parityWriter: Client | undefined
try {
  if (bundled) {
    let ready = false
    for (let n = 0; n < 50; n++) {
      try {
        ready = (await fetch(`${mcpOrigin}/readyz`)).ok
      } catch {}
      if (ready) break
      await Bun.sleep(100)
    }
    assert.equal(ready, true, "bundled listener becomes ready")
    assert.equal(
      (
        await fetch(`${mcpOrigin}/mcp`, {
          method: "POST",
          headers: { Host: "studio.tan.coffee" },
        })
      ).status,
      401
    )
  }
  reader = await connect(process.env.TAN_TEST_READ_TOKEN!)
  writer = await connect(process.env.TAN_TEST_WRITE_TOKEN!)
  assert.equal(
    (await reader.listTools()).tools.length,
    8 + apiOperations.filter((op) => op.method === "GET").length
  )
  assert.equal(
    (await writer.listTools()).tools.length,
    16 + apiOperations.length
  )
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

  // A separate test principal keeps this suite below the real admission limits.
  parityWriter = await connect(process.env.TAN_TEST_PARITY_TOKEN!)
  const record = z.object({
    data: z.object({ id: z.number(), revision: z.number() }).passthrough(),
  })
  const profileResult = await parityWriter.callTool({
    name: "tan_api_create_profile",
    arguments: { body: { name: "Fruit filter fixture", profile: {} } },
  })
  assert.notEqual(profileResult.isError, true)
  const profile = record.parse(profileResult.structuredContent).data
  const roastResult = await parityWriter.callTool({
    name: "tan_api_create_roast",
    arguments: {
      body: {
        profileId: profile.id,
        greenInputMassMg: 123000,
        levelThousandths: 800,
      },
    },
  })
  assert.notEqual(roastResult.isError, true)
  const roast = record.parse(roastResult.structuredContent).data
  const measuredResult = await parityWriter.callTool({
    name: "tan_api_update_roast",
    arguments: {
      path: { id: roast.id },
      headers: { "If-Match": `"revision:${roast.revision}"` },
      body: {
        durationMs: 442652,
        firstCrack: { elapsedMs: 338000 },
        roastedYieldMassMg: 107000,
      },
    },
  })
  assert.notEqual(measuredResult.isError, true)
  const measured = record.parse(measuredResult.structuredContent).data
  const linkedResult = await parityWriter.callTool({
    name: "tan_api_update_roast",
    arguments: {
      path: { id: roast.id },
      headers: { "If-Match": `"revision:${measured.revision}"` },
      body: { coffeeId: coffee.id },
    },
  })
  assert.notEqual(linkedResult.isError, true)
  const linked = record
    .extend({
      data: z
        .object({
          coffee: z.object({ id: z.number() }),
          durationMs: z.number(),
          greenInputMassMg: z.number(),
          roastedYieldMassMg: z.number(),
          developmentBasisPoints: z.number(),
        })
        .passthrough(),
    })
    .parse(linkedResult.structuredContent).data
  assert.equal(linked.coffee.id, coffee.id)
  assert.equal(linked.durationMs, 442652)
  assert.equal(linked.greenInputMassMg, 123000)
  assert.equal(linked.roastedYieldMassMg, 107000)
  assert.equal(linked.developmentBasisPoints, measured.developmentBasisPoints)
  const fetched = await reader.callTool({
    name: "tan_api_get_roast",
    arguments: { path: { id: roast.id } },
  })
  assert.notEqual(fetched.isError, true)
  assert.deepEqual(fetched.structuredContent, linkedResult.structuredContent)
  const admin = await parityWriter.callTool({
    name: "tan_api_create",
    arguments: { body: { label: "must remain operator-only" } },
  })
  assert.equal(admin.isError, true)
  assert.match(JSON.stringify(admin), /403/)
  const raw = await fetch(baseUrl + "/api/v1/coffees", {
    headers: {
      Host: "studio.tan.coffee",
      Authorization: `Bearer ${process.env.TAN_TEST_READ_TOKEN}`,
      "X-Tan-Studio-Client": "tan-studio-api-v1",
    },
  })
  assert.equal(raw.status, 401)
  console.info(
    "Hosted MCP → Unix auth → Rust REST: API parity, precise coffee assignment, operator permissions, attribution, revision conflict and audience isolation passed"
  )
} finally {
  await reader?.close()
  await writer?.close()
  await parityWriter?.close()
  await server?.stop(true)
  if (child) {
    child.kill()
    await child.exited
  }
}
