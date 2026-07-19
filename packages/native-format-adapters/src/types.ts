export type SourceSpan = {
  byteStart: number
  byteEnd: number
  line: number
  column: number
}

export type RawCell = {
  raw: Uint8Array
  value: string
  span: SourceSpan
}

export type PropertyNode = {
  kind: "property"
  rawKey: Uint8Array
  separator: Uint8Array
  rawValue: Uint8Array
  ending: Uint8Array
  span: SourceSpan
  valueSpan: SourceSpan
}

export type BlankNode = {
  kind: "blank"
  raw: Uint8Array
  span: SourceSpan
}

export type UnknownNode = {
  kind: "unknown"
  raw: Uint8Array
  span: SourceSpan
}

export type LosslessNode = PropertyNode | BlankNode | UnknownNode

export type FormatDiagnostic = {
  severity: "warning" | "error"
  code: "invalid_utf8"
  message: string
  span?: SourceSpan
}

export type SemanticProperty = {
  key: string
  value: string
  nodeIndex: number
}

export type LosslessSemanticView = {
  /** Ordered entries; duplicate keys are intentionally retained. */
  properties: readonly SemanticProperty[]
  /** Convenience projection only. The final duplicate value wins. */
  lastValueByKey: Readonly<Record<string, string>>
}

export type LosslessDocument = {
  sourceHash: string
  originalBytes: Uint8Array
  encoding: "utf-8" | "utf-8-bom" | "unknown"
  lineEnding: "none" | "lf" | "crlf" | "cr" | "mixed"
  nodes: readonly LosslessNode[]
  semanticView: LosslessSemanticView
  diagnostics: readonly FormatDiagnostic[]
}

export type LosslessParseOptions = {
  maximumFileBytes?: number
  maximumLineBytes?: number
  maximumProperties?: number
}

export type PropertyValueEdit = {
  kind: "replace_property_value"
  nodeIndex: number
  value: Uint8Array
}

export type NativeEdit = PropertyValueEdit

export type SerializeResult = {
  bytes: Uint8Array
  changes: readonly {
    nodeIndex: number
    byteStart: number
    byteEnd: number
    replacementBytes: number
  }[]
}

export type StrictTableDelimiter = "comma" | "tab"

export type StrictTableOptions = {
  /** One-based physical line number of the table header. */
  startLine: number
  delimiter?: StrictTableDelimiter
  expectedColumnCount?: number
  maximumRows?: number
  maximumColumns?: number
}

export type StrictTableRow = {
  line: number
  raw: Uint8Array
  cells: readonly RawCell[]
  span: SourceSpan
}

export type StrictTable = {
  delimiter: StrictTableDelimiter
  columnCount: number
  header: StrictTableRow
  rows: readonly StrictTableRow[]
}

export type NativeFormatErrorCode =
  | "file_too_large"
  | "line_too_large"
  | "too_many_properties"
  | "invalid_edit"
  | "invalid_utf8"
  | "missing_table"
  | "unsafe_semantic_projection"
  | "missing_delimiter"
  | "mixed_delimiters"
  | "empty_record"
  | "column_count_mismatch"
  | "table_too_large"
  | "csv_parse_failed"

export class NativeFormatError extends Error {
  readonly code: NativeFormatErrorCode
  readonly line: number | undefined

  constructor(code: NativeFormatErrorCode, message: string, line?: number) {
    super(message)
    this.name = "NativeFormatError"
    this.code = code
    this.line = line
  }
}
