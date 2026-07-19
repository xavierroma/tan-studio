import { crc16CcittXmodem, formatCrc16 } from "./crc"

const ASCII_MINIMUM = 0x20
const ASCII_MAXIMUM = 0x7e
const DEFAULT_MAXIMUM_FRAME_BYTES = 16 * 1024

const encoder = new TextEncoder()

export type EncodeSassiFrameInput = {
  type: number
  elapsedMs: number
  fields?: readonly string[]
  crcSeed: number
  maximumFrameBytes?: number
}

export type TimeSyncFrameInput = {
  elapsedMs: number
  crcSeed: number
  now?: Date
  maximumFrameBytes?: number
}

export type InfoRequestFrameInput = {
  elapsedMs: number
  crcSeed: number
  infoCode: number
  maximumFrameBytes?: number
}

export type ReadOnlyFilesystemFrameInput = {
  elapsedMs: number
  crcSeed: number
  path: string
  maximumFrameBytes?: number
}

export type AcknowledgementFrameInput = {
  elapsedMs: number
  crcSeed: number
  maximumFrameBytes?: number
}

/** Encode a CR-terminated SASSI frame using the negotiated seeded CRC. */
export function encodeSassiFrame(input: EncodeSassiFrameInput): Uint8Array {
  assertInteger(input.type, "type", 0, 255)
  assertInteger(input.elapsedMs, "elapsedMs", 0, Number.MAX_SAFE_INTEGER)
  assertInteger(input.crcSeed, "crcSeed", 0, 0xffff)
  const maximumFrameBytes =
    input.maximumFrameBytes ?? DEFAULT_MAXIMUM_FRAME_BYTES
  assertInteger(maximumFrameBytes, "maximumFrameBytes", 1, 16 * 1024 * 1024)

  const fields = input.fields ?? []
  for (const field of fields) assertField(field)

  const elapsed = input.elapsedMs.toString(16).toLowerCase()
  const payload = fields.length === 0 ? "" : `${fields.join("|")}|`
  const body = `KL*${input.type}|${elapsed}|${payload}`
  const bodyBytes = encoder.encode(body)
  const crc = formatCrc16(
    crc16CcittXmodem(bodyBytes, input.crcSeed)
  ).toLowerCase()
  const frame = encoder.encode(`${body}${crc}\r`)
  if (frame.length > maximumFrameBytes) {
    throw new RangeError(`SASSI frame exceeds ${maximumFrameBytes} bytes`)
  }
  return frame
}

/** Official host-computer type-3 handshake used by Studio 7.4.3. */
export function encodeTimeSyncFrame(input: TimeSyncFrameInput): Uint8Array {
  return encodeSassiFrame({
    type: 3,
    elapsedMs: input.elapsedMs,
    fields: [
      "10",
      String(1 << 8),
      formatSassiUtcDate(input.now ?? new Date()),
      "1",
    ],
    crcSeed: input.crcSeed,
    ...(input.maximumFrameBytes === undefined
      ? {}
      : { maximumFrameBytes: input.maximumFrameBytes }),
  })
}

/** Read-only type-13 query; it cannot mutate roaster state. */
export function encodeInfoRequestFrame(
  input: InfoRequestFrameInput
): Uint8Array {
  assertInteger(input.infoCode, "infoCode", 0, 0xffff)
  return encodeSassiFrame({
    type: 13,
    elapsedMs: input.elapsedMs,
    fields: ["", String(input.infoCode)],
    crcSeed: input.crcSeed,
    ...(input.maximumFrameBytes === undefined
      ? {}
      : { maximumFrameBytes: input.maximumFrameBytes }),
  })
}

/** Read-only type-5 directory inventory request in Studio format 1. */
export function encodeDirectoryListFrame(
  input: ReadOnlyFilesystemFrameInput
): Uint8Array {
  return encodeSassiFrame({
    type: 5,
    elapsedMs: input.elapsedMs,
    fields: [input.path, "", "1"],
    crcSeed: input.crcSeed,
    ...(input.maximumFrameBytes === undefined
      ? {}
      : { maximumFrameBytes: input.maximumFrameBytes }),
  })
}

/** Read-only type-7 native-file request. */
export function encodeFileRequestFrame(
  input: ReadOnlyFilesystemFrameInput
): Uint8Array {
  return encodeSassiFrame({
    type: 7,
    elapsedMs: input.elapsedMs,
    fields: [input.path],
    crcSeed: input.crcSeed,
    ...(input.maximumFrameBytes === undefined
      ? {}
      : { maximumFrameBytes: input.maximumFrameBytes }),
  })
}

/** Type-1 packet acknowledgement used between inbound transfer chunks. */
export function encodeAcknowledgementFrame(
  input: AcknowledgementFrameInput
): Uint8Array {
  return encodeSassiFrame({
    type: 1,
    elapsedMs: input.elapsedMs,
    crcSeed: input.crcSeed,
    ...(input.maximumFrameBytes === undefined
      ? {}
      : { maximumFrameBytes: input.maximumFrameBytes }),
  })
}

export function formatSassiUtcDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError("date must be valid")
  return [
    value.getUTCFullYear().toString().padStart(4, "0"),
    (value.getUTCMonth() + 1).toString().padStart(2, "0"),
    value.getUTCDate().toString().padStart(2, "0"),
    String(value.getUTCDay()),
    value.getUTCHours().toString().padStart(2, "0"),
    value.getUTCMinutes().toString().padStart(2, "0"),
    value.getUTCSeconds().toString().padStart(2, "0"),
  ].join("")
}

function assertField(value: string): void {
  if (typeof value !== "string")
    throw new TypeError("SASSI fields must be strings")
  const bytes = encoder.encode(value)
  if (
    value.includes("|") ||
    value.includes("\r") ||
    bytes.some((byte) => byte < ASCII_MINIMUM || byte > ASCII_MAXIMUM)
  ) {
    throw new TypeError(
      "SASSI fields must contain printable ASCII without delimiters"
    )
  }
}

function assertInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer from ${minimum} through ${maximum}`
    )
  }
}
