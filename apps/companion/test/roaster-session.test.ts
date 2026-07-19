import { describe, expect, test } from "bun:test"
import {
  decodeSassiFrame,
  encodeSassiFrame,
  type DecodedSassiMessage,
} from "@tan-studio/device-sassi"

import {
  RoasterSession,
  type RoasterSessionSnapshot,
} from "../src/device/roaster-session"
import type {
  SerialCandidateList,
  SerialDataEvent,
  SerialDisconnectEvent,
  SerialTransport,
} from "../src/device/serial-transport"

class FakeSerialTransport implements SerialTransport {
  readonly writes: Uint8Array[] = []
  #data = new Set<(event: SerialDataEvent) => void>()
  #disconnect = new Set<(event: SerialDisconnectEvent) => void>()

  async start() {}
  async list(): Promise<SerialCandidateList> {
    return { generation: 1, candidates: [] }
  }
  async open() {
    return "s1"
  }
  async write(_sessionId: string, payload: Uint8Array) {
    this.writes.push(payload)
  }
  async close() {}
  async stop() {}
  onData(listener: (event: SerialDataEvent) => void) {
    this.#data.add(listener)
    return () => this.#data.delete(listener)
  }
  onDisconnect(listener: (event: SerialDisconnectEvent) => void) {
    this.#disconnect.add(listener)
    return () => this.#disconnect.delete(listener)
  }
  emit(bytes: Uint8Array, seq: number) {
    for (const listener of this.#data) listener({ sessionId: "s1", seq, bytes })
  }
}

describe("Nano read-only SASSI session", () => {
  test("identifies, time-syncs and reads operational status", async () => {
    const transport = new FakeSerialTransport()
    const snapshots: RoasterSessionSnapshot[] = []
    let monotonic = 100
    const session = new RoasterSession({
      transport,
      now: () => new Date("2026-07-18T15:30:00Z"),
      monotonicMs: () => monotonic++,
      onChange: (snapshot) => snapshots.push(snapshot),
    })
    await session.connect("c1", 1)

    const seed = 0x81f2
    transport.emit(
      encodeSassiFrame({
        type: 2,
        elapsedMs: 0x584,
        fields: [
          "1",
          "128",
          "TS00000001",
          "1",
          "KN1007B",
          "kaffelogic.com",
          "",
          "4064",
          "192",
          seed.toString(16),
        ],
        crcSeed: seed,
      }),
      1
    )
    await tick()

    expect(transport.writes).toHaveLength(1)
    const timeSync = decode(transport.writes[0], seed)
    expect(timeSync.type).toBe(3)
    expect(timeSync.fields).toEqual(["10", "256", "202607186153000", "1"])

    transport.emit(
      encodeSassiFrame({
        type: 4,
        elapsedMs: timeSync.elapsedMs,
        crcSeed: seed,
      }),
      2
    )
    await tick()
    expect(session.snapshot.connection).toBe("connected")
    expect(session.snapshot.model).toBe("KN1007B")
    expect(session.snapshot.readOnly).toBe(true)

    const statusRequest = decode(transport.writes[1], seed)
    expect(statusRequest).toMatchObject({ type: 13, fields: ["", "9"] })
    transport.emit(
      encodeSassiFrame({
        type: 14,
        elapsedMs: statusRequest.elapsedMs,
        fields: ["stage:0;time:0.000000;level:2.000000;sassi_file_lock:0", "9"],
        crcSeed: seed,
      }),
      3
    )
    await tick()
    expect(session.snapshot.operationalStatusReceived).toBe(true)
    expect(session.snapshot.busy).toBe(false)

    const systemRequest = decode(transport.writes[2], seed)
    expect(systemRequest).toMatchObject({ type: 13, fields: ["", "3"] })
    transport.emit(
      encodeSassiFrame({
        type: 14,
        elapsedMs: systemRequest.elapsedMs,
        fields: ["firmware_version:7.20.6;model:KN1007B", "3"],
        crcSeed: seed,
      }),
      4
    )
    await tick()
    expect(session.snapshot.firmware).toBe("7.20.6")

    const directoryPromise = session.listDirectory("kaffelogic/roast-logs")
    await tick()
    expect(decode(transport.writes[3], seed)).toMatchObject({
      type: 5,
      fields: ["kaffelogic/roast-logs", "", "1"],
    })
    const directoryText =
      " \tlog0001.klog\t202607186184617\t42\r>\tarchive\t202607186184700\t0\r"
    const directoryBytes = new TextEncoder().encode(directoryText)
    transport.emit(
      encodeSassiFrame({
        type: 6,
        elapsedMs: 20,
        fields: [
          "kaffelogic/roast-logs",
          "0",
          "1",
          "1",
          Buffer.from(directoryBytes.subarray(0, 24)).toString("base64"),
        ],
        crcSeed: seed,
      }),
      5
    )
    await tick()
    expect(decode(transport.writes[4], seed).type).toBe(1)
    transport.emit(
      encodeSassiFrame({
        type: 6,
        elapsedMs: 21,
        fields: [
          "kaffelogic/roast-logs",
          "128",
          "1",
          "2",
          Buffer.from(directoryBytes.subarray(24)).toString("base64"),
        ],
        crcSeed: seed,
      }),
      6
    )
    await expect(directoryPromise).resolves.toEqual([
      {
        kind: "file",
        name: "log0001.klog",
        path: "kaffelogic/roast-logs/log0001.klog",
        modifiedAt: "202607186184617",
        sizeBytes: 42,
      },
      {
        kind: "directory",
        name: "archive",
        path: "kaffelogic/roast-logs/archive",
        modifiedAt: "202607186184700",
        sizeBytes: 0,
      },
    ])

    const filePromise = session.readFile("kaffelogic/roast-logs/log0001.klog")
    await tick()
    expect(decode(transport.writes[5], seed).type).toBe(7)
    const fileBytes = new TextEncoder().encode(
      "profile_short_name:Test\n\ntime\t=temp\n0\t20\n"
    )
    transport.emit(
      encodeSassiFrame({
        type: 8,
        elapsedMs: 22,
        fields: [
          "kaffelogic/roast-logs/log0001.klog",
          "128",
          "202607186184617",
          "1",
          Buffer.from(fileBytes).toString("base64"),
        ],
        crcSeed: seed,
      }),
      7
    )
    await expect(filePromise).resolves.toEqual({
      path: "kaffelogic/roast-logs/log0001.klog",
      modifiedAt: "202607186184617",
      bytes: fileBytes,
    })

    const busyDirectory = session.listDirectory("kaffelogic/roast-logs")
    await tick()
    transport.emit(
      encodeSassiFrame({
        type: 6,
        elapsedMs: 23,
        fields: ["kaffelogic/roast-logs", "231", "1", "0", ""],
        crcSeed: seed,
      }),
      8
    )
    await expect(busyDirectory).rejects.toThrow("sassi_outcome_103")
    expect(session.snapshot).toMatchObject({
      connection: "connected",
      busy: true,
    })

    transport.emit(
      encodeSassiFrame({
        type: 30,
        elapsedMs: 24,
        fields: ["", "7"],
        crcSeed: seed,
      }),
      9
    )
    await tick()
    expect(session.snapshot.busy).toBe(false)

    expect(transport.writes.map((frame) => decode(frame, seed).type)).toEqual([
      3, 13, 13, 5, 1, 7, 5,
    ])
    expect(JSON.stringify(snapshots)).not.toContain("TS00000001")
    await session.dispose()
  })

  test("rejects an unimplemented SASSI version without writing", async () => {
    const transport = new FakeSerialTransport()
    const session = new RoasterSession({
      transport,
      onChange: () => {},
    })
    await session.connect("c1", 1)
    const seed = 0x81f2

    transport.emit(
      encodeSassiFrame({
        type: 2,
        elapsedMs: 1,
        fields: [
          "1",
          "128",
          "TS00000001",
          "2",
          "KN1007B",
          "kaffelogic.com",
          "",
          "4064",
          "192",
          seed.toString(16),
        ],
        crcSeed: seed,
      }),
      1
    )
    await tick()

    expect(session.snapshot).toMatchObject({
      connection: "disconnected",
      reason: "unsupported_device",
    })
    expect(transport.writes).toEqual([])
    await session.dispose()
  })
})

function decode(
  value: Uint8Array | undefined,
  seed: number
): DecodedSassiMessage {
  if (!value) throw new Error("missing frame")
  const result = decodeSassiFrame(value, { negotiatedCrcSeed: seed })
  if (!result.ok) throw new Error(result.error.code)
  return result.message
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
