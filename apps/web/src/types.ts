export type RoastStatus = "tasted" | "needs-tasting" | "ready" | "imported"

export type RoastSummary = {
  id: string
  roastedAt: string
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
  lossPercent: number
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
  profileC: number | null
  rorCPerMin: number | null
}

export type RoastDetail = RoastSummary & {
  greenWeightGrams: number
  roastedWeightGrams: number
  profileDescription: string
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
  profileCount: number | null
  logCount: number | null
  readOnly: boolean
}
