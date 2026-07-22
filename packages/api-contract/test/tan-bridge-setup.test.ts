import { describe, expect, test } from "bun:test"

import {
  TanBridgeBackendHost,
  TanBridgeSetupGetStatusRequestSchema,
  TanBridgeSetupGetStatusResponseSchema,
  TanBridgeSetupScanWifiResponseSchema,
} from "../src"

const requestId = "018fb4c2-7d4e-7a92-9f4b-0d7ce3af9891"

describe("Tan Bridge Web Serial setup contract", () => {
  test("accepts the bounded status exchange", () => {
    expect(
      TanBridgeSetupGetStatusRequestSchema.safeParse({
        schemaVersion: 1,
        requestId,
        type: "setup.getStatus",
        payload: {},
      }).success
    ).toBe(true)

    expect(
      TanBridgeSetupGetStatusResponseSchema.safeParse({
        schemaVersion: 1,
        requestId,
        result: {
          protocolVersion: 1,
          bridgeId: "abcdefghijklmnopqrstuvwxyz",
          firmware: { version: "0.1.0-dev", build: "setup-v1" },
          lifecycle: "unprovisioned",
          wifi: { state: "disabled" },
          backend: { state: "offline", host: TanBridgeBackendHost },
          claim: { state: "unclaimed" },
          diagnostics: {
            bootCount: 1,
            brownoutCount: 0,
            watchdogCount: 0,
            lastResetReason: "powerOn",
            persisted: true,
            networkStartDelayMs: 2_500,
            wifiMaxTxPowerQuarterDbm: 44,
          },
        },
      }).success
    ).toBe(true)
  })

  test("rejects unknown properties and secret-shaped response fields", () => {
    expect(
      TanBridgeSetupGetStatusRequestSchema.safeParse({
        schemaVersion: 1,
        requestId,
        type: "setup.getStatus",
        payload: {},
        futureFlag: true,
      }).success
    ).toBe(false)

    expect(
      TanBridgeSetupGetStatusResponseSchema.safeParse({
        schemaVersion: 1,
        requestId,
        result: {
          protocolVersion: 1,
          bridgeId: "abcdefghijklmnopqrstuvwxyz",
          firmware: { version: "0.1.0-dev", build: "setup-v1" },
          lifecycle: "unprovisioned",
          wifi: { state: "disabled", password: "must-not-leak" },
          backend: { state: "offline", host: TanBridgeBackendHost },
          claim: { state: "unclaimed" },
          diagnostics: {
            bootCount: 1,
            brownoutCount: 0,
            watchdogCount: 0,
            lastResetReason: "powerOn",
            persisted: true,
            networkStartDelayMs: 2_500,
            wifiMaxTxPowerQuarterDbm: 44,
          },
        },
      }).success
    ).toBe(false)
  })

  test("accepts a sanitized and bounded Wi-Fi scan", () => {
    expect(
      TanBridgeSetupScanWifiResponseSchema.safeParse({
        schemaVersion: 1,
        requestId,
        result: {
          scanId: "0123456789abcdef",
          networks: [
            {
              networkId: "fedcba9876543210",
              ssid: "Workshop Wi-Fi",
              authMode: "wpa2-personal",
              channel: 6,
              rssi: -51,
            },
          ],
        },
      }).success
    ).toBe(true)
  })
})
