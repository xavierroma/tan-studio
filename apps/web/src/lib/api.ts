import type { components } from "@/generated/api"
import {
  companionClient,
  requireCompanion,
  unwrapResponse,
} from "@/lib/companion-client"

export type ProfileSummary = components["schemas"]["ProfileSummary"]
export type Profile = components["schemas"]["ProfileResource"]
export type ProfileCreate = components["schemas"]["ProfileCreate"]
export type Coffee = components["schemas"]["CoffeeResource"]
export type CoffeeCreate = components["schemas"]["CoffeeCreate"]
export type RoastSummary = components["schemas"]["RoastSummary"]
export type Roast = components["schemas"]["RoastResource"]
export type RoastCreate = components["schemas"]["RoastCreate"]
export type Brew = components["schemas"]["BrewResource"]
export type BrewCreate = components["schemas"]["BrewCreate"]
export type Note = components["schemas"]["NoteResource"]
export type NoteCreate = components["schemas"]["NoteCreate"]
export type Attachment = components["schemas"]["AttachmentResource"]
export type AttachmentCreate = components["schemas"]["AttachmentCreate"]
export type LabelRecord = components["schemas"]["LabelResource"]
export type LabelCreate = components["schemas"]["LabelCreate"]
export type Settings = components["schemas"]["SettingsResource"]
export type SettingsPatch = components["schemas"]["SettingsPatch"]
export type Pantry = components["schemas"]["PantryResource"]
export type Device = components["schemas"]["DeviceSnapshot"]
export type Bridge = components["schemas"]["BridgeResource"]
export type Series = components["schemas"]["SeriesResponse"]

function matchRevision(revision: number) {
  return { "If-Match": `"revision:${revision}"` }
}

export async function listProfiles(q?: string, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/profiles", {
      params: { query: { ...(q ? { q } : {}) } },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function getProfile(id: number, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/profiles/{id}", {
      params: { path: { id } },
      ...(signal ? { signal } : {}),
    })
  )
}

export async function createChildProfile(
  parentId: number,
  input: ProfileCreate
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/profiles/{id}/children", {
      params: { path: { id: parentId } },
      body: input,
    })
  )
}

export async function listCoffees(q?: string, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/coffees", {
      params: { query: { ...(q ? { q } : {}) } },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function createCoffee(input: CoffeeCreate) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/coffees", { body: input })
  )
}

export async function getCoffee(id: number, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/coffees/{id}", {
      params: { path: { id } },
      ...(signal ? { signal } : {}),
    })
  )
}

export async function updateCoffee(
  id: number,
  revision: number,
  body: components["schemas"]["CoffeePatch"]
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.PATCH("/api/v1/coffees/{id}", {
      params: { path: { id }, header: matchRevision(revision) },
      body,
    })
  )
}

export async function listRoasts(
  options: {
    q?: string | undefined
    status?: string | undefined
    profileId?: number | undefined
    coffeeId?: number | undefined
  } = {},
  signal?: AbortSignal
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/roasts", {
      params: {
        query: {
          ...(options.q ? { q: options.q } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.profileId ? { profileId: options.profileId } : {}),
          ...(options.coffeeId ? { coffeeId: options.coffeeId } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function createRoast(input: RoastCreate) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/roasts", { body: input })
  )
}

export async function getRoast(id: number, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/roasts/{id}", {
      params: { path: { id } },
      ...(signal ? { signal } : {}),
    })
  )
}

export async function updateRoast(
  id: number,
  revision: number,
  body: components["schemas"]["RoastPatch"]
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.PATCH("/api/v1/roasts/{id}", {
      params: { path: { id }, header: matchRevision(revision) },
      body,
    })
  )
}

export async function getRoastSeries(roast: Roast, signal?: AbortSignal) {
  if (!roast.sampleStream) return null
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/roasts/{id}/series", {
      params: {
        path: { id: roast.id },
        query: {
          streamVersion: roast.sampleStream.streamVersion,
          fromElapsedMs: roast.sampleStream.firstElapsedMs,
          toElapsedMs: roast.sampleStream.lastElapsedMs,
          maxPoints: 2_000,
        },
      },
      ...(signal ? { signal } : {}),
    })
  )
}

export async function getRoastContext(id: number, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/roasts/{id}/context", {
      params: { path: { id } },
      ...(signal ? { signal } : {}),
    })
  )
}

export async function getPantry(signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/pantry", signal ? { signal } : {})
  )
}

export async function listBrews(roastId?: number, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/brews", {
      params: { query: { ...(roastId ? { roastId } : {}) } },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function createBrew(input: BrewCreate) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/brews", { body: input })
  )
}

export async function createNote(input: NoteCreate) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/notes", { body: input })
  )
}

export async function listNotes(
  resourceType?: string,
  resourceId?: number,
  signal?: AbortSignal
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/notes", {
      params: {
        query: {
          ...(resourceType ? { resourceType } : {}),
          ...(resourceId ? { resourceId } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function updateNote(
  id: number,
  revision: number,
  body: components["schemas"]["NotePatch"]
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.PATCH("/api/v1/notes/{id}", {
      params: { path: { id }, header: matchRevision(revision) },
      body,
    })
  )
}

export async function listAttachments(
  resourceType?: string,
  resourceId?: number,
  signal?: AbortSignal
) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/attachments", {
      params: {
        query: {
          ...(resourceType ? { resourceType } : {}),
          ...(resourceId ? { resourceId } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function createAttachment(input: AttachmentCreate) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/attachments", { body: input })
  )
}

export async function putAttachmentContent(attachment: Attachment, file: File) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.PUT("/api/v1/attachments/{id}/content", {
      params: {
        path: { id: attachment.id },
        header: matchRevision(attachment.revision),
      },
      headers: { "Content-Type": "application/octet-stream" },
      body: "",
      bodySerializer: () => file,
    })
  )
}

export async function uploadAttachment(
  input: Omit<AttachmentCreate, "filename" | "mediaType">,
  file: File
) {
  const attachment = await createAttachment({
    ...input,
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
  })
  return putAttachmentContent(attachment, file)
}

export async function getAttachmentContent(attachment: Attachment) {
  requireCompanion()
  const result = await companionClient.GET("/api/v1/attachments/{id}/content", {
    params: { path: { id: attachment.id } },
    parseAs: "blob",
  })
  return unwrapResponse(result as Parameters<typeof unwrapResponse<Blob>>[0])
}

export async function listLabels(roastId?: number, signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/labels", {
      params: { query: { ...(roastId ? { roastId } : {}) } },
      ...(signal ? { signal } : {}),
    })
  ).items
}

export async function createLabel(input: LabelCreate) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/labels", { body: input })
  )
}

export async function getSettings(signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/settings", signal ? { signal } : {})
  )
}

export async function updateSettings(revision: number, body: SettingsPatch) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.PATCH("/api/v1/settings", {
      params: { header: matchRevision(revision) },
      body,
    })
  )
}

export async function getDevice(signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/device", signal ? { signal } : {})
  )
}

export async function refreshDevice() {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/device/refresh", { body: {} })
  )
}

export async function synchronizeDevice() {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/device/synchronize", { body: {} })
  )
}

export async function createBridgeClaim() {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/bridges/claims", {})
  )
}

export async function listBridges(signal?: AbortSignal) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.GET("/api/v1/bridges", signal ? { signal } : {})
  ).items
}

export const queryKeys = {
  profiles: (q?: string) => ["profiles", q ?? ""] as const,
  profile: (id: number) => ["profile", id] as const,
  coffees: (q?: string) => ["coffees", q ?? ""] as const,
  coffee: (id: number) => ["coffee", id] as const,
  roasts: (options: object = {}) => ["roasts", options] as const,
  roast: (id: number) => ["roast", id] as const,
  roastContext: (id: number) => ["roast-context", id] as const,
  series: (id: number, version?: number) => ["series", id, version] as const,
  pantry: () => ["pantry"] as const,
  brews: (roastId?: number) => ["brews", roastId ?? "all"] as const,
  notes: (resourceType?: string, resourceId?: number) =>
    ["notes", resourceType ?? "all", resourceId ?? "all"] as const,
  attachments: (resourceType?: string, resourceId?: number) =>
    ["attachments", resourceType ?? "all", resourceId ?? "all"] as const,
  labels: (roastId?: number) => ["labels", roastId ?? "all"] as const,
  settings: () => ["settings"] as const,
  device: () => ["device"] as const,
  bridges: () => ["bridges"] as const,
}
