import { describe, expect, test } from "bun:test"

import {
  NativeFormatError,
  parseLosslessNative,
  parseStrictUnquotedTable,
} from "../src"

const encoder = new TextEncoder()

describe("strict unquoted native tables", () => {
  test("detects and parses a tab table with exact raw cell spans", () => {
    const document = parseLosslessNative(
      encoder.encode(
        "metadata: retained\r\ntime\ttemp\tnote\r\n0\t20.5\tfirst\r\n1\t21.0\t\r\n"
      )
    )
    const table = parseStrictUnquotedTable(document, { startLine: 2 })

    expect(table.delimiter).toBe("tab")
    expect(table.columnCount).toBe(3)
    expect(table.header.cells.map((cell) => cell.value)).toEqual([
      "time",
      "temp",
      "note",
    ])
    expect(table.rows[1]?.cells.map((cell) => cell.value)).toEqual([
      "1",
      "21.0",
      "",
    ])
    expect(new TextDecoder().decode(table.rows[0]?.cells[1]?.raw)).toBe("20.5")
    expect(table.rows[0]?.cells[1]?.span.line).toBe(3)
  })

  test("parses comma tables without applying CSV quote semantics", () => {
    const document = parseLosslessNative(
      encoder.encode('name,value\nalpha,"literal quote characters"\nbeta,café')
    )
    const table = parseStrictUnquotedTable(document, { startLine: 1 })

    expect(table.delimiter).toBe("comma")
    expect(table.rows[0]?.cells[1]?.value).toBe('"literal quote characters"')
    expect(table.rows[1]?.cells[1]?.value).toBe("café")
  })

  test("rejects mixed delimiter families in the header or any row", () => {
    const mixedHeader = parseLosslessNative(encoder.encode("a,b\tc\n1,2,3"))
    expect(() =>
      parseStrictUnquotedTable(mixedHeader, { startLine: 1 })
    ).toThrow(expect.objectContaining({ code: "mixed_delimiters" }))

    const mixedRow = parseLosslessNative(encoder.encode("a,b,c\n1,2\t3"))
    expect(() => parseStrictUnquotedTable(mixedRow, { startLine: 1 })).toThrow(
      expect.objectContaining({ code: "mixed_delimiters", line: 2 })
    )
  })

  test("enforces the exact expected column count", () => {
    const document = parseLosslessNative(encoder.encode("a,b,c\n1,2\n"))
    expect(() => parseStrictUnquotedTable(document, { startLine: 1 })).toThrow(
      expect.objectContaining({ code: "column_count_mismatch", line: 2 })
    )
    expect(() =>
      parseStrictUnquotedTable(document, {
        startLine: 1,
        expectedColumnCount: 4,
      })
    ).toThrow(
      expect.objectContaining({ code: "column_count_mismatch", line: 1 })
    )
  })

  test("rejects empty records and missing tables with stable errors", () => {
    const blankRow = parseLosslessNative(encoder.encode("a,b\n\n1,2"))
    expect(() => parseStrictUnquotedTable(blankRow, { startLine: 1 })).toThrow(
      expect.objectContaining({ code: "empty_record", line: 2 })
    )

    const noTable = parseLosslessNative(encoder.encode("metadata: only"))
    try {
      parseStrictUnquotedTable(noTable, { startLine: 2 })
      throw new Error("expected parseStrictUnquotedTable to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(NativeFormatError)
      expect(error).toMatchObject({ code: "missing_table" })
    }
  })

  test("recognizes a BOM independently from later invalid UTF-8", () => {
    const source = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode("a,b\n"),
      0xff,
      ...encoder.encode(",2"),
    ])
    const document = parseLosslessNative(source)
    expect(document.encoding).toBe("unknown")
    expect(() => parseStrictUnquotedTable(document, { startLine: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_utf8", line: 2 })
    )
  })
})
