import {
  coffeeLots,
  deviceState as demoDeviceState,
  getRoastDetail,
  roastSummaries,
} from "@/data/demo"
import type {
  AdapterState,
  ChartPoint,
  CoffeeLot,
  DeviceState,
  RoastDetail,
  RoastStatus,
  RoastSummary,
  Brew,
  UserPreferences,
  LabelRecord,
  CoffeeIdentity,
  RoastProfile,
} from "@/types"
import {
  companionClient,
  requireCompanion,
  unwrapResponse,
} from "@/lib/companion-client"

export type DataSource = "companion" | "demo"

export type CompanionResult<T> = {
  data: T
  source: DataSource
}

export type RoastLibraryOptions = {
  q?: string | undefined
  group?: "lot" | "coffee" | "provider" | "none" | undefined
  sort?: "newest" | "score" | "coffee" | undefined
  date?: "90-days" | "year" | "all" | undefined
  provider?: string | undefined
  process?: string | undefined
  minScore?: 80 | 85 | undefined
  status?: "tasted" | "needs-tasting" | "ready" | "interrupted" | undefined
}

type AdapterCapability = {
  state: AdapterState
  reason: string | null
  connection?: DeviceState["connection"]
  model?: string
  firmware?: string
  protocol?: string
  packetLimitBytes?: number
  busy?: boolean | null
  profileCount?: number
  logCount?: number
  syncState?: DeviceState["syncState"]
  importedLogCount?: number
  updatedLogCount?: number
  importWarningCount?: number
  quarantinedLogCount?: number
  importedProfileCount?: number
  profileWarningCount?: number
  quarantinedProfileCount?: number
  lastSyncedAt?: string | null
  readOnly?: boolean
}

export type SystemCapabilities = {
  features: {
    deviceConnection: boolean
    printing: boolean
  }
  adapters: {
    usb: AdapterCapability
    printing: AdapterCapability
  }
}

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: "printing" | "usb",
    readonly reason: string
  ) {
    super(`${capability} capability is unavailable (${reason})`)
    this.name = "CapabilityUnavailableError"
  }
}

export function allowsDemoData(dev: boolean, configuredValue?: string) {
  return dev && configuredValue === "true"
}

export const demoDataEnabled = allowsDemoData(
  import.meta.env.DEV,
  import.meta.env.VITE_ENABLE_DEMO_DATA
)

export function isDemoResult<T>(
  result: CompanionResult<T> | undefined
): result is CompanionResult<T> & { source: "demo" } {
  return demoDataEnabled && result?.source === "demo"
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function adapterState(value: unknown): AdapterState {
  return value === "ready" ||
    value === "degraded" ||
    value === "failed" ||
    value === "unavailable"
    ? value
    : "unavailable"
}

function connectionState(
  value: unknown
): DeviceState["connection"] | undefined {
  return value === "connected" ||
    value === "disconnected" ||
    value === "reconnecting"
    ? value
    : undefined
}

function normalizeAdapter(value: unknown): AdapterCapability {
  const candidate = record(value)
  const connection = connectionState(candidate.connection)
  return {
    state: adapterState(candidate.state),
    reason: optionalText(candidate.reason) ?? null,
    ...(connection ? { connection } : {}),
    ...(optionalText(candidate.model) ? { model: text(candidate.model) } : {}),
    ...(optionalText(candidate.firmware)
      ? { firmware: text(candidate.firmware) }
      : {}),
    ...(optionalText(candidate.protocol)
      ? { protocol: text(candidate.protocol) }
      : {}),
    ...(optionalNumber(candidate.packetLimitBytes) === undefined
      ? {}
      : { packetLimitBytes: number(candidate.packetLimitBytes) }),
    ...(typeof candidate.busy === "boolean" || candidate.busy === null
      ? { busy: candidate.busy as boolean | null }
      : {}),
    ...(optionalNumber(candidate.profileCount) === undefined
      ? {}
      : { profileCount: number(candidate.profileCount) }),
    ...(optionalNumber(candidate.logCount) === undefined
      ? {}
      : { logCount: number(candidate.logCount) }),
    ...(candidate.syncState === "idle" ||
    candidate.syncState === "syncing" ||
    candidate.syncState === "ready" ||
    candidate.syncState === "failed"
      ? { syncState: candidate.syncState }
      : {}),
    ...(optionalNumber(candidate.importedLogCount) === undefined
      ? {}
      : { importedLogCount: number(candidate.importedLogCount) }),
    ...(optionalNumber(candidate.updatedLogCount) === undefined
      ? {}
      : { updatedLogCount: number(candidate.updatedLogCount) }),
    ...(optionalNumber(candidate.importWarningCount) === undefined
      ? {}
      : { importWarningCount: number(candidate.importWarningCount) }),
    ...(optionalNumber(candidate.quarantinedLogCount) === undefined
      ? {}
      : { quarantinedLogCount: number(candidate.quarantinedLogCount) }),
    ...(optionalNumber(candidate.importedProfileCount) === undefined
      ? {}
      : { importedProfileCount: number(candidate.importedProfileCount) }),
    ...(optionalNumber(candidate.profileWarningCount) === undefined
      ? {}
      : { profileWarningCount: number(candidate.profileWarningCount) }),
    ...(optionalNumber(candidate.quarantinedProfileCount) === undefined
      ? {}
      : { quarantinedProfileCount: number(candidate.quarantinedProfileCount) }),
    ...(candidate.lastSyncedAt === null
      ? { lastSyncedAt: null }
      : optionalText(candidate.lastSyncedAt)
        ? { lastSyncedAt: text(candidate.lastSyncedAt) }
        : {}),
    ...(typeof candidate.readOnly === "boolean"
      ? { readOnly: candidate.readOnly }
      : {}),
  }
}

function normalizeCapabilities(value: unknown): SystemCapabilities {
  const root = record(value)
  const features = record(root.features)
  const adapters = record(root.adapters)
  return {
    features: {
      deviceConnection: features.deviceConnection === true,
      printing: features.printing === true,
    },
    adapters: {
      usb: normalizeAdapter(adapters.usb),
      printing: normalizeAdapter(adapters.printing),
    },
  }
}

const demoCapabilities: SystemCapabilities = {
  features: { deviceConnection: true, printing: true },
  adapters: {
    usb: { state: "ready", reason: null, connection: "connected" },
    printing: { state: "ready", reason: null },
  },
}

function mapLibraryRow(row: Record<string, unknown>): RoastSummary {
  const scoreBasisPoints =
    typeof row.tastingScoreBasisPoints === "number"
      ? row.tastingScoreBasisPoints
      : null
  const statusText = text(row.status, "imported")
  const status: RoastStatus =
    statusText === "interrupted"
      ? "interrupted"
      : text(row.readyPlanStatus) === "ready"
        ? "ready"
        : scoreBasisPoints == null
          ? "needs-tasting"
          : "tasted"
  const resultText = text(row.result)

  return {
    id: text(row.roastId || row.id),
    number: number(row.roastNumber),
    nativeLogNumber: optionalNumber(row.nativeLogNumber) ?? null,
    roastedAt: optionalText(row.roastedAt) ?? null,
    coffeeName: text(row.coffeeName, "Uncataloged coffee"),
    providerName: text(row.providerName, "Unknown provider"),
    country: text(row.countryCode, "—"),
    region: text(row.region, "—"),
    farm: text(row.farmProducer, "—"),
    process: text(row.process, "—"),
    lotCode: text(row.lotCode, "Unassigned"),
    profileName: text(row.profileName, "Imported profile"),
    profileRevision: number(row.profileRevisionNumber, 1),
    level: number(row.roastLevelThousandths) / 1_000,
    loadGrams: number(row.greenInputMassMg) / 1_000,
    score: scoreBasisPoints == null ? null : scoreBasisPoints / 100,
    tastingNotes: text(row.tastingNotes),
    descriptors: Array.isArray(row.tastingDescriptors)
      ? row.tastingDescriptors.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    status,
    result:
      resultText === "stopped" || resultText === "imported"
        ? resultText
        : "completed",
    developmentPercent: number(row.developmentBasisPoints) / 100,
    lossPercent:
      optionalNumber(row.roastLossBasisPoints) === undefined
        ? null
        : number(row.roastLossBasisPoints) / 100,
    durationSeconds: number(row.durationMs) / 1_000,
  }
}

export async function listRoasts(
  options: RoastLibraryOptions = {},
  signal?: AbortSignal
): Promise<CompanionResult<RoastSummary[]>> {
  try {
    requireCompanion()
    const clauses: Array<Record<string, unknown>> = []
    if (options.q?.trim()) {
      clauses.push({ op: "search", query: options.q.trim() })
    }
    if (options.provider?.trim()) {
      clauses.push({
        op: "field",
        field: "providerName",
        operator: "contains",
        value: options.provider.trim(),
      })
    }
    if (options.process) {
      clauses.push({
        op: "field",
        field: "process",
        operator: "contains",
        value: options.process,
      })
    }
    if (options.status === "interrupted") {
      clauses.push({
        op: "field",
        field: "status",
        operator: "eq",
        value: "interrupted",
      })
    } else if (options.status === "ready") {
      clauses.push({
        op: "field",
        field: "readyPlanStatus",
        operator: "eq",
        value: "ready",
      })
    } else if (
      options.status === "tasted" ||
      options.status === "needs-tasting"
    ) {
      clauses.push({
        op: "field",
        field: "needsTasting",
        operator: "eq",
        value: options.status === "needs-tasting",
      })
    }
    if (options.minScore) {
      clauses.push({
        op: "field",
        field: "tastingScoreBasisPoints",
        operator: "gte",
        value: options.minScore * 100,
      })
    }
    if (options.date && options.date !== "all") {
      const cutoff = new Date()
      if (options.date === "90-days") {
        cutoff.setUTCDate(cutoff.getUTCDate() - 90)
      } else {
        cutoff.setUTCMonth(0, 1)
        cutoff.setUTCHours(0, 0, 0, 0)
      }
      clauses.push({
        op: "field",
        field: "roastedAt",
        operator: "gte",
        value: cutoff.toISOString(),
      })
    }

    const primarySort =
      options.sort === "score"
        ? { field: "tastingScoreBasisPoints", direction: "desc", nulls: "last" }
        : options.sort === "coffee"
          ? { field: "coffeeName", direction: "asc", nulls: "last" }
          : { field: "roastNumber", direction: "desc", nulls: "last" }
    const groupSort =
      options.group === "lot"
        ? { field: "lotCode", direction: "asc", nulls: "last" }
        : options.group === "coffee"
          ? { field: "coffeeName", direction: "asc", nulls: "last" }
          : options.group === "provider"
            ? { field: "providerName", direction: "asc", nulls: "last" }
            : null
    const numberSort = {
      field: "roastNumber",
      direction: "desc",
      nulls: "last",
    }
    const groupedSorts = groupSort
      ? groupSort.field === primarySort.field
        ? [primarySort]
        : [groupSort, primarySort]
      : [primarySort]
    const sorts = groupedSorts.some((sort) => sort.field === numberSort.field)
      ? groupedSorts
      : [...groupedSorts, numberSort]

    const response = unwrapResponse(
      await companionClient.POST("/api/v1/roast-library/query", {
        ...(signal ? { signal } : {}),
        body: {
          viewVersion: 1,
          filters: { op: "and", clauses },
          groups: [],
          sorts,
          columns: [
            "roastId",
            "roastNumber",
            "nativeLogNumber",
            "roastedAt",
            "roastedAtSource",
            "durationMs",
            "coffeeName",
            "providerName",
            "countryCode",
            "region",
            "farmProducer",
            "process",
            "lotCode",
            "profileName",
            "profileRevisionNumber",
            "roastLevelThousandths",
            "greenInputMassMg",
            "roastLossBasisPoints",
            "developmentBasisPoints",
            "tastingScoreBasisPoints",
            "tastingDescriptors",
            "tastingNotes",
            "result",
            "status",
            "readyPlanStatus",
          ],
          aggregates: [],
          page: { first: 100 },
        },
      })
    )
    const rows = response.kind === "rows" ? response.rows : []
    return {
      data: rows.map((row) => {
        const values = row.values
        return mapLibraryRow(
          values && typeof values === "object" && !Array.isArray(values)
            ? { roastId: row.roastId, ...(values as Record<string, unknown>) }
            : row
        )
      }),
      source: "companion",
    }
  } catch (error) {
    if (demoDataEnabled) return { data: roastSummaries, source: "demo" }
    throw error
  }
}

function titleFromKind(value: unknown): string {
  const source = text(value, "Event").replaceAll("_", " ")
  return source.charAt(0).toUpperCase() + source.slice(1)
}

async function loadSeries(
  roastId: string,
  sampleStream: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ChartPoint[]> {
  const streamVersion = optionalNumber(sampleStream.streamVersion)
  if (streamVersion === undefined) return []
  const firstElapsedMs = optionalNumber(sampleStream.firstElapsedMs) ?? 0
  const lastElapsedMs = optionalNumber(sampleStream.lastElapsedMs) ?? 3_600_000
  requireCompanion()
  const response = unwrapResponse(
    await companionClient.GET("/api/v1/roasts/{reference}/series", {
      params: {
        path: { reference: roastId },
        query: {
          streamVersion,
          fromElapsedMs: firstElapsedMs,
          toElapsedMs: lastElapsedMs,
          maxPoints: 2000,
          channels:
            "temperature,spotTemperature,meanTemperature,profileTemperature,profileRor,ror,desiredRor,power,actualFanRpm,native",
        },
      },
      ...(signal ? { signal } : {}),
    })
  )
  return response.points.map((value) => {
    const point = record(value)
    return {
      elapsedMs: number(point.elapsedMs),
      temperatureC: number(point.temperatureMilliC) / 1_000,
      spotTemperatureC:
        optionalNumber(point.spotTemperatureMilliC) === undefined
          ? null
          : number(point.spotTemperatureMilliC) / 1_000,
      meanTemperatureC:
        optionalNumber(point.meanTemperatureMilliC) === undefined
          ? null
          : number(point.meanTemperatureMilliC) / 1_000,
      profileC:
        optionalNumber(point.profileTemperatureMilliC) === undefined
          ? null
          : number(point.profileTemperatureMilliC) / 1_000,
      rorCPerMin:
        optionalNumber(point.rorMilliCPerMin) === undefined
          ? null
          : number(point.rorMilliCPerMin) / 1_000,
      profileRorCPerMin:
        optionalNumber(point.profileRorMilliCPerMin) === undefined
          ? null
          : number(point.profileRorMilliCPerMin) / 1_000,
      desiredRorCPerMin:
        optionalNumber(point.desiredRorMilliCPerMin) === undefined
          ? null
          : number(point.desiredRorMilliCPerMin) / 1_000,
      powerKw:
        optionalNumber(point.powerMilliKw) === undefined
          ? null
          : number(point.powerMilliKw) / 1_000,
      actualFanRpm: optionalNumber(point.actualFanRpm) ?? null,
      values: Object.fromEntries(
        Object.entries(record(point.values)).filter(
          (entry): entry is [string, number] => typeof entry[1] === "number"
        )
      ),
    }
  })
}

async function mapRoastDetail(
  resource: Record<string, unknown>,
  signal?: AbortSignal
): Promise<RoastDetail> {
  const lineage = record(resource.lineage)
  const coffee = record(lineage.coffee)
  const lot = record(lineage.lot)
  const provider = record(lineage.provider)
  const origin = record(lineage.origin)
  const profile = record(resource.profile)
  const tasting = record(resource.promotedTasting)
  const sampleStream = record(resource.sampleStream)
  const greenMassMg = number(resource.greenInputMassMg)
  const roastedMassMg = number(resource.roastedYieldMassMg)
  const scoreBasisPoints = optionalNumber(tasting.scoreBasisPoints)
  const events = Array.isArray(resource.events) ? resource.events : []
  const annotations = Array.isArray(resource.annotations)
    ? resource.annotations
    : []
  const roastId = text(resource.id)
  const roastNumber = number(resource.serialNumber)
  const chart = await loadSeries(
    String(roastNumber || roastId),
    sampleStream,
    signal
  )
  const durationMs =
    optionalNumber(resource.durationMs) ??
    optionalNumber(sampleStream.lastElapsedMs) ??
    chart.at(-1)?.elapsedMs ??
    0
  const cooldownEndMs = optionalNumber(resource.cooldownEndMs) ?? durationMs
  const resultText = text(resource.result)

  return {
    id: roastId,
    number: roastNumber,
    revision: number(resource.revision, 1),
    nativeLogNumber: optionalNumber(resource.nativeLogNumber) ?? null,
    roastedAt: optionalText(resource.roastedAt) ?? null,
    coffeeName: text(coffee.displayName, "Uncataloged coffee"),
    coffeeId: optionalText(coffee.id) ?? null,
    providerName: text(provider.displayName, "Unknown provider"),
    country: text(origin.countryCode, "—"),
    region: text(origin.region, "—"),
    farm: text(origin.farmProducer, "—"),
    process: text(origin.process, "—"),
    lotCode: text(lot.internalCode, "Unassigned"),
    profileName: text(profile.displayName, "Imported profile"),
    profileRevision: number(profile.revisionNumber, 1),
    level: number(resource.roastLevelThousandths) / 1_000,
    loadGrams: greenMassMg / 1_000,
    score: scoreBasisPoints === undefined ? null : scoreBasisPoints / 100,
    tastingNotes: text(tasting.notes),
    descriptors: Array.isArray(tasting.descriptors)
      ? tasting.descriptors.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    status:
      text(resource.status) === "interrupted"
        ? "interrupted"
        : scoreBasisPoints === undefined
          ? "needs-tasting"
          : "tasted",
    result:
      resultText === "stopped" || resultText === "imported"
        ? resultText
        : "completed",
    developmentPercent: number(resource.developmentBasisPoints) / 100,
    lossPercent:
      greenMassMg > 0 && roastedMassMg > 0
        ? ((greenMassMg - roastedMassMg) / greenMassMg) * 100
        : null,
    durationSeconds: durationMs / 1_000,
    cooldownSeconds: cooldownEndMs / 1_000,
    greenWeightGrams: greenMassMg / 1_000,
    roastedWeightGrams: roastedMassMg > 0 ? roastedMassMg / 1_000 : null,
    profileDescription: "",
    channels: Array.isArray(sampleStream.channels)
      ? sampleStream.channels.map((channel) => {
          const value = record(channel)
          return {
            key: text(value.key),
            name: text(value.name),
            rawName: text(value.rawName),
            sourceIndex: number(value.sourceIndex),
            offsetMs: number(value.offsetMs),
            unit:
              value.unit === "celsius" ||
              value.unit === "celsius_per_minute" ||
              value.unit === "kilowatts" ||
              value.unit === "rpm"
                ? value.unit
                : "unitless",
            hiddenByDefault: value.hiddenByDefault === true,
            reusePreviousScale: value.reusePreviousScale === true,
            specialProcessing: value.specialProcessing === true,
          }
        })
      : [],
    nativeMetadata: Object.fromEntries(
      Object.entries(record(resource.nativeMetadata)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
    importWarningCount: Array.isArray(resource.importWarnings)
      ? resource.importWarnings.length
      : 0,
    nextAction: text(tasting.nextAction),
    conclusion: text(tasting.conclusion, text(tasting.notes)),
    events: [
      ...events.map((value) => {
        const event = record(value)
        const temperature = optionalNumber(event.temperatureMilliC)
        return {
          id: text(event.id),
          label: titleFromKind(event.kind),
          elapsedMs: number(event.elapsedMs),
          temperatureC: temperature === undefined ? null : temperature / 1_000,
          kind: "device" as const,
        }
      }),
      ...annotations.map((value) => {
        const annotation = record(value)
        const temperature = optionalNumber(annotation.temperatureMilliC)
        return {
          id: text(annotation.id),
          label: text(annotation.text, "Annotation"),
          elapsedMs: number(annotation.elapsedMs),
          temperatureC: temperature === undefined ? null : temperature / 1_000,
          kind: "annotation" as const,
        }
      }),
    ].sort((left, right) => left.elapsedMs - right.elapsedMs),
    chart,
  }
}

export async function getRoast(
  id: string,
  signal?: AbortSignal
): Promise<CompanionResult<RoastDetail>> {
  try {
    requireCompanion()
    const resource = unwrapResponse(
      await companionClient.GET("/api/v1/roasts/{reference}", {
        params: { path: { reference: id } },
        ...(signal ? { signal } : {}),
      })
    )
    return {
      source: "companion",
      data: await mapRoastDetail(record(resource), signal),
    }
  } catch (error) {
    if (demoDataEnabled) return { data: getRoastDetail(id), source: "demo" }
    throw error
  }
}

export async function listCoffeeLots(): Promise<CompanionResult<CoffeeLot[]>> {
  try {
    requireCompanion()
    const [lotsResponse, coffeesResponse] = await Promise.all([
      companionClient.GET("/api/v1/lots", {
        params: { query: { first: 200 } },
      }),
      companionClient.GET("/api/v1/coffees", {
        params: { query: { first: 200 } },
      }),
    ])
    const lotsPage = unwrapResponse(lotsResponse)
    const coffeesPage = unwrapResponse(coffeesResponse)
    const coffeesById = new Map(
      coffeesPage.items.map((value) => {
        const coffee = record(value)
        return [text(coffee.id), coffee] as const
      })
    )
    const lots = lotsPage.items.map((value): CoffeeLot => {
      const lot = record(value)
      const provider = record(lot.provider)
      const purchase = record(lot.purchase)
      const summary = record(lot.summary)
      const coffee = coffeesById.get(text(lot.coffeeId)) ?? {}
      const altitudeMin = optionalNumber(coffee.altitudeMinMetres)
      const altitudeMax = optionalNumber(coffee.altitudeMaxMetres)
      const latestScore = optionalNumber(summary.latestScoreBasisPoints)
      return {
        id: text(lot.id),
        coffeeName: text(coffee.displayName, "Uncataloged coffee"),
        providerName: text(provider.displayName, "Unknown provider"),
        providerReference: text(purchase.supplierReference),
        country: text(coffee.countryCode, "—"),
        region: text(coffee.region, "—"),
        farm: text(coffee.farmProducer, "—"),
        process: text(coffee.process, "—"),
        variety: Array.isArray(coffee.varieties)
          ? coffee.varieties
              .filter((item): item is string => typeof item === "string")
              .join(", ")
          : "",
        harvest: text(coffee.harvestLabel),
        altitude:
          altitudeMin === undefined
            ? ""
            : altitudeMax === undefined || altitudeMax === altitudeMin
              ? `${altitudeMin.toLocaleString()} m`
              : `${altitudeMin.toLocaleString()}–${altitudeMax.toLocaleString()} m`,
        lotCode: text(lot.internalCode),
        receivedKg: number(lot.receivedMassMg) / 1_000_000,
        onHandKg: number(lot.onHandMassMg) / 1_000_000,
        costPerKg: null,
        storage: text(lot.storageLocation),
        roastCount: number(summary.roastCount),
        latestScore: latestScore === undefined ? null : latestScore / 100,
        bestScore: null,
        nextAction: "",
      }
    })
    return { data: lots, source: "companion" }
  } catch (error) {
    if (demoDataEnabled) return { data: coffeeLots, source: "demo" }
    throw error
  }
}

export async function listCoffeeIdentities(): Promise<CoffeeIdentity[]> {
  requireCompanion()
  const response = unwrapResponse(
    await companionClient.GET("/api/v1/coffees", {
      params: { query: { first: 200 } },
    })
  )
  return response.items.map((value) => {
    const coffee = record(value)
    return {
      id: text(coffee.id),
      number: number(coffee.serialNumber),
      name: text(coffee.displayName, "Unnamed coffee"),
      country: optionalText(coffee.countryCode) ?? null,
      region: optionalText(coffee.region) ?? null,
      process: optionalText(coffee.process) ?? null,
    }
  })
}

export async function createAcquisition(input: {
  providerName: string
  coffeeName: string
  supplierReference?: string | undefined
  receivedMassMg: number
  costPerKgMinor?: number | undefined
  currencyCode?: string | undefined
  receivedAt: string
  sourceTimezone: string
}) {
  requireCompanion()
  return unwrapResponse(
    await companionClient.POST("/api/v1/acquisitions", {
      body: {
        providerName: input.providerName,
        coffeeName: input.coffeeName,
        receivedMassMg: input.receivedMassMg,
        receivedAt: input.receivedAt,
        sourceTimezone: input.sourceTimezone,
        ...(input.supplierReference === undefined
          ? {}
          : { supplierReference: input.supplierReference }),
        ...(input.costPerKgMinor === undefined
          ? {}
          : { costPerKgMinor: input.costPerKgMinor }),
        ...(input.currencyCode === undefined
          ? {}
          : { currencyCode: input.currencyCode }),
      },
    })
  )
}

export async function assignRoastCoffee(
  roastNumber: number,
  revision: number,
  coffeeNumber: number | null
): Promise<void> {
  requireCompanion()
  unwrapResponse(
    await companionClient.PATCH("/api/v1/roasts/{reference}/coffee", {
      params: { path: { reference: String(roastNumber) } },
      headers: {
        "If-Match": `"revision:${revision}"`,
      },
      body: { coffeeNumber },
    })
  )
}

export async function getSystemCapabilities(): Promise<
  CompanionResult<SystemCapabilities>
> {
  try {
    requireCompanion()
    const bootstrap = unwrapResponse(
      await companionClient.GET("/api/v1/system/bootstrap")
    )
    return { data: normalizeCapabilities(bootstrap), source: "companion" }
  } catch (error) {
    if (demoDataEnabled) return { data: demoCapabilities, source: "demo" }
    throw error
  }
}

export async function getDeviceState(): Promise<CompanionResult<DeviceState>> {
  try {
    requireCompanion()
    const usb = normalizeAdapter(
      unwrapResponse(await companionClient.GET("/api/v1/device"))
    )
    const connection = usb.connection ?? "disconnected"
    return {
      source: "companion",
      data: {
        available: usb.state === "ready" && connection === "connected",
        adapterState: usb.state,
        reason: usb.reason,
        connection,
        model: usb.model ?? null,
        firmware: usb.firmware ?? null,
        protocol: usb.protocol ?? null,
        packetLimitBytes: usb.packetLimitBytes ?? null,
        busy: usb.busy ?? null,
        profileCount: usb.profileCount ?? null,
        logCount: usb.logCount ?? null,
        syncState: usb.syncState ?? "idle",
        importedLogCount: usb.importedLogCount ?? 0,
        updatedLogCount: usb.updatedLogCount ?? 0,
        importWarningCount: usb.importWarningCount ?? 0,
        quarantinedLogCount: usb.quarantinedLogCount ?? 0,
        importedProfileCount: usb.importedProfileCount ?? 0,
        profileWarningCount: usb.profileWarningCount ?? 0,
        quarantinedProfileCount: usb.quarantinedProfileCount ?? 0,
        lastSyncedAt: usb.lastSyncedAt ?? null,
        readOnly: usb.readOnly !== false,
      },
    }
  } catch (error) {
    if (demoDataEnabled) return { data: demoDeviceState, source: "demo" }
    throw error
  }
}

export async function listProfiles(
  signal?: AbortSignal
): Promise<CompanionResult<RoastProfile[]>> {
  requireCompanion()
  const response = unwrapResponse(
    await companionClient.GET("/api/v1/profiles", {
      ...(signal ? { signal } : {}),
    })
  )
  return {
    source: "companion",
    data: response.items.map((value) => ({
      id: value.id,
      profileId: value.profileId,
      revisionNumber: value.revisionNumber,
      fileName: value.fileName,
      displayName: value.displayName,
      designer: value.designer,
      description: value.description,
      schemaVersion: value.schemaVersion,
      sourceModifiedAt: value.sourceModifiedAt ?? null,
      profileModifiedAt: value.profileModifiedAt ?? null,
      recommendedLevel:
        value.recommendedLevelThousandths == null
          ? null
          : value.recommendedLevelThousandths / 1_000,
      referenceLoadGrams:
        value.referenceLoadMg == null ? null : value.referenceLoadMg / 1_000,
      roastLevelsC: value.roastLevelsMilliC.map((item) => item / 1_000),
      roastCurve: value.roastCurve.map((point) => ({
        elapsedMs: point.elapsedMs,
        temperatureC: point.temperatureMilliC / 1_000,
      })),
      fanCurve: value.fanCurve.map((point) => ({
        elapsedMs: point.elapsedMs,
        fanRpm: point.fanRpm,
      })),
      sourceHash: value.sourceHash,
      warnings: value.warnings,
    })),
  }
}

export async function refreshDevice(): Promise<void> {
  requireCompanion()
  unwrapResponse(
    await companionClient.POST("/api/v1/device/refresh", { body: {} })
  )
}

export async function synchronizeDevice(): Promise<void> {
  requireCompanion()
  unwrapResponse(
    await companionClient.POST("/api/v1/device/synchronize", { body: {} })
  )
}

function mapPreferences(value: unknown): UserPreferences {
  const row = record(value)
  return {
    revision: number(row.revision, 1),
    defaultRoasterName: text(row.defaultRoasterName),
    defaultGrinderName: text(row.defaultGrinderName),
    defaultGrinderSetting: text(row.defaultGrinderSetting),
    defaultKettleName: text(row.defaultKettleName),
    defaultWaterName: text(row.defaultWaterName),
    defaultBrewMethod: text(row.defaultBrewMethod, "V60"),
    defaultCoffeeMassMg: number(row.defaultCoffeeMassMg, 15_000),
    defaultWaterMassMg: number(row.defaultWaterMassMg, 250_000),
    defaultWaterTemperatureMilliC: number(
      row.defaultWaterTemperatureMilliC,
      93_000
    ),
  }
}

function mapBrew(value: unknown): Brew {
  const row = record(value)
  const roast = record(row.roast)
  return {
    id: text(row.id),
    number: number(row.serialNumber),
    revision: number(row.revision, 1),
    roastNumber: number(roast.serialNumber),
    coffeeName: optionalText(roast.coffeeName) ?? null,
    brewedAt: text(row.brewedAt),
    method: text(row.method),
    grinderName: text(row.grinderName),
    grinderSetting: text(row.grinderSetting),
    kettleName: text(row.kettleName),
    waterName: text(row.waterName),
    coffeeMassMg: number(row.coffeeMassMg),
    waterMassMg: number(row.waterMassMg),
    ratio: number(row.ratio),
    waterTemperatureMilliC: optionalNumber(row.waterTemperatureMilliC) ?? null,
    bloomWaterMassMg: optionalNumber(row.bloomWaterMassMg) ?? null,
    bloomDurationMs: optionalNumber(row.bloomDurationMs) ?? null,
    brewDurationMs: optionalNumber(row.brewDurationMs) ?? null,
    scoreBasisPoints: optionalNumber(row.scoreBasisPoints) ?? null,
    descriptors: Array.isArray(row.descriptors)
      ? row.descriptors.filter(
          (descriptor): descriptor is string => typeof descriptor === "string"
        )
      : [],
    tastingNotes: text(row.tastingNotes),
    notes: text(row.notes),
  }
}

export async function getPreferences(): Promise<UserPreferences> {
  requireCompanion()
  return mapPreferences(
    unwrapResponse(await companionClient.GET("/api/v1/preferences"))
  )
}

export async function updatePreferences(
  revision: number,
  input: Partial<Omit<UserPreferences, "revision">>
): Promise<UserPreferences> {
  requireCompanion()
  return mapPreferences(
    unwrapResponse(
      await companionClient.PATCH("/api/v1/preferences", {
        headers: { "If-Match": `"revision:${revision}"` },
        body: input,
      })
    )
  )
}

export async function listBrews(roastNumber?: number): Promise<Brew[]> {
  requireCompanion()
  const response = unwrapResponse(
    await companionClient.GET("/api/v1/brews", {
      params: { query: roastNumber ? { roastNumber } : {} },
    })
  )
  return response.items.map(mapBrew)
}

export async function createBrew(input: {
  roastNumber: number
  method?: string
  grinderName?: string
  grinderSetting?: string
  kettleName?: string
  waterName?: string
  coffeeMassMg?: number
  waterMassMg?: number
  waterTemperatureMilliC?: number
  scoreBasisPoints?: number
  tastingNotes?: string
  notes?: string
}): Promise<Brew> {
  requireCompanion()
  return mapBrew(
    unwrapResponse(await companionClient.POST("/api/v1/brews", { body: input }))
  )
}

export async function createLabelRecord(input: {
  roastNumber: number
  copies: number
}): Promise<LabelRecord> {
  requireCompanion()
  const row = record(
    unwrapResponse(
      await companionClient.POST("/api/v1/labels", { body: input })
    )
  )
  const status = text(row.status)
  return {
    id: text(row.id),
    number: number(row.serialNumber),
    roastNumber: number(row.roastNumber),
    qrPayload: text(row.qrPayload),
    copies: number(row.copies, 1),
    status:
      status === "submitted" ||
      status === "spooled" ||
      status === "failed" ||
      status === "unknown"
        ? status
        : "generated",
    createdAt: text(row.createdAt),
  }
}

export async function submitPrintJob(input: {
  roastId?: string
  printerId: string
  widthMm: number
  heightMm: number
  copies: number
  artifact: "pdf" | "queue"
}): Promise<{ id: string; status: "submitted"; source: DataSource }> {
  const capabilities = await getSystemCapabilities()
  if (isDemoResult(capabilities)) {
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    return { id: crypto.randomUUID(), status: "submitted", source: "demo" }
  }

  const printing = capabilities.data.adapters.printing
  if (!capabilities.data.features.printing || printing.state !== "ready") {
    throw new CapabilityUnavailableError(
      "printing",
      printing.reason ??
        (capabilities.data.features.printing
          ? printing.state
          : "feature_disabled")
    )
  }

  requireCompanion()
  const result = unwrapResponse(
    await companionClient.POST("/api/v1/print-jobs", {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: input,
    })
  )
  return { id: result.id, status: "submitted", source: "companion" }
}

export const queryKeys = {
  roasts: (options?: RoastLibraryOptions) =>
    options ? (["roasts", options] as const) : (["roasts"] as const),
  roast: (id: string) => ["roasts", id] as const,
  coffeeLots: () => ["coffee-lots"] as const,
  coffeeIdentities: () => ["coffee-identities"] as const,
  capabilities: () => ["system-capabilities"] as const,
  device: () => ["device"] as const,
  profiles: () => ["profiles"] as const,
  preferences: () => ["preferences"] as const,
  brews: (roastNumber?: number) => ["brews", roastNumber ?? "all"] as const,
}
