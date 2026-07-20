import createClient from "openapi-fetch"

import type { paths } from "./generated/api"
import type { TanStudioConfig } from "./config"
import {
  TanStudioGatewayError,
  type Bootstrap,
  type Brew,
  type BrewCreate,
  type CoffeePage,
  type Context,
  type Device,
  type Label,
  type LabelCreate,
  type Note,
  type NoteCreate,
  type Pantry,
  type ProblemDetails,
  type ProfilePage,
  type RoastDetail,
  type RoastPage,
  type SearchFilters,
  type TanStudioGateway,
} from "./gateway"

interface QueryFilters {
  q?: string
  profileId?: number
  coffeeId?: number
  roastId?: number
  status?: string
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export class OpenApiTanStudioGateway implements TanStudioGateway {
  private readonly client: ReturnType<typeof createClient<paths>>

  constructor(
    config: TanStudioConfig,
    fetchImplementation: FetchLike = globalThis.fetch
  ) {
    this.client = createClient<paths>({
      baseUrl: config.baseUrl,
      fetch: async (request) =>
        fetchImplementation(request, {
          signal: AbortSignal.timeout(config.timeoutMs),
        }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-Tan-Studio-Client": "tan-studio-api-v1",
      },
    })
  }

  async status(): Promise<{ bootstrap: Bootstrap; device: Device }> {
    const [bootstrap, device] = await Promise.all([
      this.bootstrap(),
      this.device(),
    ])
    return { bootstrap, device }
  }

  async bootstrap(): Promise<Bootstrap> {
    return unwrap(await this.client.GET("/api/v1/system/bootstrap"))
  }

  async device(): Promise<Device> {
    return unwrap(await this.client.GET("/api/v1/device"))
  }

  async synchronizeDevice(): Promise<Device> {
    return unwrap(
      await this.client.POST("/api/v1/device/synchronize", { body: {} })
    )
  }

  async pantry(): Promise<Pantry> {
    return unwrap(await this.client.GET("/api/v1/pantry"))
  }

  async searchProfiles(filters: SearchFilters): Promise<ProfilePage> {
    return unwrap(
      await this.client.GET("/api/v1/profiles", {
        params: { query: compactFilters(filters) },
      })
    )
  }

  async searchCoffees(filters: SearchFilters): Promise<CoffeePage> {
    return unwrap(
      await this.client.GET("/api/v1/coffees", {
        params: { query: compactFilters(filters) },
      })
    )
  }

  async searchRoasts(filters: SearchFilters): Promise<RoastPage> {
    return unwrap(
      await this.client.GET("/api/v1/roasts", {
        params: { query: compactFilters(filters) },
      })
    )
  }

  async context(
    resourceType: "profile" | "coffee" | "roast" | "brew",
    id: number
  ): Promise<Context | Brew> {
    switch (resourceType) {
      case "profile":
        return unwrap(
          await this.client.GET("/api/v1/profiles/{id}/context", {
            params: { path: { id } },
          })
        )
      case "coffee":
        return unwrap(
          await this.client.GET("/api/v1/coffees/{id}/context", {
            params: { path: { id } },
          })
        )
      case "roast":
        return unwrap(
          await this.client.GET("/api/v1/roasts/{id}/context", {
            params: { path: { id } },
          })
        )
      case "brew":
        return unwrap(
          await this.client.GET("/api/v1/brews/{id}", {
            params: { path: { id } },
          })
        )
    }
  }

  async roast(id: number, maxPoints?: number): Promise<RoastDetail> {
    const roast = unwrap(
      await this.client.GET("/api/v1/roasts/{id}", {
        params: { path: { id } },
      })
    )
    if (
      maxPoints === undefined ||
      roast.sampleStream === null ||
      roast.sampleStream === undefined
    ) {
      return { roast }
    }

    const series = unwrap(
      await this.client.GET("/api/v1/roasts/{id}/series", {
        params: {
          path: { id },
          query: {
            streamVersion: roast.sampleStream.streamVersion,
            maxPoints,
          },
        },
      })
    )
    return { roast, series }
  }

  async createBrew(input: BrewCreate): Promise<Brew> {
    return unwrap(await this.client.POST("/api/v1/brews", { body: input }))
  }

  async createNote(input: NoteCreate): Promise<Note> {
    return unwrap(await this.client.POST("/api/v1/notes", { body: input }))
  }

  async createLabel(input: LabelCreate): Promise<Label> {
    return unwrap(await this.client.POST("/api/v1/labels", { body: input }))
  }
}

function compactFilters(filters: SearchFilters): QueryFilters {
  return {
    ...(filters.q !== undefined && filters.q !== "" ? { q: filters.q } : {}),
    ...(filters.profileId !== undefined
      ? { profileId: filters.profileId }
      : {}),
    ...(filters.coffeeId !== undefined ? { coffeeId: filters.coffeeId } : {}),
    ...(filters.roastId !== undefined ? { roastId: filters.roastId } : {}),
    ...(filters.status !== undefined && filters.status !== ""
      ? { status: filters.status }
      : {}),
  }
}

function unwrap<T>(result: {
  data?: T
  error?: unknown
  response: Response
}): T {
  if (result.data !== undefined) return result.data
  const details = asProblem(result.error)
  throw new TanStudioGatewayError({
    code: details?.code ?? "tan_studio.request_failed",
    correlationId: details?.correlationId,
    fieldErrors: details?.fieldErrors,
    message:
      details?.detail ??
      details?.title ??
      `Tan Studio request failed (${result.response.status})`,
    retryable: details?.retryable ?? result.response.status >= 500,
    status: result.response.status,
  })
}

function asProblem(value: unknown): ProblemDetails | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const candidate = value as Partial<ProblemDetails>
  if (
    typeof candidate.detail !== "string" ||
    typeof candidate.status !== "number"
  ) {
    return undefined
  }
  return candidate as ProblemDetails
}
