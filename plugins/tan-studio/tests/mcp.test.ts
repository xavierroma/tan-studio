import { afterEach, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import type { BrewCreate, NoteCreate, TanStudioGateway } from "../src/gateway"
import { createTanStudioServer } from "../src/mcp"

const expectedTools = [
  "tan_add_note",
  "tan_create_label",
  "tan_get_context",
  "tan_get_roast",
  "tan_list_pantry",
  "tan_record_brew",
  "tan_search_coffees",
  "tan_search_profiles",
  "tan_search_roasts",
  "tan_status",
  "tan_sync_device",
]

const connections: Array<{
  client: Client
  server: ReturnType<typeof createTanStudioServer>
}> = []

afterEach(async () => {
  await Promise.all(
    connections.splice(0).map(async ({ client, server }) => {
      await client.close()
      await server.close()
    })
  )
})

describe("Tan Studio MCP contract", () => {
  test("exposes a curated tool set without raw HTTP, SQL, or serial access", async () => {
    const { client } = await connect(fakeApi())
    const result = await client.listTools()

    expect(result.tools.map((tool) => tool.name).sort()).toEqual(expectedTools)
    expect(
      result.tools.every((tool) => tool.annotations?.openWorldHint === false)
    ).toBe(true)
  })

  test("records human brew units as exact API integers", async () => {
    let received: BrewCreate | undefined
    const api = fakeApi({
      createBrew: async (input: BrewCreate) => {
        received = input
        return { id: 31, roastId: input.roastId } as never
      },
    })
    const { client } = await connect(api)

    const result = await client.callTool({
      name: "tan_record_brew",
      arguments: {
        roastId: 15,
        coffeeGrams: 16,
        waterGrams: 250,
        waterTemperatureCelsius: 96.25,
        ratingPercent: 87.5,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(received).toEqual({
      roastId: 15,
      coffeeMassMg: 16_000,
      waterMassMg: 250_000,
      waterTemperatureMilliC: 96_250,
      ratingBasisPoints: 8_750,
    })
  })

  test("records one agent-authored note with multiple typed links", async () => {
    let received: NoteCreate | undefined
    const api = fakeApi({
      createNote: async (input: NoteCreate) => {
        received = input
        return { id: 8 } as never
      },
    })
    const { client } = await connect(api)

    await client.callTool({
      name: "tan_add_note",
      arguments: {
        body: "Floral and bright; reduce the next roast level slightly.",
        kind: "tasting",
        ratingPercent: 91,
        links: [
          { resourceType: "roast", resourceId: 15 },
          { resourceType: "brew", resourceId: 31 },
        ],
      },
    })

    expect(received).toEqual({
      body: "Floral and bright; reduce the next roast level slightly.",
      kind: "tasting",
      ratingBasisPoints: 9_100,
      source: "agent:codex",
      links: [
        { resourceType: "roast", resourceId: 15 },
        { resourceType: "brew", resourceId: 31 },
      ],
    })
  })
})

async function connect(api: TanStudioGateway) {
  const server = createTanStudioServer(api)
  const client = new Client({ name: "tan-studio-test", version: "0.1.0" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  connections.push({ client, server })
  return { client, server }
}

function fakeApi(overrides: Partial<TanStudioGateway> = {}): TanStudioGateway {
  return {
    status: async () => ({ bootstrap: {}, device: {} }),
    pantry: async () => ({ items: [] }),
    searchProfiles: async () => ({ items: [] }),
    searchCoffees: async () => ({ items: [] }),
    searchRoasts: async () => ({ items: [] }),
    context: async () => ({}),
    roast: async () => ({ roast: {} }),
    createBrew: async (input: BrewCreate) => ({
      id: 1,
      roastId: input.roastId,
    }),
    createNote: async () => ({ id: 1 }),
    createLabel: async () => ({ id: 1, roastId: 1 }),
    device: async () => ({}),
    synchronizeDevice: async () => ({}),
    ...overrides,
  } as unknown as TanStudioGateway
}
