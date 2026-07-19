import type { SerialTransport } from "./serial-transport"
import { RoasterSession, type RoasterSessionSnapshot } from "./roaster-session"

const KAFFELOGIC_CDC_VENDOR_ID = 0x2e8a
const KAFFELOGIC_CDC_PRODUCT_ID = 0x000a
const SCAN_INTERVAL_MS = 1_500
const ROAST_LOG_DIRECTORY = "kaffelogic/roast-logs"
const ROAST_PROFILE_DIRECTORY = "kaffelogic/roast-profiles"

export type DeviceLogImportPort = {
  import(input: {
    bytes: Uint8Array
    devicePath: string
    filename: string
    sourceModifiedAt: string
  }): {
    imported: boolean
    updated: boolean
    warningCount: number
  }
}

export type DeviceAdapterSnapshot = {
  state: "ready" | "degraded" | "unavailable" | "failed"
  reason: string | null
  connection: "disconnected" | "reconnecting" | "connected"
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
  lastSyncedAt: string | null
  readOnly: true
}

export interface DeviceManagerPort {
  snapshot(): DeviceAdapterSnapshot
  refresh(): Promise<void>
  synchronize(): Promise<void>
  stop(): Promise<void>
}

export class NanoDeviceManager implements DeviceManagerPort {
  readonly #transport: SerialTransport
  readonly #session: RoasterSession
  readonly #logImporter: DeviceLogImportPort | undefined
  #snapshot: DeviceAdapterSnapshot = {
    state: "ready",
    reason: "starting",
    connection: "disconnected",
    model: null,
    firmware: null,
    protocol: null,
    packetLimitBytes: null,
    busy: null,
    profileCount: null,
    logCount: null,
    syncState: "idle",
    importedLogCount: 0,
    updatedLogCount: 0,
    importWarningCount: 0,
    lastSyncedAt: null,
    readOnly: true,
  }
  #scanTimer: ReturnType<typeof setInterval> | undefined
  #scanInFlight: Promise<void> | undefined
  #syncInFlight: Promise<void> | undefined
  #syncAttemptedForConnection = false
  #stopped = false

  constructor(transport: SerialTransport, logImporter?: DeviceLogImportPort) {
    this.#transport = transport
    this.#logImporter = logImporter
    this.#session = new RoasterSession({
      transport,
      onChange: (session) => this.#applySession(session),
    })
  }

  async start(): Promise<void> {
    try {
      await this.#transport.start()
      await this.refresh()
      this.#scanTimer = setInterval(() => void this.refresh(), SCAN_INTERVAL_MS)
    } catch {
      this.#snapshot = {
        ...this.#snapshot,
        state: "failed",
        reason: "serial_bridge_unavailable",
        connection: "disconnected",
      }
    }
  }

  snapshot(): DeviceAdapterSnapshot {
    return { ...this.#snapshot }
  }

  refresh(): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    if (this.#scanInFlight) return this.#scanInFlight
    this.#scanInFlight = this.#scan().finally(() => {
      this.#scanInFlight = undefined
    })
    return this.#scanInFlight
  }

  synchronize(): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    if (this.#syncInFlight) return this.#syncInFlight
    this.#syncInFlight = this.#synchronize().finally(() => {
      this.#syncInFlight = undefined
    })
    return this.#syncInFlight
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#scanTimer) clearInterval(this.#scanTimer)
    this.#scanTimer = undefined
    await this.#session.dispose()
    await this.#transport.stop()
  }

  async #scan(): Promise<void> {
    if (
      this.#snapshot.connection === "connected" ||
      this.#snapshot.connection === "reconnecting"
    ) {
      return
    }
    try {
      const listed = await this.#transport.list()
      const matches = listed.candidates.filter(
        (candidate) =>
          candidate.kind === "usb" &&
          candidate.vendorId === KAFFELOGIC_CDC_VENDOR_ID &&
          candidate.productId === KAFFELOGIC_CDC_PRODUCT_ID
      )
      if (matches.length === 0) {
        this.#syncAttemptedForConnection = false
        this.#snapshot = {
          ...this.#snapshot,
          state: "ready",
          reason: "nano_not_found",
          connection: "disconnected",
          model: null,
          firmware: null,
          protocol: null,
          packetLimitBytes: null,
          busy: null,
          syncState: "idle",
        }
        return
      }
      if (matches.length !== 1) {
        this.#snapshot = {
          ...this.#snapshot,
          state: "degraded",
          reason: "multiple_cdc_candidates",
          connection: "disconnected",
        }
        return
      }
      const candidate = matches[0]
      if (!candidate) return
      await this.#session.connect(candidate.candidateId, listed.generation)
    } catch (error) {
      this.#snapshot = {
        ...this.#snapshot,
        state: "degraded",
        reason: classifyTransportError(error),
        connection: "disconnected",
      }
    }
  }

  #applySession(session: RoasterSessionSnapshot): void {
    if (session.connection !== "connected") {
      this.#syncAttemptedForConnection = false
    }
    this.#snapshot = {
      ...this.#snapshot,
      state: session.connection === "disconnected" ? "degraded" : "ready",
      reason: session.reason,
      connection: session.connection,
      model: session.model,
      firmware: session.firmware,
      protocol: session.protocol,
      packetLimitBytes: session.packetLimitBytes,
      busy: session.busy,
      readOnly: true,
    }
    if (
      session.connection === "connected" &&
      session.operationalStatusReceived &&
      session.firmware &&
      session.busy !== true &&
      !this.#syncAttemptedForConnection
    ) {
      this.#syncAttemptedForConnection = true
      void this.synchronize().catch(() => undefined)
    }
  }

  async #synchronize(): Promise<void> {
    if (this.#session.snapshot.connection !== "connected") {
      throw new Error("device_not_connected")
    }
    this.#snapshot = { ...this.#snapshot, syncState: "syncing", reason: null }
    try {
      const logEntries = await this.#session.listDirectory(ROAST_LOG_DIRECTORY)
      const profileEntries = await this.#session.listDirectory(
        ROAST_PROFILE_DIRECTORY
      )
      const logs = logEntries
        .filter(
          (entry) =>
            entry.kind === "file" && /(?:^|\/)log\d+\.klog$/iu.test(entry.path)
        )
        .sort((left, right) => left.name.localeCompare(right.name))
      const profiles = profileEntries.filter(
        (entry) => entry.kind === "file" && entry.name.endsWith(".kpro")
      )
      this.#snapshot = {
        ...this.#snapshot,
        logCount: logs.length,
        profileCount: profiles.length,
      }

      let importedLogCount = 0
      let updatedLogCount = 0
      let importWarningCount = 0
      if (this.#logImporter) {
        for (const entry of logs) {
          const file = await this.#session.readFile(entry.path)
          const result = this.#logImporter.import({
            bytes: file.bytes,
            devicePath: file.path,
            filename: entry.name,
            sourceModifiedAt: file.modifiedAt || entry.modifiedAt,
          })
          if (result.imported) importedLogCount += 1
          if (result.updated) updatedLogCount += 1
          importWarningCount += result.warningCount
        }
      }
      this.#snapshot = {
        ...this.#snapshot,
        state: "ready",
        reason: null,
        syncState: "ready",
        importedLogCount,
        updatedLogCount,
        importWarningCount,
        lastSyncedAt: new Date().toISOString(),
      }
    } catch (error) {
      const reason = classifySyncError(error)
      const waitingForUnlock =
        reason === "device_busy" || reason === "sassi_outcome_103"
      if (waitingForUnlock) this.#syncAttemptedForConnection = false
      this.#snapshot = {
        ...this.#snapshot,
        state: waitingForUnlock
          ? "ready"
          : this.#session.snapshot.connection === "connected"
            ? "degraded"
            : this.#snapshot.state,
        reason,
        syncState: waitingForUnlock ? "idle" : "failed",
      }
      throw error
    }
  }
}

function classifyTransportError(error: unknown): string {
  const message = error instanceof Error ? error.message : "transport_failed"
  return /^[a-z][a-z0-9_]{0,63}$/.test(message) ? message : "transport_failed"
}

function classifySyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "device_sync_failed"
  if (message.startsWith("sassi_outcome_")) return message
  return /^[a-z][a-z0-9_]{0,63}$/.test(message) ? message : "device_sync_failed"
}
