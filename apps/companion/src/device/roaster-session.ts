import {
  encodeAcknowledgementFrame,
  encodeDirectoryListFrame,
  encodeFileRequestFrame,
  encodeInfoRequestFrame,
  encodeTimeSyncFrame,
  SassiDecoder,
  type DecodedSassiMessage,
  type Type2ConnectionRequest,
  type Type6DirectoryListChunk,
  type Type8FileChunk,
} from "@tan-studio/device-sassi"

import type { SerialTransport } from "./serial-transport"

const REQUEST_TIMEOUT_MS = 10_000
const EXPECTED_MANUFACTURER = "kaffelogic.com"
const EXPECTED_PLATFORM = 1
const SUPPORTED_SASSI_VERSION = 1
const SUPPORTED_MODEL = /^KN1007B(?:\/.*)?$/

export type RoasterDirectoryEntry = {
  kind: "directory" | "file"
  name: string
  path: string
  modifiedAt: string
  sizeBytes: number
}

export type RoasterFile = {
  path: string
  modifiedAt: string
  bytes: Uint8Array
}

export type IncrementalRoasterFileChunk = {
  path: string
  modifiedAt: string
  sequence: number
  final: boolean
  bytes: Uint8Array
}

export type RoasterSessionSnapshot = {
  connection: "disconnected" | "reconnecting" | "connected"
  reason: string | null
  model: string | null
  firmware: string | null
  protocol: string | null
  packetLimitBytes: number | null
  readOnly: true
  operationalStatusReceived: boolean
  busy: boolean | null
}

export type RoasterSessionOptions = {
  transport: SerialTransport
  onChange: (snapshot: RoasterSessionSnapshot) => void
  onIncrementalFile?: (chunk: IncrementalRoasterFileChunk) => void
  now?: () => Date
  monotonicMs?: () => number
}

type TransferBase = {
  path: string
  expectedSequence: number
  chunks: Uint8Array[]
  reject: (error: Error) => void
}

type PendingRequest =
  | { kind: "time_sync"; elapsedMs: number }
  | { kind: "info"; infoCode: number }
  | (TransferBase & {
      kind: "directory"
      resolve: (entries: readonly RoasterDirectoryEntry[]) => void
    })
  | (TransferBase & {
      kind: "file"
      modifiedAt: string
      resolve: (file: RoasterFile) => void
    })

export class RoasterSession {
  readonly #transport: SerialTransport
  readonly #onChange: (snapshot: RoasterSessionSnapshot) => void
  readonly #onIncrementalFile:
    ((chunk: IncrementalRoasterFileChunk) => void) | undefined
  readonly #now: () => Date
  readonly #monotonicMs: () => number
  readonly #decoder = new SassiDecoder()
  readonly #startedAt: number
  #snapshot: RoasterSessionSnapshot = disconnected("not_connected")
  #sessionId: string | undefined
  #pending: PendingRequest | undefined
  #crcSeed: number | undefined
  #maximumPacketBytes: number | undefined
  #requestTimer: ReturnType<typeof setTimeout> | undefined
  #lastElapsedMs = -1
  #removeDataListener: () => void
  #removeDisconnectListener: () => void

  constructor(options: RoasterSessionOptions) {
    this.#transport = options.transport
    this.#onChange = options.onChange
    this.#onIncrementalFile = options.onIncrementalFile
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
          this.#fail("protocol_processing_failed")
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
    this.#crcSeed = undefined
    this.#maximumPacketBytes = undefined
    this.#sessionId = await this.#transport.open(candidateId, generation)
    this.#armRequestTimeout()
  }

  async close(): Promise<void> {
    this.#clearRequestTimer()
    this.#rejectTransfer(new Error("serial_session_closed"))
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

  async listDirectory(path: string): Promise<readonly RoasterDirectoryEntry[]> {
    this.#assertFilesystemReady()
    const crcSeed = this.#crcSeed!
    const maximumFrameBytes = this.#maximumPacketBytes!
    const elapsedMs = this.#nextElapsedMs()
    let resolve!: (entries: readonly RoasterDirectoryEntry[]) => void
    let reject!: (error: Error) => void
    const result = new Promise<readonly RoasterDirectoryEntry[]>(
      (resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      }
    )
    this.#pending = {
      kind: "directory",
      path,
      expectedSequence: 1,
      chunks: [],
      resolve,
      reject,
    }
    this.#armRequestTimeout()
    try {
      await this.#write(
        encodeDirectoryListFrame({
          elapsedMs,
          crcSeed,
          path,
          maximumFrameBytes,
        })
      )
    } catch (error) {
      this.#clearRequestTimer()
      this.#pending = undefined
      reject(asError(error, "directory_request_failed"))
    }
    return result
  }

  async readFile(path: string): Promise<RoasterFile> {
    this.#assertFilesystemReady()
    const crcSeed = this.#crcSeed!
    const maximumFrameBytes = this.#maximumPacketBytes!
    const elapsedMs = this.#nextElapsedMs()
    let resolve!: (file: RoasterFile) => void
    let reject!: (error: Error) => void
    const result = new Promise<RoasterFile>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.#pending = {
      kind: "file",
      path,
      modifiedAt: "",
      expectedSequence: 1,
      chunks: [],
      resolve,
      reject,
    }
    this.#armRequestTimeout()
    try {
      await this.#write(
        encodeFileRequestFrame({
          elapsedMs,
          crcSeed,
          path,
          maximumFrameBytes,
        })
      )
    } catch (error) {
      this.#clearRequestTimer()
      this.#pending = undefined
      reject(asError(error, "file_request_failed"))
    }
    return result
  }

  async #handleMessage(message: DecodedSassiMessage): Promise<void> {
    const parsed = message.parsed
    if (parsed.kind === "connection_request") {
      await this.#handleConnectionRequest(parsed)
      return
    }
    if (parsed.kind === "time_sync_ack") {
      if (
        this.#pending?.kind !== "time_sync" ||
        message.elapsedMs !== this.#pending.elapsedMs
      ) {
        this.#fail("unexpected_time_sync_ack")
        return
      }
      this.#clearRequestTimer()
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
    if (parsed.kind === "info_response") {
      if (
        this.#pending?.kind !== "info" ||
        parsed.infoCode !== this.#pending.infoCode
      ) {
        return
      }
      this.#clearRequestTimer()
      this.#pending = undefined
      if (parsed.infoCode === 9) {
        this.#set({
          ...this.#snapshot,
          operationalStatusReceived: true,
          busy: operationalFilesystemLocked(parsed.data),
        })
        await this.#sendInfoRequest(3)
      } else if (parsed.infoCode === 3) {
        const firmware = extractFirmware(parsed.data)
        if (firmware) this.#set({ ...this.#snapshot, firmware })
      }
      return
    }
    if (parsed.kind === "directory_list_chunk") {
      await this.#handleDirectoryChunk(parsed)
      return
    }
    if (parsed.kind === "file_chunk") {
      await this.#handleFileChunk(parsed)
      return
    }
    if (parsed.kind === "status_notification") {
      if (parsed.infoCode === 6) this.#set({ ...this.#snapshot, busy: true })
      if (parsed.infoCode === 7) this.#set({ ...this.#snapshot, busy: false })
      return
    }
    if (parsed.kind === "incremental_file_chunk") {
      const bytes = decodeBase64(parsed.base64Data)
      this.#onIncrementalFile?.({
        path: parsed.path,
        modifiedAt: parsed.modifiedAt,
        sequence: parsed.sequence,
        final: parsed.final,
        bytes,
      })
      await this.#sendAcknowledgement()
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
        busy: null,
      })

      const elapsedMs = this.#nextElapsedMs()
      this.#pending = { kind: "time_sync", elapsedMs }
      this.#armRequestTimeout()
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
    this.#armRequestTimeout()
    await this.#write(
      encodeInfoRequestFrame({
        elapsedMs,
        crcSeed: this.#crcSeed,
        infoCode,
        maximumFrameBytes: this.#maximumPacketBytes,
      })
    )
  }

  async #handleDirectoryChunk(chunk: Type6DirectoryListChunk): Promise<void> {
    const pending = this.#pending
    if (pending?.kind !== "directory") return
    if (!this.#acceptTransferChunk(pending, chunk)) return
    if (!chunk.final) {
      await this.#sendAcknowledgement()
      this.#armRequestTimeout()
      return
    }
    this.#clearRequestTimer()
    this.#pending = undefined
    pending.resolve(parseDirectory(pending.path, combine(pending.chunks)))
  }

  async #handleFileChunk(chunk: Type8FileChunk): Promise<void> {
    const pending = this.#pending
    if (pending?.kind !== "file") return
    if (!this.#acceptTransferChunk(pending, chunk)) return
    pending.modifiedAt = chunk.modifiedAt
    if (!chunk.final) {
      await this.#sendAcknowledgement()
      this.#armRequestTimeout()
      return
    }
    this.#clearRequestTimer()
    this.#pending = undefined
    pending.resolve({
      path: pending.path,
      modifiedAt: pending.modifiedAt,
      bytes: combine(pending.chunks),
    })
  }

  #acceptTransferChunk(
    pending: TransferBase,
    chunk: Type6DirectoryListChunk | Type8FileChunk
  ): boolean {
    if (chunk.outcome !== 0) {
      const error = new Error(`sassi_outcome_${chunk.outcome}`)
      this.#clearRequestTimer()
      this.#pending = undefined
      if (chunk.outcome === 103) {
        this.#set({ ...this.#snapshot, busy: true })
      }
      pending.reject(error)
      return false
    }
    if (chunk.sequence !== pending.expectedSequence) {
      const error = new Error("sassi_data_sequence_error")
      this.#clearRequestTimer()
      this.#pending = undefined
      pending.reject(error)
      throw error
    }
    pending.expectedSequence += 1
    pending.chunks.push(decodeBase64(chunk.base64Data))
    return true
  }

  async #sendAcknowledgement(): Promise<void> {
    if (this.#crcSeed === undefined || this.#maximumPacketBytes === undefined)
      throw new Error("session_not_negotiated")
    await this.#write(
      encodeAcknowledgementFrame({
        elapsedMs: this.#nextElapsedMs(),
        crcSeed: this.#crcSeed,
        maximumFrameBytes: this.#maximumPacketBytes,
      })
    )
  }

  #assertFilesystemReady(): void {
    if (
      this.#snapshot.connection !== "connected" ||
      !this.#sessionId ||
      this.#crcSeed === undefined ||
      this.#maximumPacketBytes === undefined
    ) {
      throw new Error("session_not_ready")
    }
    if (this.#pending) throw new Error("session_command_in_flight")
    if (this.#snapshot.busy === true) throw new Error("device_busy")
  }

  async #write(payload: Uint8Array): Promise<void> {
    const sessionId = this.#sessionId
    if (!sessionId) throw new Error("serial_session_closed")
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
    this.#clearRequestTimer()
    this.#rejectTransfer(new Error(reason))
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
      busy: null,
    })
    if (sessionId) void this.#transport.close(sessionId).catch(() => undefined)
  }

  #rejectTransfer(error: Error): void {
    if (this.#pending?.kind === "directory" || this.#pending?.kind === "file") {
      this.#pending.reject(error)
    }
  }

  #set(snapshot: RoasterSessionSnapshot): void {
    this.#snapshot = snapshot
    this.#onChange(this.snapshot)
  }

  #armRequestTimeout(): void {
    this.#clearRequestTimer()
    this.#requestTimer = setTimeout(
      () => this.#fail("request_timeout"),
      REQUEST_TIMEOUT_MS
    )
  }

  #clearRequestTimer(): void {
    if (this.#requestTimer) clearTimeout(this.#requestTimer)
    this.#requestTimer = undefined
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
    busy: null,
  }
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"))
}

function combine(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0)
  )
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function parseDirectory(
  parentPath: string,
  bytes: Uint8Array
): readonly RoasterDirectoryEntry[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  return text
    .split("\r")
    .filter(Boolean)
    .map((record) => {
      const [mode, name, modifiedAt, sizeText] = record.split("\t")
      const sizeBytes = Number(sizeText)
      if (
        (mode !== ">" && mode !== " ") ||
        !name ||
        modifiedAt === undefined ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 0 ||
        name.includes("/")
      ) {
        throw new Error("invalid_directory_record")
      }
      return {
        kind: mode === ">" ? "directory" : "file",
        name,
        path: `${parentPath.replace(/\/$/u, "")}/${name}`,
        modifiedAt,
        sizeBytes,
      }
    })
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
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

function operationalFilesystemLocked(data: string): boolean | null {
  const fields = Object.fromEntries(
    data
      .split(";")
      .map((entry) => entry.split(":"))
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0] && entry[1])
      )
  )
  const value = fields.sassi_file_lock?.trim()
  if (value === undefined || !/^\d+$/u.test(value)) return null
  return Number(value) !== 0
}
