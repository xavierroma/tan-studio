import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { z } from "zod"
import contract from "../../../apps/web/src/generated/openapi.json"
import { OpenApiTanStudioGateway } from "../src/api"
import { createTanStudioServer } from "../src/mcp"
import {
  apiOperations,
  apiOperationsByName,
  apiToolName,
  operationInput,
  revisionTag,
} from "../src/operations"

const config = {
  baseUrl: "http://127.0.0.1:12345",
  token: "test-only-token",
  timeoutMs: 1_000,
}

test("every OpenAPI operation has a unique MCP tool and convertible full schema", () => {
  const operations = Object.values(contract.paths).flatMap((path) =>
    Object.entries(path)
      .filter(([method]) =>
        ["get", "post", "patch", "put", "delete"].includes(method)
      )
      .map(([, spec]) => spec.operationId)
  )
  expect(apiOperations.map((op) => op.operationId).sort()).toEqual(
    operations.sort()
  )
  expect(new Set(apiOperations.map((op) => op.name)).size).toBe(
    operations.length
  )
  for (const op of apiOperations) {
    expect(op.name).toBe(apiToolName(op.operationId))
    const schema = z.toJSONSchema(z.strictObject(op.inputSchema))
    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(false)
  }
})

test("roast patch exposes every REST field, including assignment, input and null clearing", () => {
  const op = apiOperationsByName.get("tan_api_update_roast")!
  const shape = z.toJSONSchema(z.strictObject(op.inputSchema))
  const bodySchema = shape.properties?.body
  if (!bodySchema || typeof bodySchema === "boolean")
    throw new Error("Missing object body schema")
  expect(Object.keys(bodySchema.properties ?? {}).sort()).toEqual(
    Object.keys(contract.components.schemas.RoastPatch.properties).sort()
  )
  expect(
    operationInput(op, {
      path: { id: 29 },
      headers: { "If-Match": '"revision:2"' },
      body: {
        coffeeId: null,
        greenInputMassMg: 123_000,
        sourceTimezone: "America/Los_Angeles",
      },
    }).body
  ).toEqual({
    coffeeId: null,
    greenInputMassMg: 123_000,
    sourceTimezone: "America/Los_Angeles",
  })
})

test("assignment-only MCP request sends only coffeeId and preserves revision protection", async () => {
  let captured: Request | undefined
  const api = new OpenApiTanStudioGateway(config, async (request) => {
    captured = new Request(request)
    return Response.json({
      id: 29,
      coffee: { id: 4 },
      developmentBasisPoints: 2364,
      durationMs: 442652,
    })
  })
  await withClient(api, async (client) => {
    const result = await client.callTool({
      name: "tan_api_update_roast",
      arguments: {
        path: { id: 29 },
        headers: { "If-Match": '"revision:2"' },
        body: { coffeeId: 4 },
      },
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      data: { developmentBasisPoints: 2364, durationMs: 442652 },
    })
  })
  expect(captured?.url).toBe(`${config.baseUrl}/api/v1/roasts/29`)
  expect(captured?.method).toBe("PATCH")
  expect(captured?.headers.get("If-Match")).toBe('"revision:2"')
  expect(await captured?.json()).toEqual({ coffeeId: 4 })
})

test("convenience assignment supports clearing without resending measurements", async () => {
  const bodies: unknown[] = []
  const api = new OpenApiTanStudioGateway(config, async (request) => {
    bodies.push(await new Request(request).json())
    return Response.json({ id: 29, revision: 3 })
  })
  await withClient(api, async (client) => {
    for (const coffeeId of [4, null]) {
      const result = await client.callTool({
        name: "tan_update_roast",
        arguments: { roastId: 29, revision: 2, coffeeId },
      })
      expect(result.isError).not.toBe(true)
    }
  })
  expect(bodies).toEqual([{ coffeeId: 4 }, { coffeeId: null }])
})

test("unknown fields, arbitrary URLs, injected headers and missing revision fail before HTTP", async () => {
  let calls = 0
  const api = new OpenApiTanStudioGateway(config, async () => {
    calls++
    return Response.json({})
  })
  await withClient(api, async (client) => {
    const valid = {
      path: { id: 29 },
      headers: { "If-Match": '"revision:2"' },
      body: { coffeeId: 4 },
    }
    for (const args of [
      { ...valid, url: "https://attacker.invalid" },
      { ...valid, headers: { ...valid.headers, Authorization: "evil" } },
      { ...valid, body: { coffeeID: 4 } },
      { ...valid, headers: {} },
      { ...valid, path: { id: "../api-tokens" } },
    ]) {
      const result = await client.callTool({
        name: "tan_api_update_roast",
        arguments: args,
      })
      expect(result.isError).toBe(true)
    }
  })
  expect(calls).toBe(0)
})

test("all declared query filters and false reach the API unchanged", async () => {
  let captured: Request | undefined
  const api = new OpenApiTanStudioGateway(config, async (request) => {
    captured = new Request(request)
    return Response.json({ items: [], nextCursor: null })
  })
  const op = apiOperationsByName.get("tan_api_list_roasts")!
  await api.executeOperation(op, {
    query: {
      coffeeId: 4,
      archived: false,
      q: "Castillo",
      resourceType: "roast",
      resourceId: 29,
    },
  })
  const url = new URL(captured!.url)
  expect(url.searchParams.get("archived")).toBe("false")
  expect(url.searchParams.get("q")).toBe("Castillo")
  expect(url.searchParams.get("resourceId")).toBe("29")
})

test("attachment binary content round trips exact bytes with its declared revision", async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 128])
  const requests: Request[] = []
  const api = new OpenApiTanStudioGateway(config, async (request) => {
    const req = new Request(request)
    requests.push(req)
    return req.method === "PUT"
      ? Response.json({ id: 48, revision: 3 })
      : new Response(bytes, { headers: { "Content-Type": "image/jpeg" } })
  })
  await api.executeOperation(
    apiOperationsByName.get("tan_api_put_attachment_content")!,
    {
      path: { id: 48 },
      headers: { "If-Match": '"revision:2"' },
      contentBase64: bytes.toString("base64"),
    }
  )
  expect(Buffer.from(await requests[0]!.arrayBuffer())).toEqual(bytes)
  expect(requests[0]!.headers.get("content-type")).toBe(
    "application/octet-stream"
  )
  expect(
    await api.executeOperation(
      apiOperationsByName.get("tan_api_get_attachment_content")!,
      { path: { id: 48 } }
    )
  ).toEqual({
    contentBase64: bytes.toString("base64"),
    mediaType: "image/jpeg",
  })
})

test("If-Match accepts the record's numeric revision and sends the strong tag", () => {
  expect(revisionTag(2)).toBe('"revision:2"')
  for (const value of ["2", '"2"', "revision:2", '"revision:2"', " 2 "])
    expect(revisionTag(value)).toBe('"revision:2"')
  // Anything that is not one revision number is left for the service to reject.
  for (const value of ['W/"revision:2"', "0", "latest", "2,3", '"revision:-1"'])
    expect(revisionTag(value)).toBe(value)
})

test("hosted PDF upload sends the revision the create call returned", async () => {
  const pdf = Buffer.from("%PDF-1.4\n%fictional\n%%EOF\n")
  const requests: Request[] = []
  const api = new OpenApiTanStudioGateway(config, async (request) => {
    const req = new Request(request)
    requests.push(req)
    return Response.json({ id: 48, revision: 2, byteLength: pdf.length })
  })
  await withClient(
    api,
    async (client) => {
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === "tan_api_put_attachment_content"
      )
      expect(JSON.stringify(tool?.inputSchema)).toContain('\\"revision:N\\"')
      const result = await client.callTool({
        name: "tan_api_put_attachment_content",
        arguments: {
          path: { id: 48 },
          headers: { "If-Match": 1 },
          contentBase64: pdf.toString("base64"),
        },
      })
      expect(result.isError).toBeFalsy()
    },
    { hosted: true, write: true }
  )
  expect(requests[0]!.headers.get("If-Match")).toBe('"revision:1"')
  expect(Buffer.from(await requests[0]!.arrayBuffer())).toEqual(pdf)
})

test("a stale revision tool error carries the current revision and no blind retry", async () => {
  const api = new OpenApiTanStudioGateway(config, async () =>
    Response.json(
      {
        type: "https://tan.studio/problems/revision-precondition-failed",
        title: "Revision precondition failed",
        status: 412,
        detail:
          'The attachment 48 is at revision 2, not 1. Fetch it again, confirm the change still applies, then retry with If-Match: "revision:2".',
        instance: "/api/v1/attachments/48/content",
        code: "revision_precondition_failed",
        correlationId: "test-correlation",
        retryable: false,
        currentRevision: 2,
      },
      { status: 412 }
    )
  )
  await withClient(
    api,
    async (client) => {
      const result = (await client.callTool({
        name: "tan_api_put_attachment_content",
        arguments: {
          path: { id: 48 },
          headers: { "If-Match": 1 },
          contentBase64: Buffer.from("%PDF").toString("base64"),
        },
      })) as { isError?: boolean; content: Array<{ text: string }> }
      expect(result.isError).toBe(true)
      const error = JSON.parse(result.content[0]!.text)
      expect(error).toMatchObject({
        error: "revision_precondition_failed",
        status: 412,
        retryable: false,
        currentRevision: 2,
      })
      expect(error.recovery).toContain("Fetch the record again")
      expect(error.recovery).toContain('"revision:2"')
    },
    { hosted: true, write: true }
  )
})

test("DELETE retains revision and returns an explicit empty success", async () => {
  let captured: Request | undefined
  const api = new OpenApiTanStudioGateway(config, async (request) => {
    captured = new Request(request)
    return new Response(null, { status: 204 })
  })
  expect(
    await api.executeOperation(
      apiOperationsByName.get("tan_api_delete_note")!,
      {
        path: { id: 30 },
        headers: { "If-Match": '"revision:1"' },
      }
    )
  ).toBeNull()
  expect(captured?.method).toBe("DELETE")
  expect(captured?.headers.get("If-Match")).toBe('"revision:1"')
})

test("read-only hosted catalog exposes all GET operations but no mutations", async () => {
  const api = new OpenApiTanStudioGateway(config)
  await withClient(
    api,
    async (client) => {
      const listed = (await client.listTools()).tools.map((tool) => tool.name)
      for (const op of apiOperations)
        expect(listed.includes(op.name)).toBe(op.method === "GET")
      await expect(
        client.callTool({ name: "tan_api_update_roast", arguments: {} })
      ).rejects.toThrow("not found")
    },
    { hosted: true, write: false }
  )
})

async function withClient(
  api: OpenApiTanStudioGateway,
  run: (client: Client) => Promise<void>,
  options = {}
) {
  const server = createTanStudioServer(api, options)
  const client = new Client({ name: "api-parity-test", version: "1" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])
    await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}
