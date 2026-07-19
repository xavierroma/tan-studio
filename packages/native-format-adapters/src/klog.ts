import { parseLosslessNative, scanPhysicalLines } from "./lossless"
import type { LosslessDocument, SourceSpan } from "./types"
import { NativeFormatError } from "./types"

const MAXIMUM_ROWS = 250_000
const MAXIMUM_COLUMNS = 256
const decoder = new TextDecoder("utf-8", { fatal: true })

export type KlogChannelUnit =
  "celsius" | "celsius_per_minute" | "kilowatts" | "rpm" | "unitless"

export type KlogChannel = {
  /** Stable, unique key used by the database and chart API. */
  key: string
  /** Native name with graph prefixes removed. */
  name: string
  /** Exact token from the source header. */
  rawName: string
  sourceIndex: number
  offsetMs: number
  unit: KlogChannelUnit
  hiddenByDefault: boolean
  reusePreviousScale: boolean
  specialProcessing: boolean
}

export type KlogSample = {
  sampleSeq: number
  elapsedMs: number
  values: Readonly<Record<string, number>>
}

export type KlogMetadataEntry = {
  key: string
  value: string
  incidental: boolean
  span: SourceSpan
}

export type KlogEvent = {
  kind:
    | "colour_change"
    | "first_crack"
    | "first_crack_end"
    | "second_crack"
    | "second_crack_end"
    | "roast_end"
    | "anti_beanlock"
  elapsedMs: number
}

export type KlogDiagnostic = {
  severity: "warning" | "error"
  code:
    | "duplicate_channel"
    | "extra_cells"
    | "invalid_incidental"
    | "invalid_number"
    | "invalid_offset"
    | "short_row"
    | "unknown_table_line"
  message: string
  line?: number
}

export type KlogDocument = {
  kind: "kaffelogic-klog"
  parserVersion: 1
  lossless: LosslessDocument
  metadata: readonly KlogMetadataEntry[]
  /** Base properties followed by generic `!key:value` overrides. */
  effectiveMetadata: Readonly<Record<string, string>>
  channels: readonly KlogChannel[]
  samples: readonly KlogSample[]
  events: readonly KlogEvent[]
  delimiter: "tab" | "comma"
  headerLine: number
  diagnostics: readonly KlogDiagnostic[]
}

const EVENT_KEYS = new Set<KlogEvent["kind"]>([
  "colour_change",
  "first_crack",
  "first_crack_end",
  "second_crack",
  "second_crack_end",
  "roast_end",
  "anti_beanlock",
])

/** Parse a Kaffelogic roast log while retaining its original bytes exactly. */
export function parseKlog(input: Uint8Array): KlogDocument {
  const lossless = parseLosslessNative(input)
  if (lossless.encoding === "unknown") {
    throw new NativeFormatError(
      "invalid_utf8",
      "Kaffelogic logs must be valid UTF-8"
    )
  }

  const physicalLines = scanPhysicalLines(input, hasUtf8Bom(input) ? 3 : 0)
  const decoded = physicalLines.map((line) => ({
    line,
    text: decode(input.subarray(line.contentStart, line.contentEnd), line.line),
  }))
  const headerIndex = decoded.findIndex(({ text }) =>
    /^time(?:\t|,)/u.test(text)
  )
  if (headerIndex < 0) {
    throw new NativeFormatError(
      "missing_table",
      "The Kaffelogic log does not contain a time-series header"
    )
  }

  const header = decoded[headerIndex]!
  const delimiterCharacter = header.text.includes("\t") ? "\t" : ","
  const delimiter = delimiterCharacter === "\t" ? "tab" : "comma"
  const headerCells = header.text.split(delimiterCharacter)
  if (headerCells[0] !== "time" || headerCells.length < 2) {
    throw new NativeFormatError(
      "missing_table",
      "The Kaffelogic table header must begin with time",
      header.line.line
    )
  }
  if (headerCells.length > MAXIMUM_COLUMNS) {
    throw new NativeFormatError(
      "table_too_large",
      `Kaffelogic table exceeds ${MAXIMUM_COLUMNS} columns`,
      header.line.line
    )
  }

  const diagnostics: KlogDiagnostic[] = []
  const offsets = parseOffsets(
    decoded[headerIndex - 1]?.text,
    delimiterCharacter,
    headerCells.length - 1,
    decoded[headerIndex - 1]?.line.line,
    diagnostics
  )
  const channels = parseChannels(headerCells.slice(1), offsets, diagnostics)
  const metadata: KlogMetadataEntry[] = []
  const effectiveMetadata: Record<string, string> = Object.create(
    null
  ) as Record<string, string>

  for (const source of decoded.slice(0, headerIndex)) {
    if (/^offsets(?:\t|,)/u.test(source.text) || source.text.length === 0)
      continue
    const property = parseProperty(source.text)
    if (!property) continue
    const entry = {
      key: property.key,
      value: property.value,
      incidental: false,
      span: span(source.line),
    } satisfies KlogMetadataEntry
    metadata.push(entry)
    effectiveMetadata[entry.key] = entry.value
  }

  const samples: KlogSample[] = []
  for (const source of decoded.slice(headerIndex + 1)) {
    if (source.text.length === 0) continue
    if (source.text.startsWith("!")) {
      const property = parseProperty(source.text.slice(1))
      if (!property) {
        diagnostics.push({
          severity: "warning",
          code: "invalid_incidental",
          message: "Ignored malformed incidental override",
          line: source.line.line,
        })
        continue
      }
      const entry = {
        key: property.key,
        value: property.value,
        incidental: true,
        span: span(source.line),
      } satisfies KlogMetadataEntry
      metadata.push(entry)
      effectiveMetadata[entry.key] = entry.value
      continue
    }

    if (samples.length >= MAXIMUM_ROWS) {
      throw new NativeFormatError(
        "table_too_large",
        `Kaffelogic table exceeds ${MAXIMUM_ROWS} samples`,
        source.line.line
      )
    }
    const cells = source.text.split(delimiterCharacter)
    if (cells.length < headerCells.length) {
      diagnostics.push({
        severity: "warning",
        code: "short_row",
        message: `Ignored a row with ${cells.length} cells; expected ${headerCells.length}`,
        line: source.line.line,
      })
      continue
    }

    const trailingCompatibilityCell =
      cells.length === headerCells.length + 1 && cells.at(-1) === ""
    if (cells.length > headerCells.length && !trailingCompatibilityCell) {
      diagnostics.push({
        severity: "warning",
        code: "extra_cells",
        message: `Ignored ${cells.length - headerCells.length} extra table cells`,
        line: source.line.line,
      })
    }
    const elapsedSeconds = compatibilityNumber(
      cells[0] ?? "",
      "time",
      source.line.line,
      diagnostics
    )
    if (!Number.isFinite(elapsedSeconds)) {
      diagnostics.push({
        severity: "warning",
        code: "unknown_table_line",
        message: "Ignored a non-numeric line in the sample stream",
        line: source.line.line,
      })
      continue
    }

    const values: Record<string, number> = Object.create(null) as Record<
      string,
      number
    >
    channels.forEach((channel, channelIndex) => {
      values[channel.key] = compatibilityNumber(
        cells[channelIndex + 1] ?? "",
        channel.rawName,
        source.line.line,
        diagnostics,
        true
      )
    })
    samples.push({
      sampleSeq: samples.length,
      elapsedMs: Math.round(elapsedSeconds * 1_000),
      values,
    })
  }

  const events = [...EVENT_KEYS].flatMap((kind) => {
    const raw = effectiveMetadata[kind]
    if (raw === undefined) return []
    const seconds = Number(raw)
    if (!Number.isFinite(seconds) || seconds <= 0) return []
    return [{ kind, elapsedMs: Math.round(seconds * 1_000) }]
  })

  return {
    kind: "kaffelogic-klog",
    parserVersion: 1,
    lossless,
    metadata,
    effectiveMetadata: Object.freeze(effectiveMetadata),
    channels,
    samples,
    events,
    delimiter,
    headerLine: header.line.line,
    diagnostics,
  }
}

function parseChannels(
  rawNames: readonly string[],
  offsets: readonly number[],
  diagnostics: KlogDiagnostic[]
): KlogChannel[] {
  const occurrences = new Map<string, number>()
  return rawNames.map((rawName, sourceIndex) => {
    let cursor = 0
    let hiddenByDefault = false
    let reusePreviousScale = false
    let specialProcessing = false
    let explicitTemperature = false
    let explicitRor = false
    let explicitFan = false
    while (cursor < rawName.length) {
      const prefix = rawName[cursor]
      if (prefix === "#") hiddenByDefault = true
      else if (prefix === "=") reusePreviousScale = true
      else if (prefix === "~") specialProcessing = true
      else if (prefix === "@") explicitTemperature = true
      else if (prefix === "&") explicitRor = true
      else if (prefix === "^") explicitFan = true
      else break
      cursor += 1
    }
    const name = rawName.slice(cursor) || `channel_${sourceIndex + 1}`
    const occurrence = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, occurrence)
    const key = occurrence === 1 ? name : `${name}__${occurrence}`
    if (occurrence > 1) {
      diagnostics.push({
        severity: "warning",
        code: "duplicate_channel",
        message: `Disambiguated duplicate channel ${name} as ${key}`,
      })
    }
    return {
      key,
      name,
      rawName,
      sourceIndex,
      offsetMs: Math.round((offsets[sourceIndex] ?? 0) * 1_000),
      unit: inferUnit(name, explicitTemperature, explicitRor, explicitFan),
      hiddenByDefault,
      reusePreviousScale,
      specialProcessing,
    }
  })
}

function inferUnit(
  name: string,
  explicitTemperature: boolean,
  explicitRor: boolean,
  explicitFan: boolean
): KlogChannelUnit {
  if (explicitFan || name === "actual_fan_RPM" || name === "fan_speed")
    return "rpm"
  if (
    explicitRor ||
    name === "profile_ROR" ||
    name === "actual_ROR" ||
    name === "desired_ROR"
  )
    return "celsius_per_minute"
  if (
    explicitTemperature ||
    name === "spot_temp" ||
    name === "temp" ||
    name === "mean_temp" ||
    name === "profile"
  )
    return "celsius"
  if (name === "power_kW") return "kilowatts"
  return "unitless"
}

function parseOffsets(
  text: string | undefined,
  delimiter: string,
  expected: number,
  line: number | undefined,
  diagnostics: KlogDiagnostic[]
): number[] {
  if (!text?.startsWith(`offsets${delimiter}`)) return Array(expected).fill(0)
  const cells = text.split(delimiter).slice(1)
  return Array.from({ length: expected }, (_unused, index) => {
    const value = Number(cells[index] ?? "0")
    if (Number.isFinite(value)) return value
    diagnostics.push({
      severity: "warning",
      code: "invalid_offset",
      message: `Channel ${index + 1} has an invalid offset; using zero`,
      ...(line === undefined ? {} : { line }),
    })
    return 0
  })
}

function compatibilityNumber(
  value: string,
  field: string,
  line: number,
  diagnostics: KlogDiagnostic[],
  replaceInvalid = false
): number {
  const parsed = Number(value)
  if (value.trim() !== "" && Number.isFinite(parsed)) return parsed
  if (!replaceInvalid) return Number.NaN
  diagnostics.push({
    severity: "warning",
    code: "invalid_number",
    message: `Replaced invalid ${field} value with zero for Studio compatibility`,
    line,
  })
  return 0
}

function parseProperty(text: string): { key: string; value: string } | null {
  const separator = text.indexOf(":")
  if (separator <= 0) return null
  return { key: text.slice(0, separator), value: text.slice(separator + 1) }
}

function decode(input: Uint8Array, line: number): string {
  try {
    return decoder.decode(input)
  } catch {
    throw new NativeFormatError(
      "invalid_utf8",
      `Kaffelogic log line ${line} is not valid UTF-8`,
      line
    )
  }
}

function span(line: {
  contentStart: number
  endingEnd: number
  line: number
}): SourceSpan {
  return {
    byteStart: line.contentStart,
    byteEnd: line.endingEnd,
    line: line.line,
    column: 1,
  }
}

function hasUtf8Bom(input: Uint8Array): boolean {
  return input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
}
