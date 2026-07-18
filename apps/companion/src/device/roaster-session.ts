import {
  encodeInfoRequestFrame,
  encodeTimeSyncFrame,
  SassiDecoder,
  type DecodedSassiMessage,
  type Type2ConnectionRequest,
} from "@tan-studio/device-sassi"

import type { SerialTransport } from "./serial-transport"

const HANDSHAKE_TIMEOUT_MS = 10_000
const EXPECTED_MANUFACTURER = "kaffelogic.com"
const EXPECTED_PLATFORM = 1
const SUPPORTED_SASSI_VERSION = 1
const SUPPORTED_MODEL = /^KN1007B(?:\/.*)?$/

export type RoasterSessionSnapshot = {
  connection: "disconnected" | "reconnecting" | "connected"
  reason: string | null
  model: string | null
  firmware: string | null
  protocol: string | null
  packetLimitBytes: number | null
  readOnly: true
  operationalStatusReceived: boolean
}

export type RoasterSessionOptions = {
  transport: SerialTransport
  onChange: (snapshot: RoasterSessionSnapshot) => void
  now?: () => Date
  monotonicMs?: () => number
}

type PendingRequest =
  { kind: "time_sync"; elapsedMs: number } | { kind: "info"; infoCode: number }

export class RoasterSession {
  readonly #transport: SerialTransport
  readonly #onChange: (snapshot: RoasterSessionSnapshot) => void
  readonly #now: () => Date
  readonly #monotonicMs: () => number
  readonly #decoder = new SassiDecoder()
  readonly #startedAt: number
  #snapshot: RoasterSessionSnapshot = disconnected("not_connected")
  #sessionId: string | undefined
  #pending: PendingRequest | undefined
  #crcSeed: number | undefined
  #maximumPacketBytes: number | undefined
  #handshakeTimer: ReturnType<typeof setTimeout> | undefined
  #lastElapsedMs = -1
  #removeDataListener: () => void
  #removeDisconnectListener: () => void

  constructor(options: RoasterSessionOptions) {
    this.#transport = options.transport
    this.#onChange = options.onChange
    this.#now = options.now ?? (() => new Date())
    this.#monotonicMs = options.monotonicMs ?? (() => performance.now())
    this.#startedAt = this.#monotonicMs()
    this.#removeDataListener = this.#transport.onData((event) => {
      if (event.sessionId !== this.#sessionId) return
      for (const decoded of this.#decoder.push(event.bytes)) {
        if (decoded.kind === "error") {
          this.#fail(`protocol_${decoded.error.code}`)
          break
        }
        void this.#handleMessage(decoded.message).catch(() =>
          this.#fail("protocol_write_failed")
        )
      }
    })
    this.#removeDisconnectListener = this.#transport.onDisconnect((event) => {
      if (event.sessionId === this.#sessionId) this.#fail(event.reason)
    })
  }

  get snapshot(): RoasterSessionSnapshot {
    return { ...this.#snapshot }
  }

  async connect(candidateId: string, generation: number): Promise<void> {
    await this.close()
    this.#set({
      ...disconnected("negotiating"),
      connection: "reconnecting",
    })
    this.#decoder.reset()
    this.#pending = undefined
    this.#crcSeed = undefined
    this.#maximumPacketBytes = undefined
    this.#sessionId = await this.#transport.open(candidateId, generation)
    this.#handshakeTimer = setTimeout(
      () => this.#fail("handshake_timeout"),
      HANDSHAKE_TIMEOUT_MS
    )
  }

  async close(): Promise<void> {
    this.#clearHandshakeTimer()
    const sessionId = this.#sessionId
    this.#sessionId = undefined
    this.#pending = undefined
    this.#decoder.reset()
    if (sessionId) {
      try {
        await this.#transport.close(sessionId)
      } catch {
        // Disconnect and stale-session errors converge on the same safe state.
      }
    }
  }

  async dispose(): Promise<void> {
    await this.close()
    this.#removeDataListener()
    this.#removeDisconnectListener()
  }

  async #handleMessage(message: DecodedSassiMessage): Promise<void> {
    if (message.parsed.kind === "connection_request") {
      await this.#handleConnectionRequest(message.parsed)
      return
    }
    if (message.parsed.kind === "time_sync_ack") {
      if (
        this.#pending?.kind !== "time_sync" ||
        message.elapsedMs !== this.#pending.elapsedMs
      ) {
        this.#fail("unexpected_time_sync_ack")
        return
      }
      this.#clearHandshakeTimer()
      this.#pending = undefined
      this.#set({
        ...this.#snapshot,
        connection: "connected",
        reason: null,
        protocol: "SASSI v1 · read-only",
      })
      await this.#sendInfoRequest(9)
      return
    }
    if (message.parsed.kind === "info_response") {
      const response = message.parsed
      if (
        this.#pending?.kind !== "info" ||
        response.infoCode !== this.#pending.infoCode
      ) {
        return
      }
      this.#pending = undefined
      if (response.infoCode === 9) {
        this.#set({ ...this.#snapshot, operationalStatusReceived: true })
        await this.#sendInfoRequest(3)
      } else if (response.infoCode === 3) {
        const firmware = extractFirmware(response.data)
        if (firmware) this.#set({ ...this.#snapshot, firmware })
      }
    }
  }

  async #handleConnectionRequest(
    request: Type2ConnectionRequest
  ): Promise<void> {
    try {
      if (
        request.platform !== EXPECTED_PLATFORM ||
        request.manufacturerDomain !== EXPECTED_MANUFACTURER ||
        !SUPPORTED_MODEL.test(request.model) ||
        request.sassiVersion !== SUPPORTED_SASSI_VERSION
      ) {
        this.#fail("unsupported_device")
        return
      }
      if (this.#pending || this.#snapshot.connection === "connected") return

      this.#crcSeed = request.crcSeed
      this.#maximumPacketBytes = request.maximumPacketBytes
      this.#decoder.setNegotiatedLimits({
        maximumPacketBytes: request.maximumPacketBytes,
        crcSeed: request.crcSeed,
      })
      this.#set({
        connection: "reconnecting",
        reason: "awaiting_time_sync_ack",
        model: request.model,
        firmware: null,
        protocol: `SASSI v${request.sassiVersion}`,
        packetLimitBytes: request.maximumPacketBytes,
        readOnly: true,
        operationalStatusReceived: false,
      })

      const elapsedMs = this.#nextElapsedMs()
      this.#pending = { kind: "time_sync", elapsedMs }
      await this.#write(
        encodeTimeSyncFrame({
          elapsedMs,
          crcSeed: request.crcSeed,
          now: this.#now(),
          maximumFrameBytes: request.maximumPacketBytes,
        })
      )
    } finally {
      // The hardware identity never leaves this transient decoder callback.
      request.serialBytes.fill(0)
    }
  }

  async #sendInfoRequest(infoCode: number): Promise<void> {
    if (
      this.#pending ||
      this.#crcSeed === undefined ||
      this.#maximumPacketBytes === undefined
    ) {
      return
    }
    const elapsedMs = this.#nextElapsedMs()
    this.#pending = { kind: "info", infoCode }
    await this.#write(
      encodeInfoRequestFrame({
        elapsedMs,
        crcSeed: this.#crcSeed,
        infoCode,
        maximumFrameBytes: this.#maximumPacketBytes,
      })
    )
  }

  async #write(payload: Uint8Array): Promise<void> {
    const sessionId = this.#sessionId
    if (!sessionId) throw new Error("serial session is closed")
    await this.#transport.write(sessionId, payload)
  }

  #nextElapsedMs(): number {
    const candidate = Math.max(
      0,
      Math.floor(this.#monotonicMs() - this.#startedAt)
    )
    this.#lastElapsedMs = Math.max(candidate, this.#lastElapsedMs + 1)
    return this.#lastElapsedMs
  }

  #fail(reason: string): void {
    this.#clearHandshakeTimer()
    const sessionId = this.#sessionId
    this.#sessionId = undefined
    this.#pending = undefined
    this.#crcSeed = undefined
    this.#maximumPacketBytes = undefined
    this.#decoder.reset()
    this.#set({
      ...this.#snapshot,
      connection: "disconnected",
      reason,
      operationalStatusReceived: false,
    })
    if (sessionId) void this.#transport.close(sessionId).catch(() => undefined)
  }

  #set(snapshot: RoasterSessionSnapshot): void {
    this.#snapshot = snapshot
    this.#onChange(this.snapshot)
  }

  #clearHandshakeTimer(): void {
    if (this.#handshakeTimer) clearTimeout(this.#handshakeTimer)
    this.#handshakeTimer = undefined
  }
}

function disconnected(reason: string): RoasterSessionSnapshot {
  return {
    connection: "disconnected",
    reason,
    model: null,
    firmware: null,
    protocol: null,
    packetLimitBytes: null,
    readOnly: true,
    operationalStatusReceived: false,
  }
}

function extractFirmware(data: string): string | undefined {
  const fields = Object.fromEntries(
    data
      .split(";")
      .map((entry) => entry.split(":"))
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0] && entry[1])
      )
  )
  for (const key of [
    "firmware_version",
    "firmware",
    "software_version",
    "version",
  ]) {
    const value = fields[key]?.trim()
    if (value && /^[A-Za-z0-9._+/-]{1,64}$/.test(value)) return value
  }
  return undefined
}
