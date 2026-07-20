import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { TanStudioGateway } from "./gateway"
import { protect, success } from "./results"
import {
  celsiusToMilliCelsius,
  gramsToMilligrams,
  millimetersToMicrometers,
  percentToBasisPoints,
} from "./units"

const shortId = z
  .number()
  .int()
  .positive()
  .describe("Tan Studio's short numeric ID")
const optionalSearch = z.string().trim().min(1).max(200).optional()
const optionalFilterId = shortId.optional()
const resultLimit = z.number().int().min(1).max(200).default(50)
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

export function createTanStudioServer(api: TanStudioGateway): McpServer {
  const server = new McpServer({ name: "tan-studio", version: "0.1.0" })

  server.registerTool(
    "tan_status",
    {
      title: "Tan Studio status",
      description:
        "Check the Tan Studio service, enabled features, database recovery state, and connected Kaffeelogic device without changing anything.",
      annotations: readOnlyAnnotations,
    },
    async () =>
      protect(async () => success("Tan Studio status", await api.status()))
  )

  server.registerTool(
    "tan_list_pantry",
    {
      title: "List roasted coffee pantry",
      description:
        "List roasted coffees still available to brew, including estimated remaining mass, rest window, and latest tasting note.",
      annotations: readOnlyAnnotations,
    },
    async () =>
      protect(async () => success("Roasted coffee pantry", await api.pantry()))
  )

  server.registerTool(
    "tan_search_profiles",
    {
      title: "Search roasting profiles",
      description:
        "Find roasting profiles by text or related coffee or roast. Returns short numeric profile IDs for subsequent calls.",
      inputSchema: {
        query: optionalSearch.describe(
          "Profile name, designer, or descriptive text"
        ),
        coffeeId: optionalFilterId,
        roastId: optionalFilterId,
        limit: resultLimit,
      },
      annotations: readOnlyAnnotations,
    },
    async ({ query, coffeeId, roastId, limit }) =>
      protect(async () => {
        const page = await api.searchProfiles({ q: query, coffeeId, roastId })
        return success("Matching roasting profiles", boundedPage(page, limit))
      })
  )

  server.registerTool(
    "tan_search_coffees",
    {
      title: "Search green coffees",
      description:
        "Find catalogued green coffees by name, provider, origin, farm, region, process, or related profile or roast.",
      inputSchema: {
        query: optionalSearch.describe("Coffee, provider, or origin text"),
        profileId: optionalFilterId,
        roastId: optionalFilterId,
        limit: resultLimit,
      },
      annotations: readOnlyAnnotations,
    },
    async ({ query, profileId, roastId, limit }) =>
      protect(async () => {
        const page = await api.searchCoffees({ q: query, profileId, roastId })
        return success("Matching coffees", boundedPage(page, limit))
      })
  )

  server.registerTool(
    "tan_search_roasts",
    {
      title: "Search roasts",
      description:
        "Search roast history by text, profile, coffee, roast ID, or status. Results are lightweight and omit telemetry samples.",
      inputSchema: {
        query: optionalSearch.describe("Coffee, profile, result, or note text"),
        profileId: optionalFilterId,
        coffeeId: optionalFilterId,
        roastId: optionalFilterId,
        status: z.string().trim().min(1).max(50).optional(),
        limit: resultLimit,
      },
      annotations: readOnlyAnnotations,
    },
    async ({ query, profileId, coffeeId, roastId, status, limit }) =>
      protect(async () => {
        const page = await api.searchRoasts({
          q: query,
          profileId,
          coffeeId,
          roastId,
          status,
        })
        return success("Matching roasts", boundedPage(page, limit))
      })
  )

  server.registerTool(
    "tan_get_context",
    {
      title: "Get coffee context",
      description:
        "Get a profile, coffee, roast, or brew with its directly related roasts, brews, notes, and rest guidance when available.",
      inputSchema: {
        resourceType: z.enum(["profile", "coffee", "roast", "brew"]),
        id: shortId,
      },
      annotations: readOnlyAnnotations,
    },
    async ({ resourceType, id }) =>
      protect(async () =>
        success(
          `${resourceType} ${id} context`,
          await api.context(resourceType, id)
        )
      )
  )

  server.registerTool(
    "tan_get_roast",
    {
      title: "Get roast",
      description:
        "Get one roast with profile snapshot, adjustments, annotations, warnings, and optionally a bounded telemetry series for graph analysis.",
      inputSchema: {
        roastId: shortId,
        includeTelemetry: z.boolean().default(false),
        maxPoints: z.number().int().min(50).max(2_000).default(400),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ roastId, includeTelemetry, maxPoints }) =>
      protect(async () =>
        success(
          `Roast ${roastId}`,
          await api.roast(roastId, includeTelemetry ? maxPoints : undefined)
        )
      )
  )

  server.registerTool(
    "tan_record_brew",
    {
      title: "Record brew",
      description:
        "Persist a brew linked to a roast. Omitted grinder, kettle, water, method, ratio, and temperature fields use Tan Studio's backend defaults.",
      inputSchema: {
        roastId: shortId,
        brewedAt: z.iso.datetime({ offset: true }).optional(),
        coffeeGrams: z.number().positive().max(500).optional(),
        waterGrams: z.number().positive().max(10_000).optional(),
        waterTemperatureCelsius: z.number().min(0).max(110).optional(),
        method: z.string().trim().min(1).max(100).optional(),
        grinder: z.string().trim().min(1).max(200).optional(),
        grinderSetting: z.string().trim().min(1).max(100).optional(),
        kettle: z.string().trim().min(1).max(200).optional(),
        water: z.string().trim().min(1).max(200).optional(),
        note: z.string().trim().min(1).max(10_000).optional(),
        ratingPercent: z.number().min(0).max(100).optional(),
      },
      annotations: writeAnnotations,
    },
    async (input) =>
      protect(async () => {
        const brew = await api.createBrew({
          roastId: input.roastId,
          ...(input.brewedAt !== undefined ? { brewedAt: input.brewedAt } : {}),
          ...(input.coffeeGrams !== undefined
            ? { coffeeMassMg: gramsToMilligrams(input.coffeeGrams) }
            : {}),
          ...(input.waterGrams !== undefined
            ? { waterMassMg: gramsToMilligrams(input.waterGrams) }
            : {}),
          ...(input.waterTemperatureCelsius !== undefined
            ? {
                waterTemperatureMilliC: celsiusToMilliCelsius(
                  input.waterTemperatureCelsius
                ),
              }
            : {}),
          ...(input.method !== undefined ? { method: input.method } : {}),
          ...(input.grinder !== undefined ? { grinder: input.grinder } : {}),
          ...(input.grinderSetting !== undefined
            ? { grinderSetting: input.grinderSetting }
            : {}),
          ...(input.kettle !== undefined ? { kettle: input.kettle } : {}),
          ...(input.water !== undefined ? { water: input.water } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.ratingPercent !== undefined
            ? { ratingBasisPoints: percentToBasisPoints(input.ratingPercent) }
            : {}),
        })
        return success(
          `Recorded brew ${brew.id} for roast ${brew.roastId}`,
          brew
        )
      })
  )

  server.registerTool(
    "tan_add_note",
    {
      title: "Add note",
      description:
        "Persist one note and link it atomically to one or more profiles, coffees, roasts, or brews. Use for observations and tasting feedback.",
      inputSchema: {
        body: z.string().trim().min(1).max(10_000),
        kind: z.string().trim().min(1).max(100).default("observation"),
        ratingPercent: z.number().min(0).max(100).optional(),
        links: z
          .array(
            z.object({
              resourceType: z.enum(["profile", "coffee", "roast", "brew"]),
              resourceId: shortId,
            })
          )
          .min(1)
          .max(10),
      },
      annotations: writeAnnotations,
    },
    async ({ body, kind, ratingPercent, links }) =>
      protect(async () => {
        const note = await api.createNote({
          body,
          kind,
          links,
          source: "agent:codex",
          ...(ratingPercent !== undefined
            ? { ratingBasisPoints: percentToBasisPoints(ratingPercent) }
            : {}),
        })
        return success(`Recorded note ${note.id}`, note)
      })
  )

  server.registerTool(
    "tan_create_label",
    {
      title: "Create roast label",
      description:
        "Create a label artifact linked to a roast. This records a label request; it never claims physical printing unless the backend reports confirmation.",
      inputSchema: {
        roastId: shortId,
        copies: z.number().int().min(1).max(100).default(1),
        printer: z.string().trim().min(1).max(200).optional(),
        widthMillimeters: z.number().positive().max(1_000).optional(),
        heightMillimeters: z.number().positive().max(1_000).optional(),
      },
      annotations: writeAnnotations,
    },
    async ({ roastId, copies, printer, widthMillimeters, heightMillimeters }) =>
      protect(async () => {
        const label = await api.createLabel({
          roastId,
          copies,
          ...(printer !== undefined ? { printer } : {}),
          ...(widthMillimeters !== undefined
            ? { widthMicrometers: millimetersToMicrometers(widthMillimeters) }
            : {}),
          ...(heightMillimeters !== undefined
            ? { heightMicrometers: millimetersToMicrometers(heightMillimeters) }
            : {}),
        })
        return success(
          `Created label ${label.id} for roast ${label.roastId}`,
          label
        )
      })
  )

  server.registerTool(
    "tan_sync_device",
    {
      title: "Synchronize Kaffeelogic",
      description:
        "Import logs and profiles from the connected Kaffeelogic into Tan Studio. The current synchronization is read-only toward the roaster and sends no speculative write commands.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      protect(async () =>
        success(
          "Kaffeelogic synchronization result",
          await api.synchronizeDevice()
        )
      )
  )

  registerResources(server, api)
  return server
}

function registerResources(server: McpServer, api: TanStudioGateway): void {
  server.registerResource(
    "tan-pantry",
    "tan://pantry",
    {
      title: "Tan Studio pantry",
      description: "Roasted coffees, remaining mass, and rest windows",
      mimeType: "application/json",
    },
    async () => jsonResource("tan://pantry", await api.pantry())
  )

  server.registerResource(
    "tan-device",
    "tan://device",
    {
      title: "Kaffeelogic device",
      description: "Current device connection and synchronization state",
      mimeType: "application/json",
    },
    async () => jsonResource("tan://device", await api.device())
  )

  for (const resourceType of ["profile", "coffee", "roast", "brew"] as const) {
    server.registerResource(
      `tan-${resourceType}`,
      new ResourceTemplate(`tan://${resourceType}s/{id}`, { list: undefined }),
      {
        title: `Tan Studio ${resourceType}`,
        description: `A Tan Studio ${resourceType} and its available context`,
        mimeType: "application/json",
      },
      async (uri, variables) => {
        const rawId = variables.id
        const id = Number(Array.isArray(rawId) ? rawId[0] : rawId)
        if (!Number.isSafeInteger(id) || id < 1) {
          throw new Error(`Invalid ${resourceType} ID in ${uri.toString()}`)
        }
        return jsonResource(uri.toString(), await api.context(resourceType, id))
      }
    )
  }
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

function boundedPage<T>(page: { items: T[] }, limit: number) {
  return {
    items: page.items.slice(0, limit),
    returned: Math.min(page.items.length, limit),
    available: page.items.length,
    truncated: page.items.length > limit,
  }
}
