import { parse as parseCsv } from "csv-parse/sync"

import { scanPhysicalLines } from "./lossless"
import type {
  LosslessDocument,
  RawCell,
  SourceSpan,
  StrictTable,
  StrictTableDelimiter,
  StrictTableOptions,
  StrictTableRow,
} from "./types"
import { NativeFormatError } from "./types"

const COMMA = 0x2c
const TAB = 0x09
const DEFAULT_MAXIMUM_ROWS = 250_001
const DEFAULT_MAXIMUM_COLUMNS = 256
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true })

export function parseStrictUnquotedTable(
  document: LosslessDocument,
  options: StrictTableOptions
): StrictTable {
  if (!Number.isSafeInteger(options.startLine) || options.startLine < 1) {
    throw new RangeError("startLine must be a positive one-based line number")
  }
  const maximumRows = positiveLimit(
    options.maximumRows ?? DEFAULT_MAXIMUM_ROWS,
    "maximumRows"
  )
  const maximumColumns = positiveLimit(
    options.maximumColumns ?? DEFAULT_MAXIMUM_COLUMNS,
    "maximumColumns"
  )
  if (options.expectedColumnCount !== undefined) {
    positiveLimit(options.expectedColumnCount, "expectedColumnCount")
  }
  const source = document.originalBytes
  const allLines = scanPhysicalLines(source, hasUtf8Bom(source) ? 3 : 0)
  const selectedLines = allLines.slice(options.startLine - 1)
  const headerLine = selectedLines[0]
  if (headerLine === undefined) {
    throw new NativeFormatError(
      "missing_table",
      `No table exists at line ${options.startLine}`
    )
  }
  if (selectedLines.length > maximumRows) {
    throw new NativeFormatError(
      "table_too_large",
      `Table exceeds ${maximumRows} total records`,
      headerLine.line
    )
  }

  const headerBytes = document.originalBytes.subarray(
    headerLine.contentStart,
    headerLine.contentEnd
  )
  const delimiter =
    options.delimiter ?? detectDelimiter(headerBytes, headerLine.line)
  const delimiterByte = delimiter === "comma" ? COMMA : TAB
  const alternateByte = delimiter === "comma" ? TAB : COMMA
  const parsedRows: StrictTableRow[] = []
  let expectedColumnCount = options.expectedColumnCount

  for (const line of selectedLines) {
    const raw = document.originalBytes.subarray(
      line.contentStart,
      line.contentEnd
    )
    if (raw.length === 0) {
      throw new NativeFormatError(
        "empty_record",
        "Blank table records are not allowed",
        line.line
      )
    }
    if (raw.includes(alternateByte)) {
      throw new NativeFormatError(
        "mixed_delimiters",
        `Line ${line.line} contains both table delimiter families`,
        line.line
      )
    }

    let text: string
    try {
      text = fatalUtf8Decoder.decode(raw)
    } catch {
      throw new NativeFormatError(
        "invalid_utf8",
        `Table line ${line.line} is not valid UTF-8`,
        line.line
      )
    }

    let records: string[][]
    try {
      records = parseCsv(text, {
        bom: false,
        delimiter: delimiter === "comma" ? "," : "\t",
        quote: false,
        relax_column_count: false,
        skip_empty_lines: false,
      }) as string[][]
    } catch (error) {
      throw new NativeFormatError(
        "csv_parse_failed",
        `Strict table parsing failed on line ${line.line}: ${errorMessage(error)}`,
        line.line
      )
    }
    if (records.length !== 1 || records[0] === undefined) {
      throw new NativeFormatError(
        "csv_parse_failed",
        `Line ${line.line} did not produce exactly one table record`,
        line.line
      )
    }
    const values = records[0]
    expectedColumnCount ??= values.length
    if (expectedColumnCount > maximumColumns) {
      throw new NativeFormatError(
        "table_too_large",
        `Table exceeds ${maximumColumns} columns`,
        line.line
      )
    }
    if (values.length !== expectedColumnCount) {
      throw new NativeFormatError(
        "column_count_mismatch",
        `Line ${line.line} has ${values.length} columns; expected ${expectedColumnCount}`,
        line.line
      )
    }

    const cells = rawCells(
      raw,
      values,
      delimiterByte,
      line.contentStart,
      line.line
    )
    parsedRows.push({
      line: line.line,
      raw,
      cells,
      span: span(line.contentStart, line.contentEnd, line.line),
    })
  }

  const [header, ...rows] = parsedRows
  if (header === undefined || expectedColumnCount === undefined) {
    throw new NativeFormatError(
      "missing_table",
      `No table exists at line ${options.startLine}`
    )
  }
  return { delimiter, columnCount: expectedColumnCount, header, rows }
}

function detectDelimiter(raw: Uint8Array, line: number): StrictTableDelimiter {
  const comma = raw.includes(COMMA)
  const tab = raw.includes(TAB)
  if (comma && tab) {
    throw new NativeFormatError(
      "mixed_delimiters",
      "The table header mixes comma and tab delimiters",
      line
    )
  }
  if (!comma && !tab) {
    throw new NativeFormatError(
      "missing_delimiter",
      "The table header contains neither a comma nor a tab delimiter",
      line
    )
  }
  return comma ? "comma" : "tab"
}

function rawCells(
  raw: Uint8Array,
  values: readonly string[],
  delimiter: number,
  absoluteStart: number,
  line: number
): readonly RawCell[] {
  const cells: RawCell[] = []
  let start = 0
  let valueIndex = 0
  for (let cursor = 0; cursor <= raw.length; cursor += 1) {
    if (cursor !== raw.length && raw[cursor] !== delimiter) continue
    const value = values[valueIndex]
    if (value === undefined) {
      throw new NativeFormatError(
        "csv_parse_failed",
        "CSV cell mapping became inconsistent",
        line
      )
    }
    cells.push({
      raw: raw.subarray(start, cursor),
      value,
      span: span(
        absoluteStart + start,
        absoluteStart + cursor,
        line,
        start + 1
      ),
    })
    valueIndex += 1
    start = cursor + 1
  }
  return cells
}

function span(
  byteStart: number,
  byteEnd: number,
  line: number,
  column = 1
): SourceSpan {
  return { byteStart, byteEnd, line, column }
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown parser error"
}

function hasUtf8Bom(input: Uint8Array): boolean {
  return input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
}
