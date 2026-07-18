import { describe, expect, test } from "bun:test"

import {
  crc16CcittXmodem,
  decodeSassiFrame,
  formatCrc16,
  SassiDecoder,
} from "../src"
import { TYPE_2_FIXTURE_A, TYPE_2_FIXTURE_B, textBytes } from "./fixtures"

describe("type-2 decoding", () => {
  test("decodes the live-verified shape using the seed inside the same frame", () => {
    const result = decodeSassiFrame(textBytes(TYPE_2_FIXTURE_A))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message.type).toBe(2)
    expect(result.message.elapsedMs).toBe(0x00a1f2)
    expect(result.message.evidence).toBe("live_verified")
    expect(result.message.parsed).toMatchObject({
      kind: "connection_request",
      platform: 1,
      capabilityBits: 128,
      sassiVersion: 1,
      model: "KN1007B",
      manufacturerDomain: "kaffelogic.com",
      description: "",
      maximumPacketBytes: 4064,
      maximumFilenameBytes: 192,
      crcSeed: 0x1a2b,
    })
    if (result.message.parsed.kind === "connection_request") {
      expect(new TextDecoder().decode(result.message.parsed.serialBytes)).toBe(
        "TS00000001"
      )
    }
    expect(result.message.fields).not.toContain("TS00000001")
    expect(result.message.fields).toContain("<serial:redacted>")
  })

  test("redacts both identity and original CRC from diagnostic text", () => {
    const result = decodeSassiFrame(textBytes(TYPE_2_FIXTURE_A))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.message.diagnosticFrame).toContain("<serial:redacted>")
    expect(result.message.diagnosticFrame).toContain("<crc:redacted>")
    expect(result.message.diagnosticFrame).not.toContain("TS00000001")
    expect(result.message.diagnosticFrame).not.toContain("61F7")
  })

  test("accepts independently seeded verified-style fixtures", () => {
    const first = decodeSassiFrame(textBytes(TYPE_2_FIXTURE_A))
    const second = decodeSassiFrame(textBytes(TYPE_2_FIXTURE_B))
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.message.parsed.kind).toBe("connection_request")
      expect(second.message.parsed.kind).toBe("connection_request")
      if (
        first.message.parsed.kind === "connection_request" &&
        second.message.parsed.kind === "connection_request"
      ) {
        expect(first.message.parsed.crcSeed).not.toBe(
          second.message.parsed.crcSeed
        )
      }
    }
  })

  test("rejects a body mutation without leaking its type-2 identity", () => {
    const corrupted = TYPE_2_FIXTURE_A.replace("|128|", "|129|")
    const result = decodeSassiFrame(textBytes(corrupted))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("invalid_crc")
    expect(result.error.diagnosticFrame).not.toContain("TS00000001")
  })
})

describe("incremental framing", () => {
  test("supports every two-chunk boundary", () => {
    const bytes = textBytes(TYPE_2_FIXTURE_A)
    for (let split = 0; split <= bytes.length; split += 1) {
      const decoder = new SassiDecoder()
      const events = [
        ...decoder.push(bytes.subarray(0, split)),
        ...decoder.push(bytes.subarray(split)),
      ]
      expect(events).toHaveLength(1)
      expect(events[0]?.kind).toBe("message")
    }
  })

  test("emits multiple frames from one chunk", () => {
    const decoder = new SassiDecoder()
    const events = decoder.push(textBytes(TYPE_2_FIXTURE_A + TYPE_2_FIXTURE_B))
    expect(events.map((event) => event.kind)).toEqual(["message", "message"])
  })

  test("is invariant across many deterministic pseudo-random chunkings", () => {
    const bytes = textBytes(TYPE_2_FIXTURE_A + TYPE_2_FIXTURE_B)

    for (let seed = 1; seed <= 250; seed += 1) {
      const decoder = new SassiDecoder()
      const events = []
      let state = seed
      let offset = 0
      while (offset < bytes.length) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
        const size = 1 + (state % 23)
        events.push(...decoder.push(bytes.subarray(offset, offset + size)))
        offset += size
      }
      expect(events.map((event) => event.kind)).toEqual(["message", "message"])
      expect(decoder.bufferedBytes).toBe(0)
    }
  })

  test("bounds an oversized frame and recovers at the next terminator", () => {
    const decoder = new SassiDecoder({ preHandshakeMaximumBytes: 90 })
    const oversized = textBytes(`${"X".repeat(120)}\r${TYPE_2_FIXTURE_A}`)
    const events = decoder.push(oversized)

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: "error",
      error: { code: "too_large" },
    })
    expect(events[1]?.kind).toBe("message")
  })

  test("reports an unterminated final fragment", () => {
    const decoder = new SassiDecoder()
    expect(decoder.push(textBytes("KL*2|abc"))).toEqual([])
    expect(decoder.finish()).toMatchObject([
      { kind: "error", error: { code: "malformed_syntax" } },
    ])
  })

  test("accepts the maximum negotiated packet limit plus framing overhead", () => {
    const decoder = new SassiDecoder()
    decoder.setNegotiatedLimits({
      maximumPacketBytes: 16 * 1024 * 1024,
      crcSeed: 0,
    })
    expect(decoder.push(textBytes(TYPE_2_FIXTURE_A))[0]?.kind).toBe("message")
  })
})

describe("unknown messages", () => {
  test("passes through a CRC-valid unknown type with an explicit diagnostic", () => {
    const body = "KL*99|2A|opaque|"
    const frame = `${body}${formatCrc16(crc16CcittXmodem(textBytes(body)))}\r`
    const result = decodeSassiFrame(textBytes(frame))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toMatchObject({
      type: 99,
      evidence: "unknown_passthrough",
      parsed: { kind: "unknown", type: 99 },
      diagnostics: [{ code: "unsupported_type" }],
    })
  })

  test("requires carriage-return framing and printable ASCII", () => {
    const wrongTerminator = decodeSassiFrame(
      textBytes(TYPE_2_FIXTURE_A.replace("\r", "\n"))
    )
    expect(wrongTerminator).toMatchObject({
      ok: false,
      error: { code: "malformed_syntax" },
    })

    const bytes = textBytes(TYPE_2_FIXTURE_A)
    bytes[5] = 0
    const binary = decodeSassiFrame(bytes)
    expect(binary).toMatchObject({
      ok: false,
      error: { code: "malformed_syntax" },
    })
  })
})
