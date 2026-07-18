import { describe, expect, test } from "bun:test"

import {
  isSerialBridgeExecutableName,
  parseBridgeMessage,
} from "../src/device/rust-serial-transport"

const bytes = (value: string) => new TextEncoder().encode(value)

describe("serial bridge wire contract", () => {
  test("accepts installed and target-suffixed helper names", () => {
    expect(isSerialBridgeExecutableName("tan-studio-serial-bridge")).toBe(true)
    expect(isSerialBridgeExecutableName("tan-studio-serial-bridge.exe")).toBe(
      true
    )
    expect(
      isSerialBridgeExecutableName(
        "tan-studio-serial-bridge-aarch64-apple-darwin"
      )
    ).toBe(true)
    expect(isSerialBridgeExecutableName("tan-studio-companion")).toBe(false)
  })

  test("accepts redacted candidate lists without operating-system paths", () => {
    const parsed = parseBridgeMessage(
      bytes(
        JSON.stringify({
          protocolVersion: 1,
          type: "response",
          requestId: "r1",
          ok: true,
          result: {
            generation: 2,
            candidates: [
              {
                candidateId: "c1",
                vendorId: 0x2e8a,
                productId: 0x000a,
                kind: "usb",
              },
            ],
          },
        })
      )
    )
    expect(parsed).toMatchObject({ type: "response", ok: true })
    expect(JSON.stringify(parsed)).not.toContain("/dev/")
  })

  test("accepts sequenced binary events", () => {
    expect(
      parseBridgeMessage(
        bytes(
          JSON.stringify({
            protocolVersion: 1,
            type: "data",
            sessionId: "s1-1",
            seq: 1,
            payloadBase64: "S0wqMg==",
          })
        )
      )
    ).toEqual({
      type: "data",
      sessionId: "s1-1",
      seq: 1,
      payloadBase64: "S0wqMg==",
    })
  })

  test("rejects invalid versions, identifiers and base64", () => {
    for (const value of [
      { protocolVersion: 2, type: "ready" },
      {
        protocolVersion: 1,
        type: "data",
        sessionId: "../device",
        seq: 1,
        payloadBase64: "S0wqMg==",
      },
      {
        protocolVersion: 1,
        type: "data",
        sessionId: "s1",
        seq: 1,
        payloadBase64: "not-base64",
      },
    ]) {
      expect(() => parseBridgeMessage(bytes(JSON.stringify(value)))).toThrow()
    }
  })
})
