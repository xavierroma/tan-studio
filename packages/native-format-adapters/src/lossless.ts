import type {
  FormatDiagnostic,
  LosslessDocument,
  LosslessNode,
  LosslessParseOptions,
  LosslessSemanticView,
  NativeEdit,
  PropertyNode,
  SemanticProperty,
  SerializeResult,
  SourceSpan,
} from "./types"
import { NativeFormatError } from "./types"

const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf)
const DEFAULT_MAXIMUM_FILE_BYTES = 64 * 1024 * 1024
const DEFAULT_MAXIMUM_LINE_BYTES = 1024 * 1024
const DEFAULT_MAXIMUM_PROPERTIES = 1_000
const COLON = 0x3a
const SPACE = 0x20
const TAB = 0x09
const CARRIAGE_RETURN = 0x0d
const LINE_FEED = 0x0a

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true })

export function parseLosslessNative(
  input: Uint8Array,
  options: LosslessParseOptions = {}
): LosslessDocument {
  const maximumFileBytes = positiveLimit(
    options.maximumFileBytes ?? DEFAULT_MAXIMUM_FILE_BYTES,
    "maximumFileBytes"
  )
  const maximumLineBytes = positiveLimit(
    options.maximumLineBytes ?? DEFAULT_MAXIMUM_LINE_BYTES,
    "maximumLineBytes"
  )
  const maximumProperties = positiveLimit(
    options.maximumProperties ?? DEFAULT_MAXIMUM_PROPERTIES,
    "maximumProperties"
  )
  if (input.byteLength > maximumFileBytes) {
    throw new NativeFormatError(
      "file_too_large",
      `Native file exceeds ${maximumFileBytes} bytes`
    )
  }

  const originalBytes = input.slice()
  const hasBom = startsWithBytes(originalBytes, UTF8_BOM)
  const contentStart = hasBom ? UTF8_BOM.length : 0
  const diagnostics: FormatDiagnostic[] = []
  let encoding: LosslessDocument["encoding"] = hasBom ? "utf-8-bom" : "utf-8"
  try {
    fatalUtf8Decoder.decode(originalBytes.subarray(contentStart))
  } catch {
    encoding = "unknown"
    diagnostics.push({
      severity: "error",
      code: "invalid_utf8",
      message:
        "The source contains invalid UTF-8; raw bytes were retained unchanged",
    })
  }

  const lines = scanPhysicalLines(originalBytes, contentStart, maximumLineBytes)
  const nodes: LosslessNode[] = []
  const semanticProperties: SemanticProperty[] = []
  const lastValueByKey: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >
  let propertyCount = 0

  for (const line of lines) {
    const rawLine = originalBytes.subarray(line.contentStart, line.endingEnd)
    const rawContent = originalBytes.subarray(
      line.contentStart,
      line.contentEnd
    )
    const span = sourceSpan(line.contentStart, line.endingEnd, line.line)

    if (rawContent.length === 0) {
      nodes.push({ kind: "blank", raw: rawLine, span })
      continue
    }

    const colonOffset = rawContent.indexOf(COLON)
    if (colonOffset <= 0) {
      nodes.push({ kind: "unknown", raw: rawLine, span })
      continue
    }

    propertyCount += 1
    if (propertyCount > maximumProperties) {
      throw new NativeFormatError(
        "too_many_properties",
        `Native file contains more than ${maximumProperties} properties`,
        line.line
      )
    }

    let separatorEnd = colonOffset + 1
    while (
      separatorEnd < rawContent.length &&
      (rawContent[separatorEnd] === SPACE || rawContent[separatorEnd] === TAB)
    ) {
      separatorEnd += 1
    }
    const valueStart = line.contentStart + separatorEnd
    const node: PropertyNode = {
      kind: "property",
      rawKey: originalBytes.subarray(
        line.contentStart,
        line.contentStart + colonOffset
      ),
      separator: originalBytes.subarray(
        line.contentStart + colonOffset,
        valueStart
      ),
      rawValue: originalBytes.subarray(valueStart, line.contentEnd),
      ending: originalBytes.subarray(line.contentEnd, line.endingEnd),
      span,
      valueSpan: sourceSpan(
        valueStart,
        line.contentEnd,
        line.line,
        separatorEnd + 1
      ),
    }
    const nodeIndex = nodes.length
    nodes.push(node)

    if (encoding !== "unknown") {
      const key = decodeUtf8(node.rawKey)
      const value = decodeUtf8(node.rawValue)
      semanticProperties.push({ key, value, nodeIndex })
      lastValueByKey[key] = value
    }
  }

  const semanticView: LosslessSemanticView = {
    properties: semanticProperties,
    lastValueByKey: Object.freeze(lastValueByKey),
  }

  return {
    sourceHash: new Bun.CryptoHasher("sha256")
      .update(originalBytes)
      .digest("hex"),
    originalBytes,
    encoding,
    lineEnding: classifyLineEnding(lines),
    nodes,
    semanticView,
    diagnostics,
  }
}

export function serializeLosslessNative(
  document: LosslessDocument,
  edits: readonly NativeEdit[] = []
): SerializeResult {
  if (edits.length === 0) {
    return { bytes: document.originalBytes.slice(), changes: [] }
  }

  const replacements = edits
    .map((edit) => {
      const node = document.nodes[edit.nodeIndex]
      if (edit.kind !== "replace_property_value" || node?.kind !== "property") {
        throw new NativeFormatError(
          "invalid_edit",
          `Node ${edit.nodeIndex} is not an editable property`
        )
      }
      if (
        edit.value.some(
          (byte) => byte === CARRIAGE_RETURN || byte === LINE_FEED
        )
      ) {
        throw new NativeFormatError(
          "invalid_edit",
          "Property replacements cannot contain line-ending bytes",
          node.span.line
        )
      }
      return {
        nodeIndex: edit.nodeIndex,
        byteStart: node.valueSpan.byteStart,
        byteEnd: node.valueSpan.byteEnd,
        replacement: edit.value,
      }
    })
    .sort((left, right) => left.byteStart - right.byteStart)

  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1]
    const current = replacements[index]
    if (previous === undefined || current === undefined) continue
    if (
      previous.byteEnd > current.byteStart ||
      previous.nodeIndex === current.nodeIndex
    ) {
      throw new NativeFormatError(
        "invalid_edit",
        "Native edits overlap or target a node twice"
      )
    }
  }

  const totalLength =
    document.originalBytes.length +
    replacements.reduce(
      (sum, replacement) =>
        sum +
        replacement.replacement.length -
        (replacement.byteEnd - replacement.byteStart),
      0
    )
  const bytes = new Uint8Array(totalLength)
  let sourceOffset = 0
  let targetOffset = 0
  for (const replacement of replacements) {
    const untouched = document.originalBytes.subarray(
      sourceOffset,
      replacement.byteStart
    )
    bytes.set(untouched, targetOffset)
    targetOffset += untouched.length
    bytes.set(replacement.replacement, targetOffset)
    targetOffset += replacement.replacement.length
    sourceOffset = replacement.byteEnd
  }
  bytes.set(document.originalBytes.subarray(sourceOffset), targetOffset)

  return {
    bytes,
    changes: replacements.map((replacement) => ({
      nodeIndex: replacement.nodeIndex,
      byteStart: replacement.byteStart,
      byteEnd: replacement.byteEnd,
      replacementBytes: replacement.replacement.length,
    })),
  }
}

export type PhysicalLine = {
  line: number
  contentStart: number
  contentEnd: number
  endingEnd: number
  ending: "none" | "lf" | "crlf" | "cr"
}

export function scanPhysicalLines(
  input: Uint8Array,
  contentStart = 0,
  maximumLineBytes = DEFAULT_MAXIMUM_LINE_BYTES
): readonly PhysicalLine[] {
  if (
    !Number.isSafeInteger(contentStart) ||
    contentStart < 0 ||
    contentStart > input.length
  ) {
    throw new RangeError("contentStart must be a valid byte offset")
  }
  positiveLimit(maximumLineBytes, "maximumLineBytes")
  const lines: PhysicalLine[] = []
  let cursor = contentStart
  let lineNumber = 1

  while (cursor < input.length) {
    const lineStart = cursor
    while (
      cursor < input.length &&
      input[cursor] !== CARRIAGE_RETURN &&
      input[cursor] !== LINE_FEED
    ) {
      cursor += 1
      if (cursor - lineStart > maximumLineBytes) {
        throw new NativeFormatError(
          "line_too_large",
          `Line ${lineNumber} exceeds ${maximumLineBytes} bytes`,
          lineNumber
        )
      }
    }

    const contentEnd = cursor
    let ending: PhysicalLine["ending"] = "none"
    if (input[cursor] === CARRIAGE_RETURN && input[cursor + 1] === LINE_FEED) {
      ending = "crlf"
      cursor += 2
    } else if (input[cursor] === CARRIAGE_RETURN) {
      ending = "cr"
      cursor += 1
    } else if (input[cursor] === LINE_FEED) {
      ending = "lf"
      cursor += 1
    }

    lines.push({
      line: lineNumber,
      contentStart: lineStart,
      contentEnd,
      endingEnd: cursor,
      ending,
    })
    lineNumber += 1
  }

  return lines
}

function classifyLineEnding(
  lines: readonly PhysicalLine[]
): LosslessDocument["lineEnding"] {
  const endings = new Set(
    lines.map((line) => line.ending).filter((ending) => ending !== "none")
  )
  if (endings.size === 0) return "none"
  if (endings.size > 1) return "mixed"
  return [...endings][0] ?? "none"
}

function sourceSpan(
  byteStart: number,
  byteEnd: number,
  line: number,
  column = 1
): SourceSpan {
  return { byteStart, byteEnd, line, column }
}

function startsWithBytes(input: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => input[index] === byte)
}

function decodeUtf8(input: Uint8Array): string {
  return fatalUtf8Decoder.decode(input)
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}
