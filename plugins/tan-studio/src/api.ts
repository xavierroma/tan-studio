import createClient from "openapi-fetch"
import { basename, isAbsolute } from "node:path"

import type { paths } from "./generated/api"
import type { TanStudioConfig } from "./config"
import {
  TanStudioGatewayError,
  type Attachment,
  type AttachmentCreate,
  type AttachmentFileInput,
  type AttachmentPage,
  type Bootstrap,
  type BridgePage,
  type Brew,
  type BrewCreate,
  type CoffeePage,
  type Coffee,
  type CoffeeCreate,
  type CoffeePatch,
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

const DEVICE_SYNCHRONIZATION_TIMEOUT_MS = 60_000

export class OpenApiTanStudioGateway implements TanStudioGateway {
  private readonly client: ReturnType<typeof createClient<paths>>

  constructor(
    config: TanStudioConfig,
    fetchImplementation: FetchLike = globalThis.fetch
  ) {
    this.client = createClient<paths>({
      baseUrl: config.baseUrl,
      fetch: async (request) => {
        const path = new URL(request.url).pathname
        const timeoutMs =
          path === "/api/v1/device/synchronize"
            ? Math.max(config.timeoutMs, DEVICE_SYNCHRONIZATION_TIMEOUT_MS)
            : config.timeoutMs
        return fetchImplementation(request, {
          signal: AbortSignal.timeout(timeoutMs),
        })
      },
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-Tan-Studio-Client": "tan-studio-api-v1",
      },
    })
  }

  async status(): Promise<{
    bootstrap: Bootstrap
    device: Device
    bridges: BridgePage
  }> {
    const [bootstrap, device, bridges] = await Promise.all([
      this.bootstrap(),
      this.device(),
      this.bridges(),
    ])
    return { bootstrap, device, bridges }
  }

  async bootstrap(): Promise<Bootstrap> {
    return unwrap(await this.client.GET("/api/v1/system/bootstrap"))
  }

  async device(): Promise<Device> {
    return unwrap(await this.client.GET("/api/v1/device"))
  }

  async bridges(): Promise<BridgePage> {
    return unwrap(await this.client.GET("/api/v1/bridges"))
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

  async createCoffee(input: CoffeeCreate): Promise<Coffee> {
    return unwrap(await this.client.POST("/api/v1/coffees", { body: input }))
  }

  async updateCoffee(
    id: number,
    revision: number,
    input: CoffeePatch
  ): Promise<Coffee> {
    return unwrap(
      await this.client.PATCH("/api/v1/coffees/{id}", {
        params: {
          path: { id },
          header: { "If-Match": `"revision:${revision}"` },
        },
        body: input,
      })
    )
  }

  async createNote(input: NoteCreate): Promise<Note> {
    return unwrap(await this.client.POST("/api/v1/notes", { body: input }))
  }

  async createLabel(input: LabelCreate): Promise<Label> {
    return unwrap(await this.client.POST("/api/v1/labels", { body: input }))
  }

  async listAttachments(
    resourceType: string,
    resourceId: number
  ): Promise<AttachmentPage> {
    return unwrap(
      await this.client.GET("/api/v1/attachments", {
        params: { query: { resourceType, resourceId } },
      })
    )
  }

  async attachLocalFile(input: AttachmentFileInput): Promise<Attachment> {
    if (!isAbsolute(input.filePath)) {
      throw new Error("filePath must be absolute")
    }
    const file = Bun.file(input.filePath)
    if (!(await file.exists())) throw new Error("Attachment file not found")
    if (file.size < 1 || file.size > 512 * 1024 * 1024) {
      throw new Error("Attachment must be between 1 byte and 512 MiB")
    }
    const attachment = await this.createAttachment({
      title: input.title ?? basename(input.filePath),
      filename: basename(input.filePath),
      mediaType: input.mediaType ?? (file.type || "application/octet-stream"),
      sourceUrl: input.sourceUrl ?? null,
      description: input.description ?? "",
      capturedAt: input.capturedAt ?? null,
      links: input.links,
    })
    return this.putAttachmentContent(attachment, file)
  }

  async setProfileImage(
    resourceType: "profile" | "coffee" | "roast" | "brew",
    resourceId: number,
    attachmentId: number | null
  ): Promise<void> {
    unwrap(
      await this.client.PUT(
        "/api/v1/entity-profile-images/{resource_type}/{resource_id}",
        {
          params: {
            path: {
              resource_type: resourceType,
              resource_id: resourceId,
            },
          },
          body: { attachmentId },
        }
      )
    )
  }

  private async createAttachment(input: AttachmentCreate): Promise<Attachment> {
    return unwrap(
      await this.client.POST("/api/v1/attachments", { body: input })
    )
  }

  private async putAttachmentContent(
    attachment: Attachment,
    content: Blob
  ): Promise<Attachment> {
    return unwrap(
      await this.client.PUT("/api/v1/attachments/{id}/content", {
        params: {
          path: { id: attachment.id },
          header: { "If-Match": `"revision:${attachment.revision}"` },
        },
        headers: { "Content-Type": "application/octet-stream" },
        body: "",
        bodySerializer: () => content,
      })
    )
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
  if (result.response.status === 204) return undefined as T
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
