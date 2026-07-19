import { crc16CcittXmodem } from "./crc"
import type {
  DecodeSassiFrameResult,
  DecodedSassiMessage,
  NegotiatedSassiLimits,
  SassiCodecEvent,
  SassiCodecFailure,
  SassiDecoderOptions,
  Type14InfoResponse,
  Type2ConnectionRequest,
  Type30StatusNotification,
  Type32IncrementalFileChunk,
  Type4TimeSyncAcknowledgement,
  Type6DirectoryListChunk,
  Type8FileChunk,
} from "./types"

const FRAME_TERMINATOR = 0x0d
const DEFAULT_PRE_HANDSHAKE_MAXIMUM_BYTES = 512
const NEGOTIATED_FRAME_OVERHEAD_BYTES = 64
const ABSOLUTE_MAXIMUM_PACKET_BYTES = 16 * 1024 * 1024
const MAXIMUM_DIAGNOSTIC_CHARACTERS = 256
const ASCII_MINIMUM = 0x20
const ASCII_MAXIMUM = 0x7e

const asciiEncoder = new TextEncoder()

export class SassiDecoder {
  readonly #preHandshakeMaximumBytes: number
  #negotiatedMaximumPacketBytes: number | undefined
  #negotiatedCrcSeed: number | undefined
  #buffer: number[] = []
  #discardUntilTerminator = false

  constructor(options: SassiDecoderOptions = {}) {
    this.#preHandshakeMaximumBytes = validateMaximum(
      options.preHandshakeMaximumBytes ?? DEFAULT_PRE_HANDSHAKE_MAXIMUM_BYTES,
      "preHandshakeMaximumBytes"
    )

    if (options.negotiatedMaximumPacketBytes !== undefined) {
      this.#negotiatedMaximumPacketBytes = validateMaximum(
        options.negotiatedMaximumPacketBytes,
        "negotiatedMaximumPacketBytes"
      )
    }
    if (options.negotiatedCrcSeed !== undefined) {
      this.#negotiatedCrcSeed = validateUint16(
        options.negotiatedCrcSeed,
        "negotiatedCrcSeed"
      )
    }
  }

  setNegotiatedLimits(limits: NegotiatedSassiLimits): void {
    this.#negotiatedMaximumPacketBytes = validateMaximum(
      limits.maximumPacketBytes,
      "maximumPacketBytes"
    )
    this.#negotiatedCrcSeed = validateUint16(limits.crcSeed, "crcSeed")
  }

  reset(): void {
    this.#buffer = []
    this.#discardUntilTerminator = false
    this.#negotiatedMaximumPacketBytes = undefined
    this.#negotiatedCrcSeed = undefined
  }

  push(chunk: Uint8Array): readonly SassiCodecEvent[] {
    const events: SassiCodecEvent[] = []

    for (const byte of chunk) {
      if (this.#discardUntilTerminator) {
        if (byte === FRAME_TERMINATOR) {
          this.#discardUntilTerminator = false
        }
        continue
      }

      if (byte === FRAME_TERMINATOR) {
        const frame = Uint8Array.from([...this.#buffer, FRAME_TERMINATOR])
        this.#buffer = []
        const result = decodeSassiFrame(
          frame,
          this.#negotiatedCrcSeed === undefined
            ? { maximumFrameBytes: this.#maximumFrameBytes }
            : {
                maximumFrameBytes: this.#maximumFrameBytes,
                negotiatedCrcSeed: this.#negotiatedCrcSeed,
              }
        )
        events.push(
          result.ok
            ? { kind: "message", message: result.message }
            : { kind: "error", error: result.error }
        )
        continue
      }

      this.#buffer.push(byte)
      if (this.#buffer.length + 1 > this.#maximumFrameBytes) {
        events.push({
          kind: "error",
          error: failure(
            "too_large",
            `SASSI frame exceeds ${this.#maximumFrameBytes} bytes`,
            this.#buffer
          ),
        })
        this.#buffer = []
        this.#discardUntilTerminator = true
      }
    }

    return events
  }

  finish(): readonly SassiCodecEvent[] {
    if (this.#discardUntilTerminator || this.#buffer.length === 0) {
      this.reset()
      return []
    }

    const event: SassiCodecEvent = {
      kind: "error",
      error: failure(
        "malformed_syntax",
        "SASSI stream ended before a carriage-return terminator",
        this.#buffer
      ),
    }
    this.reset()
    return [event]
  }

  get bufferedBytes(): number {
    return this.#buffer.length
  }

  get #maximumFrameBytes(): number {
    return this.#negotiatedMaximumPacketBytes === undefined
      ? this.#preHandshakeMaximumBytes
      : this.#negotiatedMaximumPacketBytes + NEGOTIATED_FRAME_OVERHEAD_BYTES
  }
}

type DecodeFrameOptions = {
  maximumFrameBytes?: number
  negotiatedCrcSeed?: number
}

export function decodeSassiFrame(
  frame: Uint8Array,
  options: DecodeFrameOptions = {}
): DecodeSassiFrameResult {
  const maximumFrameBytes = validateMaximum(
    options.maximumFrameBytes ?? DEFAULT_PRE_HANDSHAKE_MAXIMUM_BYTES,
    "maximumFrameBytes",
    ABSOLUTE_MAXIMUM_PACKET_BYTES + NEGOTIATED_FRAME_OVERHEAD_BYTES
  )
  if (frame.length > maximumFrameBytes) {
    return {
      ok: false,
      error: failure(
        "too_large",
        `SASSI frame exceeds ${maximumFrameBytes} bytes`,
        frame
      ),
    }
  }
  if (frame.length === 0 || frame.at(-1) !== FRAME_TERMINATOR) {
    return {
      ok: false,
      error: failure(
        "malformed_syntax",
        "SASSI frame is missing its carriage-return terminator",
        frame
      ),
    }
  }

  const body = frame.subarray(0, -1)
  if (body.length === 0 || hasNonPrintableAscii(body)) {
    return {
      ok: false,
      error: failure(
        "malformed_syntax",
        "SASSI frames must contain printable ASCII bytes",
        frame
      ),
    }
  }

  const text = asciiFromBytes(body)
  if (!text.startsWith("KL*")) {
    return {
      ok: false,
      error: failure("malformed_syntax", "Invalid SASSI frame prefix", frame),
    }
  }

  const finalSeparator = text.lastIndexOf("|")
  if (finalSeparator < 0) {
    return {
      ok: false,
      error: failure(
        "malformed_syntax",
        "SASSI frame has no CRC separator",
        frame
      ),
    }
  }
  const suppliedCrcText = text.slice(finalSeparator + 1)
  if (!/^[0-9a-fA-F]{4}$/.test(suppliedCrcText)) {
    return {
      ok: false,
      error: failure(
        "malformed_syntax",
        "SASSI CRC must be four hexadecimal digits",
        frame
      ),
    }
  }

  const payloadText = text.slice(3, finalSeparator)
  const tokens = payloadText.split("|")
  if (tokens.length < 2) {
    return {
      ok: false,
      error: failure(
        "malformed_syntax",
        "SASSI type or elapsed field is missing",
        frame
      ),
    }
  }

  const [typeText, elapsedText, ...fields] = tokens
  if (typeText === undefined || !/^(0|[1-9][0-9]*)$/.test(typeText)) {
    return {
      ok: false,
      error: failure("malformed_syntax", "SASSI type must be decimal", frame),
    }
  }
  const type = Number(typeText)
  if (!Number.isSafeInteger(type)) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type is outside the safe integer range",
        frame
      ),
    }
  }
  if (elapsedText === undefined || !/^[0-9a-fA-F]+$/.test(elapsedText)) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI elapsed time must be hexadecimal",
        frame
      ),
    }
  }
  const elapsedMs = Number.parseInt(elapsedText, 16)
  if (!Number.isSafeInteger(elapsedMs)) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI elapsed time is outside the safe integer range",
        frame
      ),
    }
  }

  const parsedKnown = parseKnownMessage(type, fields)
  if (parsedKnown !== undefined && !parsedKnown.ok) {
    return parsedKnown
  }

  const crcSeed =
    parsedKnown?.ok === true && parsedKnown.value.kind === "connection_request"
      ? parsedKnown.value.crcSeed
      : (validateOptionalUint16(options.negotiatedCrcSeed) ?? 0)
  const crcInput = body.subarray(0, finalSeparator + 1)
  const actualCrc = crc16CcittXmodem(crcInput, crcSeed)
  const suppliedCrc = Number.parseInt(suppliedCrcText, 16)
  if (actualCrc !== suppliedCrc) {
    return {
      ok: false,
      error: failure(
        "invalid_crc",
        "SASSI frame failed CRC validation",
        type === 2
          ? redactedType2Diagnostic(tokens)
          : genericDiagnostic(type, fields.length, false)
      ),
    }
  }

  if (parsedKnown?.ok === true) {
    const message: DecodedSassiMessage = {
      type,
      elapsedMs,
      fields:
        parsedKnown.value.kind === "connection_request"
          ? redactType2Fields(fields)
          : fields,
      evidence:
        type === 6 || type === 8 || type === 30 || type === 32
          ? "static_inferred"
          : "live_verified",
      parsed: parsedKnown.value,
      diagnostics: [],
      diagnosticFrame:
        parsedKnown.value.kind === "connection_request"
          ? redactedType2Diagnostic(tokens)
          : genericDiagnostic(type, fields.length, true),
    }
    return { ok: true, message }
  }

  return {
    ok: true,
    message: {
      type,
      elapsedMs,
      fields,
      evidence: "unknown_passthrough",
      parsed: { kind: "unknown", type },
      diagnostics: [
        {
          code: "unsupported_type",
          message: `SASSI type ${type} has no trusted decoder`,
        },
      ],
      diagnosticFrame: genericDiagnostic(type, fields.length, true),
    },
  }
}

type Type2ParseResult =
  | { ok: true; value: Type2ConnectionRequest }
  | { ok: false; error: SassiCodecFailure }

type KnownParseResult =
  | {
      ok: true
      value:
        | Type2ConnectionRequest
        | Type4TimeSyncAcknowledgement
        | Type6DirectoryListChunk
        | Type8FileChunk
        | Type14InfoResponse
        | Type30StatusNotification
        | Type32IncrementalFileChunk
    }
  | { ok: false; error: SassiCodecFailure }

function parseKnownMessage(
  type: number,
  fields: readonly string[]
): KnownParseResult | undefined {
  if (type === 2) return parseType2(fields)
  if (type === 4) {
    return fields.length === 0
      ? { ok: true, value: { kind: "time_sync_ack" } }
      : {
          ok: false,
          error: failure(
            "invalid_field",
            "SASSI type 4 must not contain payload fields",
            genericDiagnostic(type, fields.length, false)
          ),
        }
  }
  if (type === 6) return parseTransferChunk(type, fields, "directory")
  if (type === 8) return parseTransferChunk(type, fields, "file")
  if (type === 14) {
    if (fields.length !== 2) {
      return {
        ok: false,
        error: failure(
          "invalid_field",
          "SASSI type 14 must contain data and info-code fields",
          genericDiagnostic(type, fields.length, false)
        ),
      }
    }
    const [data, codeText] = fields
    const infoCode = parseDecimalField(codeText, "info code", 0xffff)
    return data !== undefined && infoCode !== undefined
      ? {
          ok: true,
          value: { kind: "info_response", data, infoCode },
        }
      : {
          ok: false,
          error: failure(
            "invalid_field",
            "SASSI type 14 contains an invalid info code",
            genericDiagnostic(type, fields.length, false)
          ),
        }
  }
  if (type === 30) {
    if (fields.length !== 2) {
      return invalidKnown(type, fields, "data and info-code fields")
    }
    const [data, codeText] = fields
    const infoCode = parseDecimalField(codeText, "info code", 0xffff)
    return data !== undefined && infoCode !== undefined
      ? {
          ok: true,
          value: { kind: "status_notification", data, infoCode },
        }
      : invalidKnown(type, fields, "a valid info code")
  }
  if (type === 32) return parseTransferChunk(type, fields, "incremental")
  return undefined
}

function parseTransferChunk(
  type: 6 | 8 | 32,
  fields: readonly string[],
  transfer: "directory" | "file" | "incremental"
): KnownParseResult {
  if (fields.length !== 5) {
    return invalidKnown(type, fields, "five transfer fields")
  }
  const [path, outcomeText, third, sequenceText, base64Data] = fields
  const combinedOutcome = parseDecimalField(outcomeText, "outcome", 0xff)
  // Error responses use sequence zero and an empty data field. Successful
  // streams still begin at one and are enforced by the session actor.
  const sequence = parseDecimalField(sequenceText, "sequence", 0xffff_ffff, 0)
  if (
    path === undefined ||
    third === undefined ||
    base64Data === undefined ||
    combinedOutcome === undefined ||
    sequence === undefined ||
    !isBase64(base64Data)
  ) {
    return invalidKnown(type, fields, "valid transfer fields")
  }
  const final = (combinedOutcome & 0x80) !== 0
  const outcome = combinedOutcome & 0x7f
  if (transfer === "directory") {
    const format = parseDecimalField(third, "directory format", 0xffff)
    return format === undefined
      ? invalidKnown(type, fields, "a valid directory format")
      : {
          ok: true,
          value: {
            kind: "directory_list_chunk",
            path,
            outcome,
            final,
            format,
            sequence,
            base64Data,
          },
        }
  }
  const value = {
    path,
    outcome,
    final,
    modifiedAt: third,
    sequence,
    base64Data,
  }
  return transfer === "file"
    ? { ok: true, value: { kind: "file_chunk", ...value } }
    : { ok: true, value: { kind: "incremental_file_chunk", ...value } }
}

function invalidKnown(
  type: number,
  fields: readonly string[],
  expected: string
): KnownParseResult {
  return {
    ok: false,
    error: failure(
      "invalid_field",
      `SASSI type ${type} must contain ${expected}`,
      genericDiagnostic(type, fields.length, false)
    ),
  }
}

function isBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value
    )
  )
}

function parseType2(fields: readonly string[]): Type2ParseResult {
  if (fields.length !== 10) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type 2 must contain exactly ten payload fields",
        redactedType2Diagnostic(["2", "?", ...fields])
      ),
    }
  }

  const [
    platformText,
    capabilityText,
    serial,
    versionText,
    model,
    manufacturerDomain,
    description,
    maximumPacketText,
    maximumFilenameText,
    crcSeedText,
  ] = fields

  const platform = parseDecimalField(platformText, "platform", 0xffff)
  const capabilityBits = parseDecimalField(
    capabilityText,
    "capabilities",
    0xffff_ffff
  )
  const sassiVersion = parseDecimalField(versionText, "SASSI version", 0xffff)
  const maximumPacketBytes = parseDecimalField(
    maximumPacketText,
    "maximum packet bytes",
    ABSOLUTE_MAXIMUM_PACKET_BYTES,
    1
  )
  const maximumFilenameBytes = parseDecimalField(
    maximumFilenameText,
    "maximum filename bytes",
    4096,
    1
  )
  if (
    platform === undefined ||
    capabilityBits === undefined ||
    sassiVersion === undefined ||
    maximumPacketBytes === undefined ||
    maximumFilenameBytes === undefined
  ) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type 2 contains an invalid numeric field",
        redactedType2Diagnostic(["2", "?", ...fields])
      ),
    }
  }
  if (serial === undefined || asciiEncoder.encode(serial).length !== 10) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type 2 serial must be exactly ten ASCII bytes",
        redactedType2Diagnostic(["2", "?", ...fields])
      ),
    }
  }
  if (model === undefined || model.length === 0 || model.length > 64) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type 2 model is invalid",
        redactedType2Diagnostic(["2", "?", ...fields])
      ),
    }
  }
  if (
    manufacturerDomain === undefined ||
    !/^[a-z0-9.-]+$/i.test(manufacturerDomain) ||
    !manufacturerDomain.includes(".")
  ) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type 2 manufacturer domain is invalid",
        redactedType2Diagnostic(["2", "?", ...fields])
      ),
    }
  }
  if (
    description === undefined ||
    crcSeedText === undefined ||
    !/^[0-9a-fA-F]{1,4}$/.test(crcSeedText)
  ) {
    return {
      ok: false,
      error: failure(
        "invalid_field",
        "SASSI type 2 CRC seed is invalid",
        redactedType2Diagnostic(["2", "?", ...fields])
      ),
    }
  }

  return {
    ok: true,
    value: {
      kind: "connection_request",
      platform,
      capabilityBits,
      serialBytes: asciiEncoder.encode(serial),
      sassiVersion,
      model,
      manufacturerDomain,
      description,
      maximumPacketBytes,
      maximumFilenameBytes,
      crcSeed: Number.parseInt(crcSeedText, 16),
    },
  }
}

function parseDecimalField(
  value: string | undefined,
  _name: string,
  maximum: number,
  minimum = 0
): number | undefined {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined
}

function failure(
  code: SassiCodecFailure["code"],
  message: string,
  source: Uint8Array | readonly number[] | string
): SassiCodecFailure {
  return {
    code,
    message,
    diagnosticFrame:
      typeof source === "string"
        ? truncateDiagnostic(source)
        : genericByteDiagnostic(source),
  }
}

function redactedType2Diagnostic(tokens: readonly string[]): string {
  const safe = [...tokens]
  // Tokens are type, elapsed, then type-specific fields. Serial is token 4.
  if (safe.length > 4) safe[4] = "<serial:redacted>"
  return truncateDiagnostic(`KL*${safe.join("|")}|<crc:redacted>\\r`)
}

function redactType2Fields(fields: readonly string[]): readonly string[] {
  return fields.map((field, index) =>
    index === 2 ? "<serial:redacted>" : field
  )
}

function genericDiagnostic(
  type: number,
  fieldCount: number,
  crcValid: boolean
): string {
  return `KL*${type}|<${fieldCount} payload fields>|<crc:${crcValid ? "valid" : "invalid"}>\\r`
}

function genericByteDiagnostic(source: Uint8Array | readonly number[]): string {
  const length = source.length
  const prefix: string[] = []
  for (let index = 0; index < Math.min(length, 12); index += 1) {
    const value = source[index]
    if (value === undefined) break
    prefix.push(value.toString(16).padStart(2, "0"))
  }
  return `<redacted frame: ${length} bytes; prefix ${prefix.join(" ")}>`
}

function truncateDiagnostic(value: string): string {
  return value.length <= MAXIMUM_DIAGNOSTIC_CHARACTERS
    ? value
    : `${value.slice(0, MAXIMUM_DIAGNOSTIC_CHARACTERS - 1)}…`
}

function hasNonPrintableAscii(bytes: Uint8Array): boolean {
  return bytes.some((byte) => byte < ASCII_MINIMUM || byte > ASCII_MAXIMUM)
}

function asciiFromBytes(bytes: Uint8Array): string {
  let value = ""
  for (const byte of bytes) value += String.fromCharCode(byte)
  return value
}

function validateMaximum(
  value: number,
  name: string,
  upperBound = ABSOLUTE_MAXIMUM_PACKET_BYTES
): number {
  if (!Number.isInteger(value) || value < 1 || value > upperBound) {
    throw new RangeError(
      `${name} must be an integer from 1 through ${upperBound}`
    )
  }
  return value
}

function validateUint16(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer`)
  }
  return value
}

function validateOptionalUint16(value: number | undefined): number | undefined {
  return value === undefined
    ? undefined
    : validateUint16(value, "negotiatedCrcSeed")
}
