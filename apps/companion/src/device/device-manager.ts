import type { SerialTransport } from "./serial-transport"
import { RoasterSession, type RoasterSessionSnapshot } from "./roaster-session"

const KAFFELOGIC_CDC_VENDOR_ID = 0x2e8a
const KAFFELOGIC_CDC_PRODUCT_ID = 0x000a
const SCAN_INTERVAL_MS = 1_500

export type DeviceAdapterSnapshot = {
  state: "ready" | "degraded" | "unavailable" | "failed"
  reason: string | null
  connection: "disconnected" | "reconnecting" | "connected"
  model: string | null
  firmware: string | null
  protocol: string | null
  packetLimitBytes: number | null
  profileCount: number | null
  logCount: number | null
  readOnly: true
}

export interface DeviceManagerPort {
  snapshot(): DeviceAdapterSnapshot
  refresh(): Promise<void>
  stop(): Promise<void>
}

export class NanoDeviceManager implements DeviceManagerPort {
  readonly #transport: SerialTransport
  readonly #session: RoasterSession
  #snapshot: DeviceAdapterSnapshot = {
    state: "ready",
    reason: "starting",
    connection: "disconnected",
    model: null,
    firmware: null,
    protocol: null,
    packetLimitBytes: null,
    profileCount: null,
    logCount: null,
    readOnly: true,
  }
  #scanTimer: ReturnType<typeof setInterval> | undefined
  #scanInFlight: Promise<void> | undefined
  #stopped = false

  constructor(transport: SerialTransport) {
    this.#transport = transport
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
        this.#snapshot = {
          ...this.#snapshot,
          state: "ready",
          reason: "nano_not_found",
          connection: "disconnected",
          model: null,
          firmware: null,
          protocol: null,
          packetLimitBytes: null,
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
    this.#snapshot = {
      ...this.#snapshot,
      state: session.connection === "disconnected" ? "degraded" : "ready",
      reason: session.reason,
      connection: session.connection,
      model: session.model,
      firmware: session.firmware,
      protocol: session.protocol,
      packetLimitBytes: session.packetLimitBytes,
      readOnly: true,
    }
  }
}

function classifyTransportError(error: unknown): string {
  const message = error instanceof Error ? error.message : "transport_failed"
  return /^[a-z][a-z0-9_]{0,63}$/.test(message) ? message : "transport_failed"
}
