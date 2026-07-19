import { describe, expect, test } from "bun:test"

import {
  decodeSassiFrame,
  encodeAcknowledgementFrame,
  encodeDirectoryListFrame,
  encodeFileRequestFrame,
  encodeInfoRequestFrame,
  encodeSassiFrame,
  encodeTimeSyncFrame,
  formatSassiUtcDate,
} from "../src"

describe("SASSI outbound encoding", () => {
  test("encodes the official type-3 host handshake layout", () => {
    const frame = encodeTimeSyncFrame({
      elapsedMs: 0x88b12,
      crcSeed: 0x81f2,
      now: new Date("2024-04-28T07:18:28Z"),
      maximumFrameBytes: 4064,
    })
    const text = new TextDecoder().decode(frame)

    expect(text).toMatch(
      /^KL\*3\|88b12\|10\|256\|202404280071828\|1\|[0-9a-f]{4}\r$/
    )
    const decoded = decodeSassiFrame(frame, { negotiatedCrcSeed: 0x81f2 })
    expect(decoded.ok).toBe(true)
  })

  test("encodes a read-only operational-status request", () => {
    const frame = encodeInfoRequestFrame({
      elapsedMs: 0x88b1e,
      crcSeed: 0x81f2,
      infoCode: 9,
    })
    expect(new TextDecoder().decode(frame)).toMatch(
      /^KL\*13\|88b1e\|\|9\|[0-9a-f]{4}\r$/
    )
  })

  test("encodes read-only filesystem inventory and pull requests", () => {
    const directory = encodeDirectoryListFrame({
      elapsedMs: 42,
      crcSeed: 0x81f2,
      path: "kaffelogic/roast-logs",
    })
    const file = encodeFileRequestFrame({
      elapsedMs: 43,
      crcSeed: 0x81f2,
      path: "kaffelogic/roast-logs/log0001.klog",
    })
    const acknowledgement = encodeAcknowledgementFrame({
      elapsedMs: 44,
      crcSeed: 0x81f2,
    })

    expect(new TextDecoder().decode(directory)).toMatch(
      /^KL\*5\|2a\|kaffelogic\/roast-logs\|\|1\|[0-9a-f]{4}\r$/
    )
    expect(new TextDecoder().decode(file)).toMatch(
      /^KL\*7\|2b\|kaffelogic\/roast-logs\/log0001\.klog\|[0-9a-f]{4}\r$/
    )
    expect(new TextDecoder().decode(acknowledgement)).toMatch(
      /^KL\*1\|2c\|[0-9a-f]{4}\r$/
    )
  })

  test("formats the Studio UTC date including Sunday as zero", () => {
    expect(formatSassiUtcDate(new Date("2024-04-28T07:18:28Z"))).toBe(
      "202404280071828"
    )
  })

  test("rejects delimiters, non-ASCII and oversized output", () => {
    expect(() =>
      encodeSassiFrame({
        type: 3,
        elapsedMs: 1,
        fields: ["unsafe|field"],
        crcSeed: 0,
      })
    ).toThrow(TypeError)
    expect(() =>
      encodeSassiFrame({
        type: 3,
        elapsedMs: 1,
        fields: ["café"],
        crcSeed: 0,
      })
    ).toThrow(TypeError)
    expect(() =>
      encodeSassiFrame({
        type: 3,
        elapsedMs: 1,
        fields: ["host"],
        crcSeed: 0,
        maximumFrameBytes: 8,
      })
    ).toThrow(RangeError)
  })
})
