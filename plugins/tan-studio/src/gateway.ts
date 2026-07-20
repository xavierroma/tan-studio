import type { components } from "./generated/api"

export type Bootstrap = components["schemas"]["BootstrapResponse"]
export type Brew = components["schemas"]["BrewResource"]
export type BrewCreate = components["schemas"]["BrewCreate"]
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

/**
 * Controller-facing port. MCP depends on this interface, never on HTTP, USB,
 * SQLite, files, or the Rust service's implementation details.
 */
export interface TanStudioGateway {
  status(): Promise<{ bootstrap: Bootstrap; device: Device }>
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
  createBrew(input: BrewCreate): Promise<Brew>
  createNote(input: NoteCreate): Promise<Note>
  createLabel(input: LabelCreate): Promise<Label>
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
