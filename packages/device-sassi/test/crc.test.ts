import { describe, expect, test } from "bun:test"

import { crc16CcittXmodem, formatCrc16 } from "../src"

describe("crc16CcittXmodem", () => {
  test("matches the canonical XMODEM check vector", () => {
    const input = new TextEncoder().encode("123456789")
    expect(crc16CcittXmodem(input)).toBe(0x31c3)
  })

  test("uses the supplied 16-bit seed", () => {
    const input = new TextEncoder().encode("123456789")
    expect(crc16CcittXmodem(input, 0x1d0f)).toBe(0xe5cc)
    expect(formatCrc16(0xe5cc)).toBe("E5CC")
  })

  test("rejects an invalid seed", () => {
    expect(() => crc16CcittXmodem(new Uint8Array(), -1)).toThrow(RangeError)
    expect(() => crc16CcittXmodem(new Uint8Array(), 0x1_0000)).toThrow(
      RangeError
    )
  })
})
