import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/client"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  createHostedHandler,
  HttpFailure,
  BODY_LIMIT,
  type Rpc,
  type Principal,
} from "../src/http"
import type { TanStudioGateway } from "../src/gateway"
import { apiOperations } from "../src/operations"

const readToken = "tsmcp_" + "a".repeat(64),
  writeToken = "tsmcp_" + "b".repeat(64)
function fixture() {
  const calls: Array<{ agent: number; method: string }> = [],
    logs: Record<string, unknown>[] = []
  let revoked = false
  const handle = createHostedHandler({
    async delegate(token, rpc) {
      if (revoked || ![readToken, writeToken].includes(token))
        throw new HttpFailure(401, "invalid_agent_credential")
      return {
        agentId: token === readToken ? 1 : 2,
        write: token === writeToken,
        token: "test-delegation",
      }
    },
    gateway(principal) {
      return new Proxy(
        {},
        {
          get(_target, method) {
            return async () => {
              calls.push({ agent: principal.agentId, method: String(method) })
              return method === "status"
                ? {
                    bootstrap: { agent: principal.agentId },
                    device: { connection: "disconnected" },
                    bridges: { items: [] },
                  }
                : method === "createCoffee"
                  ? { id: 7, revision: 1 }
                  : { items: [] }
            }
          },
        }
      ) as TanStudioGateway
    },
    ready: async () => true,
    log: (event) => logs.push(event),
  })
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("host", "studio.tan.coffee")
    return handle(request, "test-peer")
  }
  return {
    handle,
    fetcher,
    calls,
    logs,
    revoke: () => {
      revoked = true
    },
  }
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://studio.tan.coffee/mcp", {
    method: "POST",
    headers: {
      Host: "studio.tan.coffee",
      Authorization: `Bearer ${readToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}
function modern(method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  }
}
const modernHeaders = {
  "MCP-Protocol-Version": "2026-07-28",
  "Mcp-Method": "tools/list",
}

test("official modern and legacy clients list the same hosted tools and resources", async () => {
  for (const era of ["modern", "legacy"]) {
    const f = fixture()
    const client =
      era === "modern"
        ? new Client(
            { name: "modern", version: "1" },
            { versionNegotiation: { mode: { pin: "2026-07-28" } } }
          )
        : new LegacyClient({ name: "legacy", version: "1" })
    const opts = {
      requestInit: { headers: { Authorization: `Bearer ${writeToken}` } },
      fetch: f.fetcher,
    }
    const transport =
      era === "modern"
        ? new StreamableHTTPClientTransport(
            new URL("https://studio.tan.coffee/mcp"),
            opts
          )
        : new LegacyTransport(new URL("https://studio.tan.coffee/mcp"), opts)
    try {
      if (
        client instanceof LegacyClient &&
        transport instanceof LegacyTransport
      )
        // SDK v1 declares sessionId as optional in Transport but as a getter
        // returning undefined in this class. Runtime compatibility is tested here.
        await client.connect(
          transport as unknown as Parameters<LegacyClient["connect"]>[0]
        )
      else if (
        client instanceof Client &&
        transport instanceof StreamableHTTPClientTransport
      )
        await client.connect(transport)
      else throw new Error("client/transport era mismatch")
      const tools = await client.listTools()
      expect(tools.tools).toHaveLength(16 + apiOperations.length)
      expect(tools.tools.map((t) => t.name)).not.toContain("tan_attach_file")
      expect(tools.tools.map((t) => t.name)).not.toContain("tan_sync_device")
      expect((await client.listResources()).resources).toHaveLength(2)
      expect(
        (await client.listResourceTemplates()).resourceTemplates
      ).toHaveLength(4)
      const status = await client.callTool({
        name: "tan_status",
        arguments: {},
      })
      expect(status.isError).not.toBe(true)
      expect(f.calls).toEqual([{ agent: 2, method: "status" }])
    } finally {
      await client.close()
    }
  }
})
test("read catalog, hidden writes and invalid credentials are enforced before dispatch", async () => {
  const f = fixture()
  const r = await f.handle(request(modern("tools/list"), modernHeaders))
  expect(r.status).toBe(200)
  expect(((await r.json()) as any).result.tools).toHaveLength(
    8 + apiOperations.filter((op) => op.method === "GET").length
  )
  const write = await f.handle(
    request(
      modern("tools/call", {
        name: "tan_create_coffee",
        arguments: { name: "test" },
      }),
      {
        ...modernHeaders,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "tan_create_coffee",
      }
    )
  )
  expect(write.status).toBe(403)
  for (const name of ["tan_attach_file", "tan_sync_device"]) {
    expect(
      (
        await f.handle(
          request(
            modern("tools/call", {
              name,
              arguments: { filePath: "/etc/passwd" },
            }),
            { ...modernHeaders, "Mcp-Method": "tools/call", "Mcp-Name": name }
          )
        )
      ).status
    ).toBe(403)
  }
  expect(f.calls).toEqual([])
  f.revoke()
  const revoked = await f.handle(request(modern("tools/list"), modernHeaders))
  expect(revoked.status).toBe(401)
  expect(revoked.headers.get("www-authenticate")).toContain("Bearer")
  expect(JSON.stringify(f.logs)).not.toContain(readToken)
})
test("protocol validation rejects mismatched headers without invoking a gateway", async () => {
  const f = fixture()
  const bad = await f.handle(
    request(modern("tools/list"), {
      ...modernHeaders,
      "Mcp-Method": "tools/call",
    })
  )
  expect(bad.status).toBe(400)
  expect(f.calls).toEqual([])
  expect(((await bad.json()) as any).error.code).toBe(-32020)
  const unsupported = modern("tools/list")
  unsupported.params._meta["io.modelcontextprotocol/protocolVersion"] =
    "2099-01-01"
  expect(
    (
      await f.handle(
        request(unsupported, {
          ...modernHeaders,
          "MCP-Protocol-Version": "2099-01-01",
        })
      )
    ).status
  ).toBe(400)
})
test("malformed, oversized, origin and host requests fail closed", async () => {
  const f = fixture()
  for (const [body, headers, status] of [
    ["{", {}, 400],
    [[], {}, 400],
    ["x".repeat(BODY_LIMIT + 1), {}, 413],
    [{}, { Origin: "https://evil.example" }, 403],
    [{}, { Host: "evil.example" }, 403],
    [{}, { Authorization: "Bearer " + "a".repeat(64) }, 401],
  ] as const) {
    expect((await f.handle(request(body, headers))).status).toBe(status)
  }
  expect(f.calls).toEqual([])
})
test("parallel requests with equal RPC IDs keep separate principals", async () => {
  const f = fixture(),
    body = modern("tools/call", { name: "tan_status", arguments: {} }),
    headers = {
      ...modernHeaders,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "tan_status",
    }
  const responses = await Promise.all([
    f.handle(request(body, headers), "read-peer"),
    f.handle(
      request(body, { ...headers, Authorization: `Bearer ${writeToken}` }),
      "write-peer"
    ),
  ])
  for (const response of responses) expect(response.status).toBe(200)
  expect(f.calls.map((c) => c.agent).sort()).toEqual([1, 2])
})

test("authenticated admission limits excessive requests without extra dispatch", async () => {
  const f = fixture()
  for (let i = 0; i < 10; i++)
    expect(
      (await f.handle(request(modern("tools/list"), modernHeaders))).status
    ).toBe(200)
  const blocked = await f.handle(request(modern("tools/list"), modernHeaders))
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get("retry-after")).toBe("60")
  expect(f.calls).toHaveLength(0)
})
test("cancellation reaches the request-bound gateway and returns an uncertain outcome", async () => {
  let began!: () => void
  const started = new Promise<void>((resolve) => {
    began = resolve
  })
  let cancelled = false
  const handle = createHostedHandler({
    delegate: async () => ({ agentId: 1, write: true, token: "fixture" }),
    ready: async () => true,
    gateway: (_principal, signal) =>
      ({
        createCoffee: async () => {
          began()
          return new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                cancelled = true
                reject(new Error("cancelled"))
              },
              { once: true }
            )
          )
        },
      }) as unknown as TanStudioGateway,
  })
  const abort = new AbortController()
  const source = request(
    modern("tools/call", {
      name: "tan_create_coffee",
      arguments: { name: "Fixture" },
    }),
    {
      ...modernHeaders,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "tan_create_coffee",
      Authorization: `Bearer ${writeToken}`,
    }
  )
  const response = handle(new Request(source, { signal: abort.signal }))
  await started
  abort.abort()
  const result = await response
  expect(cancelled).toBe(true)
  expect(result.status).toBeGreaterThanOrEqual(500)
  expect(await result.text()).toContain("outcome_unknown")
})
test("oversized successful writes return a receipt; oversized reads do not claim a mutation", async () => {
  const { hostedSuccess } = await import("../src/results")
  const data = { id: 4, revision: 3, metadata: "x".repeat(1024 * 1024) }
  const write = hostedSuccess("Created", data, true)
  expect(write.isError).not.toBe(true)
  expect((write.structuredContent as { data: unknown })?.data).toMatchObject({
    committed: true,
    id: 4,
    revision: 3,
    resultTruncated: true,
  })
  expect(JSON.stringify(write).length).toBeLessThan(1000)
  expect(hostedSuccess("Read", data).isError).toBe(true)
})
