export type RoastStatus =
  "tasted" | "needs-tasting" | "ready" | "imported" | "interrupted"

export type RoastSummary = {
  id: string
  number: number
  nativeLogNumber: number | null
  roastedAt: string | null
  coffeeName: string
  providerName: string
  country: string
  region: string
  farm: string
  process: string
  lotCode: string
  profileName: string
  profileRevision: number
  level: number
  loadGrams: number
  score: number | null
  tastingNotes: string
  descriptors: string[]
  status: RoastStatus
  result: "completed" | "stopped" | "imported"
  developmentPercent: number
  lossPercent: number | null
  durationSeconds: number
}

export type CoffeeLot = {
  id: string
  coffeeName: string
  providerName: string
  providerReference: string
  country: string
  region: string
  farm: string
  process: string
  variety: string
  harvest: string
  altitude: string
  lotCode: string
  receivedKg: number
  onHandKg: number
  costPerKg: number | null
  storage: string
  roastCount: number
  latestScore: number | null
  bestScore: number | null
  nextAction: string
}

export type ChartPoint = {
  elapsedMs: number
  temperatureC: number
  spotTemperatureC?: number | null
  meanTemperatureC?: number | null
  profileC: number | null
  rorCPerMin: number | null
  profileRorCPerMin?: number | null
  desiredRorCPerMin?: number | null
  powerKw?: number | null
  actualFanRpm?: number | null
  values?: Record<string, number>
}

export type ChartChannel = {
  key: string
  name: string
  rawName: string
  sourceIndex: number
  offsetMs: number
  unit: "celsius" | "celsius_per_minute" | "kilowatts" | "rpm" | "unitless"
  hiddenByDefault: boolean
  reusePreviousScale: boolean
  specialProcessing: boolean
}

export type RoastDetail = RoastSummary & {
  revision: number
  coffeeId: string | null
  greenWeightGrams: number
  roastedWeightGrams: number | null
  profileDescription: string
  channels: ChartChannel[]
  cooldownSeconds: number
  nativeMetadata: Record<string, string>
  importWarningCount: number
  nextAction: string
  conclusion: string
  events: Array<{
    id: string
    label: string
    elapsedMs: number
    temperatureC: number | null
    kind: "device" | "manual" | "annotation"
  }>
  chart: ChartPoint[]
}

export type CoffeeIdentity = {
  id: string
  number: number
  name: string
  country: string | null
  region: string | null
  process: string | null
}

export type AdapterState = "ready" | "degraded" | "unavailable" | "failed"

export type DeviceState = {
  available: boolean
  adapterState: AdapterState
  reason: string | null
  connection: "connected" | "disconnected" | "reconnecting"
  model: string | null
  firmware: string | null
  protocol: string | null
  packetLimitBytes: number | null
  busy: boolean | null
  profileCount: number | null
  logCount: number | null
  syncState: "idle" | "syncing" | "ready" | "failed"
  importedLogCount: number
  updatedLogCount: number
  importWarningCount: number
  quarantinedLogCount: number
  importedProfileCount: number
  profileWarningCount: number
  quarantinedProfileCount: number
  lastSyncedAt: string | null
  readOnly: boolean
}

export type RoastProfile = {
  id: string
  profileId: string
  revisionNumber: number
  fileName: string
  displayName: string
  designer: string
  description: string
  schemaVersion: string
  sourceModifiedAt: string | null
  profileModifiedAt: string | null
  recommendedLevel: number | null
  referenceLoadGrams: number | null
  roastLevelsC: number[]
  roastCurve: Array<{ elapsedMs: number; temperatureC: number }>
  fanCurve: Array<{ elapsedMs: number; fanRpm: number }>
  sourceHash: string
  warnings: string[]
}

export type UserPreferences = {
  revision: number
  defaultRoasterName: string
  defaultGrinderName: string
  defaultGrinderSetting: string
  defaultKettleName: string
  defaultWaterName: string
  defaultBrewMethod: string
  defaultCoffeeMassMg: number
  defaultWaterMassMg: number
  defaultWaterTemperatureMilliC: number
}

export type Brew = {
  id: string
  number: number
  revision: number
  roastNumber: number
  coffeeName: string | null
  brewedAt: string
  method: string
  grinderName: string
  grinderSetting: string
  kettleName: string
  waterName: string
  coffeeMassMg: number
  waterMassMg: number
  ratio: number
  waterTemperatureMilliC: number | null
  bloomWaterMassMg: number | null
  bloomDurationMs: number | null
  brewDurationMs: number | null
  scoreBasisPoints: number | null
  descriptors: string[]
  tastingNotes: string
  notes: string
}

export type LabelRecord = {
  id: string
  number: number
  roastNumber: number
  qrPayload: string
  copies: number
  status: "generated" | "submitted" | "spooled" | "failed" | "unknown"
  createdAt: string
}
