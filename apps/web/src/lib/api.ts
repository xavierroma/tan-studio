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
} from "@/types"

declare global {
  interface Window {
    __TAN_STUDIO_BOOTSTRAP__?: {
      apiOrigin: string
      token: string
      clientId: string
    }
  }
}

export type DataSource = "companion" | "demo"

export type CompanionResult<T> = {
  data: T
  source: DataSource
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

const browserBootstrap =
  typeof window === "undefined" ? undefined : window.__TAN_STUDIO_BOOTSTRAP__
const configuredOrigin =
  browserBootstrap?.apiOrigin ??
  import.meta.env.VITE_COMPANION_ORIGIN ??
  (import.meta.env.DEV ? "http://127.0.0.1:4317" : undefined)
const configuredToken =
  browserBootstrap?.token ??
  import.meta.env.VITE_COMPANION_TOKEN ??
  (import.meta.env.DEV ? "tan-studio-development-only" : undefined)

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

async function companionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!configuredOrigin || !configuredToken) {
    throw new Error("Companion bootstrap is unavailable")
  }

  const response = await fetch(`${configuredOrigin}/api/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${configuredToken}`,
      "Content-Type": "application/json",
      "X-Tan-Studio-Client":
        browserBootstrap?.clientId ?? "tan-studio-browser-dev",
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? ""
    const problem = contentType.includes("json")
      ? record(await response.json().catch(() => null))
      : {}
    throw new Error(
      optionalText(problem.detail) ??
        optionalText(problem.title) ??
        `Companion request failed (${response.status})`
    )
  }

  return (await response.json()) as T
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
    statusText === "tasted" ||
    statusText === "needs-tasting" ||
    statusText === "ready"
      ? statusText
      : scoreBasisPoints == null
        ? "needs-tasting"
        : "tasted"
  const resultText = text(row.result)

  return {
    id: text(row.roastId || row.id),
    number: number(row.roastNumber),
    nativeLogNumber: optionalNumber(row.nativeLogNumber) ?? null,
    roastedAt: text(row.roastedAt, new Date(0).toISOString()),
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
  signal?: AbortSignal
): Promise<CompanionResult<RoastSummary[]>> {
  try {
    const response = await companionFetch<{
      rows?: Array<Record<string, unknown>>
      items?: Array<Record<string, unknown>>
    }>("/roast-library/query", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        viewVersion: 1,
        filters: { op: "and", clauses: [] },
        groups: [],
        sorts: [{ field: "roastedAt", direction: "desc", nulls: "last" }],
        columns: [
          "roastId",
          "roastNumber",
          "nativeLogNumber",
          "roastedAt",
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
        ],
        aggregates: [],
        page: { first: 100 },
      }),
    })
    const rows = response.rows ?? response.items ?? []
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
  const params = new URLSearchParams({
    streamVersion: String(streamVersion),
    fromElapsedMs: String(firstElapsedMs),
    toElapsedMs: String(lastElapsedMs),
    maxPoints: "2000",
    channels:
      "temperature,spotTemperature,meanTemperature,profileTemperature,profileRor,ror,desiredRor,power,actualFanRpm,native",
  })
  const response = await companionFetch<{ points?: unknown[] }>(
    `/roasts/${encodeURIComponent(roastId)}/series?${params}`,
    signal ? { signal } : undefined
  )
  return (response.points ?? []).map((value) => {
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
    roastedAt: text(resource.roastedAt, new Date(0).toISOString()),
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
      text(resource.status) === "ready"
        ? "ready"
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
    const resource = await companionFetch<Record<string, unknown>>(
      `/roasts/${encodeURIComponent(id)}`,
      signal ? { signal } : undefined
    )
    return {
      source: "companion",
      data: await mapRoastDetail(resource, signal),
    }
  } catch (error) {
    if (demoDataEnabled) return { data: getRoastDetail(id), source: "demo" }
    throw error
  }
}

export async function listCoffeeLots(): Promise<CompanionResult<CoffeeLot[]>> {
  try {
    const [lotsResponse, coffeesResponse] = await Promise.all([
      companionFetch<{ items?: unknown[] }>("/lots?first=200"),
      companionFetch<{ items?: unknown[] }>("/coffees?first=200"),
    ])
    const coffeesById = new Map(
      (coffeesResponse.items ?? []).map((value) => {
        const coffee = record(value)
        return [text(coffee.id), coffee] as const
      })
    )
    const lots = (lotsResponse.items ?? []).map((value): CoffeeLot => {
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
  const response = await companionFetch<{ items?: unknown[] }>(
    "/coffees?first=200"
  )
  return (response.items ?? []).map((value) => {
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

export async function assignRoastCoffee(
  roastNumber: number,
  revision: number,
  coffeeNumber: number | null
): Promise<void> {
  await companionFetch(`/roasts/${roastNumber}/coffee`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"revision:${revision}"`,
    },
    body: JSON.stringify({ coffeeNumber }),
  })
}

export async function getSystemCapabilities(): Promise<
  CompanionResult<SystemCapabilities>
> {
  try {
    const bootstrap = await companionFetch<unknown>("/system/bootstrap")
    return { data: normalizeCapabilities(bootstrap), source: "companion" }
  } catch (error) {
    if (demoDataEnabled) return { data: demoCapabilities, source: "demo" }
    throw error
  }
}

export async function getDeviceState(): Promise<CompanionResult<DeviceState>> {
  try {
    const usb = normalizeAdapter(await companionFetch<unknown>("/device"))
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
        lastSyncedAt: usb.lastSyncedAt ?? null,
        readOnly: usb.readOnly !== false,
      },
    }
  } catch (error) {
    if (demoDataEnabled) return { data: demoDeviceState, source: "demo" }
    throw error
  }
}

export async function refreshDevice(): Promise<void> {
  await companionFetch("/device/refresh", { method: "POST" })
}

export async function synchronizeDevice(): Promise<void> {
  await companionFetch("/device/synchronize", { method: "POST", body: "{}" })
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
  return mapPreferences(await companionFetch("/preferences"))
}

export async function updatePreferences(
  revision: number,
  input: Partial<Omit<UserPreferences, "revision">>
): Promise<UserPreferences> {
  return mapPreferences(
    await companionFetch("/preferences", {
      method: "PATCH",
      headers: { "If-Match": `"revision:${revision}"` },
      body: JSON.stringify(input),
    })
  )
}

export async function listBrews(roastNumber?: number): Promise<Brew[]> {
  const params = new URLSearchParams()
  if (roastNumber) params.set("roastNumber", String(roastNumber))
  const response = await companionFetch<{ items?: unknown[] }>(
    `/brews${params.size ? `?${params}` : ""}`
  )
  return (response.items ?? []).map(mapBrew)
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
  return mapBrew(
    await companionFetch("/brews", {
      method: "POST",
      body: JSON.stringify(input),
    })
  )
}

export async function createLabelRecord(input: {
  roastNumber: number
  copies: number
}): Promise<LabelRecord> {
  const row = record(
    await companionFetch("/labels", {
      method: "POST",
      body: JSON.stringify(input),
    })
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

  const result = await companionFetch<{ id: string; status: "submitted" }>(
    "/print-jobs",
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(input),
    }
  )
  return { ...result, source: "companion" }
}

export const queryKeys = {
  roasts: () => ["roasts"] as const,
  roast: (id: string) => ["roasts", id] as const,
  coffeeLots: () => ["coffee-lots"] as const,
  coffeeIdentities: () => ["coffee-identities"] as const,
  capabilities: () => ["system-capabilities"] as const,
  device: () => ["device"] as const,
  preferences: () => ["preferences"] as const,
  brews: (roastNumber?: number) => ["brews", roastNumber ?? "all"] as const,
}
