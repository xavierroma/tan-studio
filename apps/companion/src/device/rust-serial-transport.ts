import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, resolve } from "node:path"

import type {
  SerialCandidate,
  SerialCandidateList,
  SerialDataEvent,
  SerialDisconnectEvent,
  SerialTransport,
} from "./serial-transport"

const PROTOCOL_VERSION = 1
const MAX_LINE_BYTES = 256 * 1024
const COMMAND_TIMEOUT_MS = 10_000
const START_TIMEOUT_MS = 5_000
const EXECUTABLE_PREFIX = "tan-studio-serial-bridge"

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type BridgeResponse = {
  type: "response"
  requestId: string | null
  ok: boolean
  result?: Record<string, unknown>
  error?: { code: string; retryable: boolean }
}

type BridgeReady = { type: "ready" }
type BridgeData = {
  type: "data"
  sessionId: string
  seq: number
  payloadBase64: string
}
type BridgeDisconnected = {
  type: "disconnected"
  sessionId: string
  seq: number
  reason: string
}
export type BridgeMessage =
  BridgeResponse | BridgeReady | BridgeData | BridgeDisconnected

type BridgeChild = {
  stdin: {
    write(value: string | Uint8Array): number
    flush(): number | Promise<number>
    end(): number | Promise<number>
  }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(signal?: number | NodeJS.Signals): void
}

export class RustSerialTransport implements SerialTransport {
  readonly #executablePath: string
  readonly #pending = new Map<string, PendingCommand>()
  readonly #dataListeners = new Set<(event: SerialDataEvent) => void>()
  readonly #disconnectListeners = new Set<
    (event: SerialDisconnectEvent) => void
  >()
  readonly #expectedSequence = new Map<string, number>()
  #child: BridgeChild | undefined
  #ready: ReturnType<typeof deferred<void>> | undefined
  #stopping = false

  constructor(executablePath = resolveSerialBridgePath()) {
    this.#executablePath = executablePath
  }

  async start(): Promise<void> {
    if (this.#child) return
    this.#stopping = false
    const spawned = Bun.spawn([this.#executablePath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {},
    })
    if (
      !spawned.stdin ||
      !(spawned.stdout instanceof ReadableStream) ||
      !(spawned.stderr instanceof ReadableStream)
    ) {
      spawned.kill()
      throw new Error("serial_bridge_pipe_unavailable")
    }
    this.#child = spawned as unknown as BridgeChild
    this.#ready = deferred<void>()
    void this.#consumeStdout(spawned.stdout)
    void drain(spawned.stderr)
    void spawned.exited.then((code) => this.#handleExit(code))

    await withTimeout(
      this.#ready.promise,
      START_TIMEOUT_MS,
      "serial_bridge_start_timeout"
    )
  }

  async list(): Promise<SerialCandidateList> {
    const result = await this.#command({ type: "list" })
    const generation = integer(result.generation)
    const candidates = Array.isArray(result.candidates)
      ? result.candidates.map(parseCandidate)
      : undefined
    if (generation === undefined || !candidates) {
      throw new Error("serial_bridge_invalid_list")
    }
    return { generation, candidates }
  }

  async open(candidateId: string, generation: number): Promise<string> {
    const result = await this.#command({
      type: "open",
      candidateId,
      generation,
    })
    const sessionId = boundedIdentifier(result.sessionId)
    if (!sessionId) throw new Error("serial_bridge_invalid_open")
    this.#expectedSequence.set(sessionId, 1)
    return sessionId
  }

  async write(sessionId: string, payload: Uint8Array): Promise<void> {
    if (payload.length === 0 || payload.length > 64 * 1024) {
      throw new RangeError("serial payload must contain 1 through 65536 bytes")
    }
    const result = await this.#command({
      type: "write",
      sessionId,
      payloadBase64: Buffer.from(payload).toString("base64"),
    })
    if (integer(result.bytesWritten) !== payload.length) {
      throw new Error("serial_bridge_short_write")
    }
  }

  async close(sessionId: string): Promise<void> {
    await this.#command({ type: "close", sessionId })
    this.#expectedSequence.delete(sessionId)
  }

  async stop(): Promise<void> {
    const child = this.#child
    if (!child) return
    this.#stopping = true
    try {
      await this.#command({ type: "shutdown" })
    } catch {
      child.kill()
    }
    await child.stdin.end()
    await Promise.race([child.exited, Bun.sleep(1_000)])
    this.#child = undefined
    this.#ready = undefined
    this.#expectedSequence.clear()
  }

  onData(listener: (event: SerialDataEvent) => void): () => void {
    this.#dataListeners.add(listener)
    return () => this.#dataListeners.delete(listener)
  }

  onDisconnect(listener: (event: SerialDisconnectEvent) => void): () => void {
    this.#disconnectListeners.add(listener)
    return () => this.#disconnectListeners.delete(listener)
  }

  async #command(
    command: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const child = this.#child
    if (!child) throw new Error("serial_bridge_not_started")
    const requestId = Bun.randomUUIDv7()
    const response = deferred<Record<string, unknown>>()
    const timeout = setTimeout(() => {
      this.#pending.delete(requestId)
      response.reject(new Error("serial_bridge_command_timeout"))
    }, COMMAND_TIMEOUT_MS)
    this.#pending.set(requestId, { ...response, timeout })

    try {
      child.stdin.write(
        `${JSON.stringify({ ...command, protocolVersion: PROTOCOL_VERSION, requestId })}\n`
      )
      await child.stdin.flush()
    } catch (error) {
      clearTimeout(timeout)
      this.#pending.delete(requestId)
      throw error
    }
    return response.promise
  }

  async #consumeStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    try {
      for await (const line of readLines(stream, MAX_LINE_BYTES)) {
        this.#handleMessage(parseBridgeMessage(line))
      }
    } catch {
      this.#failAll("serial_bridge_protocol_error")
      this.#child?.kill()
    }
  }

  #handleMessage(message: BridgeMessage): void {
    if (message.type === "ready") {
      this.#ready?.resolve()
      return
    }
    if (message.type === "response") {
      if (!message.requestId) return
      const pending = this.#pending.get(message.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.#pending.delete(message.requestId)
      if (message.ok) pending.resolve(message.result ?? {})
      else
        pending.reject(
          new Error(message.error?.code ?? "serial_bridge_command_failed")
        )
      return
    }

    const expected = this.#expectedSequence.get(message.sessionId)
    if (expected === undefined || message.seq !== expected) {
      this.#expectedSequence.delete(message.sessionId)
      this.#emitDisconnect({
        sessionId: message.sessionId,
        seq: message.seq,
        reason: "sequence_gap",
      })
      return
    }
    this.#expectedSequence.set(message.sessionId, expected + 1)

    if (message.type === "disconnected") {
      this.#expectedSequence.delete(message.sessionId)
      this.#emitDisconnect(message)
      return
    }

    const bytes = decodeBase64(message.payloadBase64)
    for (const listener of this.#dataListeners) {
      listener({ sessionId: message.sessionId, seq: message.seq, bytes })
    }
  }

  #emitDisconnect(event: SerialDisconnectEvent): void {
    for (const listener of this.#disconnectListeners) listener(event)
  }

  #handleExit(_code: number): void {
    this.#child = undefined
    this.#ready?.reject(new Error("serial_bridge_exited"))
    this.#ready = undefined
    this.#failAll("serial_bridge_exited")
    if (!this.#stopping) {
      for (const sessionId of this.#expectedSequence.keys()) {
        this.#emitDisconnect({
          sessionId,
          seq: this.#expectedSequence.get(sessionId) ?? 0,
          reason: "serial_bridge_exited",
        })
      }
    }
    this.#expectedSequence.clear()
  }

  #failAll(code: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(code))
    }
    this.#pending.clear()
  }
}

export function resolveSerialBridgePath(explicitPath?: string): string {
  if (explicitPath) return validateExecutable(explicitPath)

  const development = process.env.TAN_STUDIO_DEV === "1"
  const developmentOverride = development
    ? process.env.TAN_STUDIO_SERIAL_BRIDGE_PATH
    : undefined
  if (developmentOverride) return validateExecutable(developmentOverride)

  if (development) {
    for (const variant of ["debug", "release"]) {
      const candidate = resolve(
        import.meta.dirname,
        `../../../serial-bridge/target/${variant}/${EXECUTABLE_PREFIX}`
      )
      if (existsSync(candidate)) return validateExecutable(candidate)
    }
  }

  const sibling = executableCandidates(dirname(process.execPath)).find(
    (candidate) => isSerialBridgeExecutableName(basename(candidate))
  )
  if (sibling) return validateExecutable(sibling)
  throw new Error("serial_bridge_not_found")
}

export function isSerialBridgeExecutableName(value: string): boolean {
  return (
    value === EXECUTABLE_PREFIX ||
    value === `${EXECUTABLE_PREFIX}.exe` ||
    value.startsWith(`${EXECUTABLE_PREFIX}-`)
  )
}

export function parseBridgeMessage(line: Uint8Array): BridgeMessage {
  const parsed: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(line)
  )
  const value = record(parsed)
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error("serial_bridge_protocol_version")
  }
  if (value.type === "ready") return { type: "ready" }
  if (value.type === "response") {
    const requestId: string | null =
      value.requestId === null ? null : requiredIdentifier(value.requestId)
    if (value.ok === true) {
      return {
        type: "response",
        requestId,
        ok: true,
        result: record(value.result),
      }
    }
    const error = record(value.error)
    const code = boundedCode(error.code)
    if (value.ok !== false || !code || typeof error.retryable !== "boolean") {
      throw new Error("serial_bridge_invalid_response")
    }
    return {
      type: "response",
      requestId,
      ok: false,
      error: { code, retryable: error.retryable },
    }
  }
  if (value.type === "data") {
    return {
      type: "data",
      sessionId: requiredIdentifier(value.sessionId),
      seq: requiredInteger(value.seq),
      payloadBase64: requiredBase64(value.payloadBase64),
    }
  }
  if (value.type === "disconnected") {
    return {
      type: "disconnected",
      sessionId: requiredIdentifier(value.sessionId),
      seq: requiredInteger(value.seq),
      reason: requiredCode(value.reason),
    }
  }
  throw new Error("serial_bridge_unknown_message")
}

async function* readLines(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  let buffer: number[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const byte of value) {
        if (byte === 0x0a) {
          if (buffer.at(-1) === 0x0d) buffer.pop()
          yield Uint8Array.from(buffer)
          buffer = []
        } else {
          buffer.push(byte)
          if (buffer.length > maximumBytes) {
            throw new Error("serial_bridge_line_too_large")
          }
        }
      }
    }
    if (buffer.length > 0) throw new Error("serial_bridge_unterminated_line")
  } finally {
    reader.releaseLock()
  }
}

function parseCandidate(value: unknown): SerialCandidate {
  const candidate = record(value)
  const candidateId = boundedIdentifier(candidate.candidateId)
  const kind = candidate.kind
  if (
    !candidateId ||
    !["usb", "pci", "bluetooth", "unknown"].includes(String(kind))
  ) {
    throw new Error("serial_bridge_invalid_candidate")
  }
  return {
    candidateId,
    vendorId: nullableUint16(candidate.vendorId),
    productId: nullableUint16(candidate.productId),
    kind: kind as SerialCandidate["kind"],
  }
}

function validateExecutable(path: string): string {
  if (!isAbsolute(path)) throw new Error("serial_bridge_path_not_absolute")
  const canonical = realpathSync(path)
  if (!statSync(canonical).isFile()) throw new Error("serial_bridge_not_file")
  return canonical
}

function executableCandidates(directory: string): string[] {
  try {
    return readdirSync(directory).map((entry) => resolve(directory, entry))
  } catch {
    return []
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("serial_bridge_expected_object")
  }
  return value as Record<string, unknown>
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function requiredInteger(value: unknown): number {
  const parsed = integer(value)
  if (parsed === undefined) throw new Error("serial_bridge_expected_integer")
  return parsed
}

function nullableUint16(value: unknown): number | null {
  if (value === null) return null
  const parsed = integer(value)
  if (parsed === undefined || parsed > 0xffff) {
    throw new Error("serial_bridge_expected_uint16")
  }
  return parsed
}

function boundedIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value
    : undefined
}

function requiredIdentifier(value: unknown): string {
  const parsed = boundedIdentifier(value)
  if (!parsed) throw new Error("serial_bridge_expected_identifier")
  return parsed
}

function boundedCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : undefined
}

function requiredCode(value: unknown): string {
  const parsed = boundedCode(value)
  if (!parsed) throw new Error("serial_bridge_expected_code")
  return parsed
}

function requiredBase64(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 * 1024 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error("serial_bridge_expected_base64")
  }
  return value
}

function decodeBase64(value: string): Uint8Array {
  const decoded = Buffer.from(requiredBase64(value), "base64")
  if (decoded.length === 0 || decoded.length > 64 * 1024) {
    throw new Error("serial_bridge_invalid_payload")
  }
  return new Uint8Array(decoded)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  code: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  try {
    while (!(await reader.read()).done) {
      // The bridge never forwards raw errors or device data on stderr.
    }
  } finally {
    reader.releaseLock()
  }
}
