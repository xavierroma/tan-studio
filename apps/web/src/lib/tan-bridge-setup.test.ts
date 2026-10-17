import { describe, expect, it } from "vitest"

import {
  TanBridgeSetupClient,
  type TanBridgeSerial,
  type TanBridgeSerialPort,
} from "./tan-bridge-setup"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class FakeSerialPort implements TanBridgeSerialPort {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  openOptions: unknown
  signals: unknown
  closed = false
  private responseController?: ReadableStreamDefaultController<Uint8Array>

  constructor(
    responseFor: (request: Record<string, unknown>) => Record<string, unknown>
  ) {
    this.readable = new ReadableStream({
      start: (controller) => {
        this.responseController = controller
      },
    })
    this.writable = new WritableStream({
      write: (bytes) => {
        const request = JSON.parse(decoder.decode(bytes)) as Record<
          string,
          unknown
        >
        const response = encoder.encode(
          `${JSON.stringify(responseFor(request))}\n`
        )
        const midpoint = Math.floor(response.byteLength / 2)
        this.responseController?.enqueue(response.slice(0, midpoint))
        this.responseController?.enqueue(response.slice(midpoint))
      },
    })
  }

  async open(options: unknown) {
    this.openOptions = options
  }

  async close() {
    this.closed = true
  }

  async setSignals(signals: unknown) {
    this.signals = signals
  }
}

function fakeSerial(port: FakeSerialPort): TanBridgeSerial {
  return { requestPort: async () => port }
}

function responseEnvelope(
  request: Record<string, unknown>,
  result: Record<string, unknown>
) {
  return {
    schemaVersion: 2,
    requestId: request.requestId,
    result,
  }
}

describe("Tan Bridge Web Serial client", () => {
  it.each([false, true])(
    "validates split CDC status with forwarding diagnostics=%s",
    async (withForwarding) => {
      const port = new FakeSerialPort((request) =>
        responseEnvelope(request, {
          protocolVersion: 2,
          bridgeId: "abcdefghijklmnopqrstuvwxyz",
          firmware: { version: "0.1.0-dev", build: "setup-v1" },
          lifecycle: "unprovisioned",
          wifi: { state: "disabled" },
          backend: {
            state: "offline",
            transport: "wss",
            host: "studio.tan.coffee",
            port: 443,
            path: "/device/v1/session",
            ...(withForwarding
              ? {
                  lastErrorType: 0,
                  lastHttpStatus: 0,
                  lastEspError: 0,
                  lastTlsError: 0,
                  lastVerifyFlags: 0,
                  lastSocketErrno: 0,
                }
              : {}),
          },
          claim: { state: "unclaimed" },
          diagnostics: {
            bootCount: 1,
            brownoutCount: 0,
            watchdogCount: 0,
            lastResetReason: "powerOn",
            previousResetReason: "unknown",
            interruptWatchdogCount: 0,
            taskWatchdogCount: 0,
            otherWatchdogCount: 0,
            watchdogUsbStage: "boot",
            watchdogNetworkStage: "notStarted",
            persisted: true,
            networkStartDelayMs: 2_500,
            wifiMaxTxPowerQuarterDbm: 44,
            ...(withForwarding
              ? {
                  forwarding: {
                    receivedBytes: 1000,
                    forwardedBytes: 900,
                    discardedBytes: 100,
                    overflows: 0,
                    sessionFailures: 1,
                    usbRecoveries: 1,
                    highWaterBytes: 512,
                  },
                }
              : {}),
          },
        })
      )

      const client = await TanBridgeSetupClient.connect(fakeSerial(port))
      const status = await client.getStatus()

      expect(port.openOptions).toEqual({
        baudRate: 115_200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      })
      expect(port.signals).toEqual({
        dataTerminalReady: true,
        requestToSend: false,
      })
      expect(status.bridgeId).toBe("abcdefghijklmnopqrstuvwxyz")
      expect(status.diagnostics.forwarding?.highWaterBytes).toBe(
        withForwarding ? 512 : undefined
      )
      await client.close()
      expect(port.closed).toBe(true)
    }
  )

  it("validates a bounded Wi-Fi scan", async () => {
    const port = new FakeSerialPort((request) =>
      responseEnvelope(request, {
        scanId: "0123456789abcdef",
        networks: [
          {
            networkId: "fedcba9876543210",
            ssid: "Workshop",
            authMode: "wpa2-personal",
            channel: 6,
            rssi: -42,
          },
        ],
      })
    )
    const client = await TanBridgeSetupClient.connect(fakeSerial(port))
    await expect(client.scanWifi()).resolves.toMatchObject({
      networks: [{ ssid: "Workshop" }],
    })
    await client.close()
  })

  it("surfaces typed firmware errors", async () => {
    const port = new FakeSerialPort((request) => ({
      schemaVersion: 2,
      requestId: request.requestId,
      error: {
        code: "wifi_scan_failed",
        message: "The bridge could not complete a Wi-Fi scan.",
        retryable: true,
      },
    }))
    const client = await TanBridgeSetupClient.connect(fakeSerial(port))
    await expect(client.scanWifi()).rejects.toEqual(
      expect.objectContaining({
        code: "wifi_scan_failed",
        retryable: true,
      })
    )
    await client.close()
  })
})
