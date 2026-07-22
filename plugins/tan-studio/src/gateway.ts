import type { components } from "./generated/api"

export type Bootstrap = components["schemas"]["BootstrapResponse"]
export type Bridge = components["schemas"]["BridgeResource"]
export type BridgePage = components["schemas"]["BridgePage"]
export type Brew = components["schemas"]["BrewResource"]
export type BrewCreate = components["schemas"]["BrewCreate"]
export type Attachment = components["schemas"]["AttachmentResource"]
export type AttachmentCreate = components["schemas"]["AttachmentCreate"]
export type AttachmentPage = components["schemas"]["AttachmentPage"]
export type Coffee = components["schemas"]["CoffeeResource"]
export type CoffeeCreate = components["schemas"]["CoffeeCreate"]
export type CoffeePatch = components["schemas"]["CoffeePatch"]
export type CoffeePage = components["schemas"]["CoffeePage"]
export type Context = components["schemas"]["ContextResource"]
export type Device = components["schemas"]["DeviceSnapshot"]
export type Label = components["schemas"]["LabelResource"]
export type LabelCreate = components["schemas"]["LabelCreate"]
export type Note = components["schemas"]["NoteResource"]
export type NoteCreate = components["schemas"]["NoteCreate"]
export type Pantry = components["schemas"]["PantryResource"]
export type ProblemDetails = components["schemas"]["ProblemDetails"]
export type ProfilePage = components["schemas"]["ProfilePage"]
export type Roast = components["schemas"]["RoastResource"]
export type RoastPage = components["schemas"]["RoastPage"]
export type Series = components["schemas"]["SeriesResponse"]

export interface SearchFilters {
  q?: string | undefined
  profileId?: number | undefined
  coffeeId?: number | undefined
  roastId?: number | undefined
  status?: string | undefined
}

export interface RoastDetail {
  roast: Roast
  series?: Series
}

export interface AttachmentFileInput {
  filePath: string
  title?: string | undefined
  mediaType?: string | undefined
  sourceUrl?: string | undefined
  description?: string | undefined
  capturedAt?: string | undefined
  links: AttachmentCreate["links"]
}

/**
 * Controller-facing port. MCP depends on this interface, never on HTTP, USB,
 * SQLite, files, or the Rust service's implementation details.
 */
export interface TanStudioGateway {
  status(): Promise<{
    bootstrap: Bootstrap
    device: Device
    bridges: BridgePage
  }>
  device(): Promise<Device>
  synchronizeDevice(): Promise<Device>
  pantry(): Promise<Pantry>
  searchProfiles(filters: SearchFilters): Promise<ProfilePage>
  searchCoffees(filters: SearchFilters): Promise<CoffeePage>
  searchRoasts(filters: SearchFilters): Promise<RoastPage>
  context(
    resourceType: "profile" | "coffee" | "roast" | "brew",
    id: number
  ): Promise<Context | Brew>
  roast(id: number, maxPoints?: number): Promise<RoastDetail>
  createCoffee(input: CoffeeCreate): Promise<Coffee>
  updateCoffee(
    id: number,
    revision: number,
    input: CoffeePatch
  ): Promise<Coffee>
  createBrew(input: BrewCreate): Promise<Brew>
  createNote(input: NoteCreate): Promise<Note>
  createLabel(input: LabelCreate): Promise<Label>
  listAttachments(
    resourceType: string,
    resourceId: number
  ): Promise<AttachmentPage>
  attachLocalFile(input: AttachmentFileInput): Promise<Attachment>
}

export interface GatewayErrorDetails {
  code: string
  correlationId?: string | undefined
  fieldErrors?: ProblemDetails["fieldErrors"] | undefined
  message: string
  retryable: boolean
  status: number
}

export class TanStudioGatewayError extends Error {
  readonly code: string
  readonly correlationId: string | undefined
  readonly retryable: boolean
  readonly status: number
  readonly fieldErrors: ProblemDetails["fieldErrors"] | undefined

  constructor(details: GatewayErrorDetails) {
    super(details.message)
    this.name = "TanStudioGatewayError"
    this.code = details.code
    this.correlationId = details.correlationId
    this.retryable = details.retryable
    this.status = details.status
    this.fieldErrors = details.fieldErrors
  }
}
