import { afterEach, describe, expect, test, vi } from "vitest"

import {
  allowsDemoData,
  CapabilityUnavailableError,
  demoDataEnabled,
  getDeviceState,
  getRoast,
  isDemoResult,
  listRoasts,
  submitPrintJob,
} from "@/lib/api"

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function mockFetch() {
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("development demo gate", () => {
  test("requires both a development build and an explicit opt-in", () => {
    expect(allowsDemoData(false, "true")).toBe(false)
    expect(allowsDemoData(true, undefined)).toBe(false)
    expect(allowsDemoData(true, "false")).toBe(false)
    expect(allowsDemoData(true, "true")).toBe(true)
  })

  test("is disabled in the test runtime unless explicitly configured", () => {
    expect(demoDataEnabled).toBe(false)
    expect(isDemoResult({ source: "demo", data: {} })).toBe(false)
  })
})

describe("production-safe companion reads", () => {
  test("keeps an empty roast collection empty", async () => {
    mockFetch().mockResolvedValue(jsonResponse({ rows: [] }))

    await expect(listRoasts()).resolves.toEqual({
      data: [],
      source: "companion",
    })
  })

  test("sends URL-backed roast filters and sorting to the companion", async () => {
    const fetchMock = mockFetch().mockResolvedValue(jsonResponse({ rows: [] }))

    await listRoasts({
      q: "ethiopia",
      group: "provider",
      sort: "score",
      provider: "Sey",
      process: "washed",
      minScore: 85,
      status: "tasted",
    })

    const request = fetchMock.mock.calls[0]?.[0]
    expect(request).toBeInstanceOf(Request)
    const body = await (request as Request).clone().json()
    expect(body.filters.clauses).toEqual([
      { op: "search", query: "ethiopia" },
      {
        op: "field",
        field: "providerName",
        operator: "contains",
        value: "Sey",
      },
      {
        op: "field",
        field: "process",
        operator: "contains",
        value: "washed",
      },
      {
        op: "field",
        field: "needsTasting",
        operator: "eq",
        value: false,
      },
      {
        op: "field",
        field: "tastingScoreBasisPoints",
        operator: "gte",
        value: 8500,
      },
    ])
    expect(body.sorts).toEqual([
      { field: "providerName", direction: "asc", nulls: "last" },
      {
        field: "tastingScoreBasisPoints",
        direction: "desc",
        nulls: "last",
      },
    ])
  })

  test("maps interrupted roasts and filters them by device process state", async () => {
    const fetchMock = mockFetch().mockResolvedValue(
      jsonResponse({
        kind: "rows",
        rows: [
          {
            roastId: "interrupted-roast",
            values: {
              roastNumber: 7,
              status: "interrupted",
              result: "aborted",
            },
          },
        ],
      })
    )

    const result = await listRoasts({ status: "interrupted" })

    expect(result.data[0]?.status).toBe("interrupted")
    const request = fetchMock.mock.calls[0]?.[0]
    const body = await (request as Request).clone().json()
    expect(body.filters.clauses).toEqual([
      {
        op: "field",
        field: "status",
        operator: "eq",
        value: "interrupted",
      },
    ])
  })

  test("propagates companion failures instead of returning sample roasts", async () => {
    mockFetch().mockRejectedValue(new Error("companion offline"))

    await expect(listRoasts()).rejects.toThrow("companion offline")
  })

  test("maps a companion roast without merging sample telemetry", async () => {
    mockFetch().mockResolvedValue(
      jsonResponse({
        id: "actual-roast",
        roastedAt: "2026-07-18T16:42:00.000Z",
        roastLevelThousandths: 1200,
        developmentBasisPoints: 1250,
        greenInputMassMg: 100_000,
        roastedYieldMassMg: 86_000,
        result: "completed",
        status: "complete",
        lineage: {
          coffee: { displayName: "Actual coffee" },
          lot: { internalCode: "ACT-1" },
          provider: { displayName: "Actual provider" },
          origin: {
            countryCode: "ET",
            region: "Guji",
            farmProducer: "Actual farm",
            process: "Washed",
          },
        },
        profile: { displayName: "Actual profile", revisionNumber: 3 },
        sampleStream: null,
        promotedTasting: {
          scoreBasisPoints: 8700,
          descriptors: ["peach"],
          notes: "Clean",
          conclusion: "Repeat",
          nextAction: "No change",
        },
        events: [],
        annotations: [],
      })
    )

    const result = await getRoast("actual-roast")

    expect(result.source).toBe("companion")
    expect(result.data).toMatchObject({
      id: "actual-roast",
      coffeeName: "Actual coffee",
      conclusion: "Repeat",
      nextAction: "No change",
      chart: [],
      events: [],
    })
  })
})

describe("capability-gated device and printing adapters", () => {
  test("reads the dedicated fail-closed device resource", async () => {
    mockFetch().mockResolvedValue(
      jsonResponse({
        state: "unavailable",
        reason: "not_implemented",
        connection: "disconnected",
        readOnly: true,
      })
    )

    const result = await getDeviceState()

    expect(result).toEqual({
      source: "companion",
      data: {
        available: false,
        adapterState: "unavailable",
        reason: "not_implemented",
        connection: "disconnected",
        model: null,
        firmware: null,
        protocol: null,
        packetLimitBytes: null,
        busy: null,
        profileCount: null,
        logCount: null,
        syncState: "idle",
        importedLogCount: 0,
        updatedLogCount: 0,
        importWarningCount: 0,
        quarantinedLogCount: 0,
        lastSyncedAt: null,
        readOnly: true,
      },
    })
  })

  test("rejects submission when the printing capability is unavailable", async () => {
    const fetchMock = mockFetch().mockResolvedValue(
      jsonResponse({
        features: { deviceConnection: false, printing: false },
        adapters: {
          usb: { state: "unavailable" },
          printing: { state: "unavailable", reason: "not_implemented" },
        },
      })
    )

    await expect(
      submitPrintJob({
        printerId: "pdf",
        widthMm: 50,
        heightMm: 30,
        copies: 1,
        artifact: "pdf",
      })
    ).rejects.toBeInstanceOf(CapabilityUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("does not fabricate success when an enabled print endpoint fails", async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(
        jsonResponse({
          features: { deviceConnection: false, printing: true },
          adapters: {
            usb: { state: "unavailable" },
            printing: { state: "ready" },
          },
        })
      )
      .mockRejectedValueOnce(new Error("spooler offline"))

    await expect(
      submitPrintJob({
        printerId: "system",
        widthMm: 50,
        heightMm: 30,
        copies: 1,
        artifact: "queue",
      })
    ).rejects.toThrow("spooler offline")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
