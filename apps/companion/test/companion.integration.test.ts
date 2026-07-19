import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import { createCompanionApp } from "../src/app"
import { openDatabase } from "../src/db/database"
import { migrate } from "../src/db/migrate"
import { seedDatabase, seedIds } from "../src/db/seed"

const launchToken = "integration-test-launch-token"
const origin = "http://localhost:5173"
const authority = "companion.test"

let database: Database
let app: ReturnType<typeof createCompanionApp>

const headers = (mutation = false): HeadersInit => ({
  Authorization: `Bearer ${launchToken}`,
  "X-Tan-Studio-Client": "desktop-v1",
  Origin: origin,
  ...(mutation ? { "Content-Type": "application/json" } : {}),
})

function request(path: string, init: RequestInit = {}) {
  return app.request(`http://${authority}${path}`, {
    ...init,
    headers: { ...headers(Boolean(init.body)), ...init.headers },
  })
}

beforeEach(async () => {
  database = openDatabase(":memory:")
  await migrate(database)
  seedDatabase(database)
  app = createCompanionApp({
    database,
    sessionId: "00000000-0000-7000-8000-000000009999",
    security: {
      launchToken,
      allowedHosts: [authority],
      allowedOrigins: [origin],
      development: true,
    },
  })
})

afterEach(() => database.close())

describe("security and bootstrap", () => {
  test("rejects unauthenticated requests with RFC 9457 Problem Details", async () => {
    const response = await app.request(
      `http://${authority}/api/v1/system/bootstrap`,
      {
        headers: { Origin: origin, "X-Tan-Studio-Client": "desktop-v1" },
      }
    )

    expect(response.status).toBe(401)
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json"
    )
    const problem = await response.json()
    expect(problem).toMatchObject({
      status: 401,
      code: "unauthenticated",
      retryable: false,
    })
    expect(problem.correlationId).toBeString()
  })

  test("returns the local capability bootstrap", async () => {
    const response = await request("/api/v1/system/bootstrap")
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      schemaVersion: 3,
      recoveryState: "ready",
      features: { catalog: true, roastLibrary: true, deviceConnection: false },
      adapters: { database: { state: "ready" } },
    })
  })

  test("returns a dedicated fail-closed device resource", async () => {
    const response = await request("/api/v1/device")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      state: "unavailable",
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
    })
  })

  test("rejects malformed JSON without exposing internals", async () => {
    const response = await request("/api/v1/providers", {
      method: "POST",
      body: "{not json",
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "malformed_json" })
  })

  test("authorizes idempotent mutation headers during CORS preflight", async () => {
    const response = await app.request(
      `http://${authority}/api/v1/print-jobs`,
      {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          Host: authority,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "idempotency-key",
        },
      }
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Idempotency-Key"
    )
  })

  test("allows authenticated originless API clients only when configured", async () => {
    const originless = createCompanionApp({
      database,
      security: {
        launchToken,
        allowedHosts: [authority],
        allowedOrigins: [origin],
        allowedClientIds: ["tan-studio-api-v1"],
        allowOriginlessRequests: true,
      },
    })
    const response = await originless.request("/api/v1/system/bootstrap", {
      headers: {
        Host: authority,
        Authorization: `Bearer ${launchToken}`,
        "X-Tan-Studio-Client": "tan-studio-api-v1",
      },
    })

    expect(response.status).toBe(200)
  })
})

describe("brew workflow and personal defaults", () => {
  test("creates short-numbered brews from the user's V60 defaults", async () => {
    const preferencesResponse = await request("/api/v1/preferences")
    expect(preferencesResponse.status).toBe(200)
    expect(await preferencesResponse.json()).toMatchObject({
      revision: 1,
      defaultRoasterName: "Kaffelogic Nano 7",
      defaultBrewMethod: "V60",
      defaultCoffeeMassMg: 15_000,
      defaultWaterMassMg: 250_000,
      defaultWaterTemperatureMilliC: 93_000,
    })

    const firstResponse = await request("/api/v1/brews", {
      method: "POST",
      body: JSON.stringify({
        roastNumber: 1,
        tastingNotes: "Jasmine and stone fruit",
      }),
    })
    expect(firstResponse.status).toBe(201)
    expect(firstResponse.headers.get("location")).toBe("/api/v1/brews/1")
    expect(await firstResponse.json()).toMatchObject({
      serialNumber: 1,
      roast: { serialNumber: 1 },
      method: "V60",
      coffeeMassMg: 15_000,
      waterMassMg: 250_000,
      waterTemperatureMilliC: 93_000,
      ratio: 250 / 15,
      tastingNotes: "Jasmine and stone fruit",
    })

    const updateResponse = await request("/api/v1/preferences", {
      method: "PATCH",
      headers: { "If-Match": '"revision:1"' },
      body: JSON.stringify({
        defaultGrinderName: "My grinder",
        defaultGrinderSetting: "5.2",
        defaultKettleName: "My kettle",
        defaultWaterName: "Filtered water",
        defaultWaterTemperatureMilliC: 92_000,
      }),
    })
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.headers.get("etag")).toBe('"revision:2"')

    const secondResponse = await request("/api/v1/brews", {
      method: "POST",
      body: JSON.stringify({ roastNumber: 1 }),
    })
    expect(await secondResponse.json()).toMatchObject({
      serialNumber: 2,
      grinderName: "My grinder",
      grinderSetting: "5.2",
      kettleName: "My kettle",
      waterName: "Filtered water",
      waterTemperatureMilliC: 92_000,
    })

    const listResponse = await request("/api/v1/brews?roastNumber=1")
    const list = await listResponse.json()
    expect(
      list.items.map((brew: { serialNumber: number }) => brew.serialNumber)
    ).toEqual([2, 1])
  })
})

describe("roast-linked labels", () => {
  test("generates a short QR identity linked to the roast", async () => {
    const response = await request("/api/v1/labels", {
      method: "POST",
      body: JSON.stringify({ roastNumber: 1, copies: 2 }),
    })
    expect(response.status).toBe(201)
    expect(response.headers.get("location")).toBe("/api/v1/labels/1")
    expect(await response.json()).toMatchObject({
      serialNumber: 1,
      roastNumber: 1,
      qrPayload: "tan:roast:1",
      copies: 2,
      status: "generated",
    })

    const list = await request("/api/v1/labels?roastNumber=1")
    expect((await list.json()).items).toHaveLength(1)
  })
})

describe("catalog resources", () => {
  test("lists seeded providers with signed cursor pagination", async () => {
    const firstResponse = await request("/api/v1/providers?first=1")
    expect(firstResponse.status).toBe(200)
    const firstPage = await firstResponse.json()
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.pageInfo.hasNextPage).toBe(true)

    const secondResponse = await request(
      `/api/v1/providers?first=1&after=${encodeURIComponent(firstPage.pageInfo.endCursor)}`
    )
    expect(secondResponse.status).toBe(200)
    const secondPage = await secondResponse.json()
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id)

    const tampered = `${firstPage.pageInfo.endCursor.slice(0, -1)}x`
    const invalidResponse = await request(
      `/api/v1/providers?first=1&after=${encodeURIComponent(tampered)}`
    )
    expect(invalidResponse.status).toBe(409)
    expect(await invalidResponse.json()).toMatchObject({
      code: "cursor_expired",
    })
  })

  test("creates and revision-guards provider updates", async () => {
    const createResponse = await request("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Sweet Maria's",
        aliases: ["Sweet Maria's Coffee"],
        contact: { websiteUrl: "https://www.sweetmarias.com" },
        defaultCurrencyCode: "USD",
        referenceNotes: "Online supplier",
        notes: "Oakland supplier",
      }),
    })
    expect(createResponse.status).toBe(201)
    expect(createResponse.headers.get("location")).toMatch(
      /^\/api\/v1\/providers\//
    )
    expect(createResponse.headers.get("etag")).toBe('"revision:1"')
    const created = (await createResponse.json()).resource
    expect(created).toMatchObject({
      aliases: ["Sweet Maria's Coffee"],
      contact: { websiteUrl: "https://www.sweetmarias.com" },
      defaultCurrencyCode: "USD",
    })

    const updateResponse = await request(`/api/v1/providers/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": '"revision:1"' },
      body: JSON.stringify({ notes: "Preferred green supplier" }),
    })
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.headers.get("etag")).toBe('"revision:2"')
    expect((await updateResponse.json()).resource.notes).toBe(
      "Preferred green supplier"
    )

    const staleResponse = await request(`/api/v1/providers/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": '"revision:1"' },
      body: JSON.stringify({ notes: "Stale edit" }),
    })
    expect(staleResponse.status).toBe(412)
    expect(await staleResponse.json()).toMatchObject({
      code: "revision_precondition_failed",
    })
  })

  test("returns coffee and lot lineage matching the accepted designs", async () => {
    const coffeesResponse = await request("/api/v1/coffees?search=Guji")
    const coffees = await coffeesResponse.json()
    expect(coffees.items).toHaveLength(1)
    const coffee = coffees.items[0]
    expect(coffee).toMatchObject({
      displayName: "Guji Shakiso",
      countryCode: "ET",
      region: "Guji",
      farmProducer: "Kayon Mountain",
      process: "Natural",
    })

    const lotResponse = await request(`/api/v1/lots/${seedIds.lots.guji}`)
    expect(lotResponse.status).toBe(200)
    expect(await lotResponse.json()).toMatchObject({
      internalCode: "ETH-GUJ-24-07",
      onHandMassMg: 1_420_000,
      coffee: { displayName: "Guji Shakiso" },
      provider: { displayName: "Osito Coffee" },
      purchase: { supplierReference: "PO-2025-041" },
    })
  })

  test("creates a lot and its opening inventory ledger atomically", async () => {
    const response = await request("/api/v1/lots", {
      method: "POST",
      body: JSON.stringify({
        purchaseLineId: seedIds.purchaseLines.bensa,
        internalCode: "ETH-SID-25-03",
        receivedMassMg: 500_000,
        onHandMassMg: 450_000,
        receivedAt: "2026-07-18T18:00:00.000Z",
        sourceTimezone: "America/Los_Angeles",
        storageLocation: "Coffee cabinet",
      }),
    })
    expect(response.status).toBe(201)
    const lot = (await response.json()).resource
    expect(lot).toMatchObject({
      balanceMg: 450_000,
      receivedMassMg: 500_000,
    })
    const ledger = database
      .query(
        "SELECT transaction_kind, delta_mg FROM inventory_transactions WHERE lot_id = ? ORDER BY delta_mg DESC"
      )
      .all(lot.id)
    expect(ledger).toEqual([
      { transaction_kind: "receipt", delta_mg: 500_000 },
      { transaction_kind: "adjustment", delta_mg: -50_000 },
    ])
  })

  test("reports field-level validation errors with JSON Pointer paths", async () => {
    const response = await request("/api/v1/coffees", {
      method: "POST",
      body: JSON.stringify({ displayName: "", countryCode: "ETH" }),
    })
    expect(response.status).toBe(422)
    const problem = await response.json()
    expect(problem.code).toBe("validation_failed")
    expect(
      problem.fieldErrors.map((field: { path: string }) => field.path)
    ).toContain("/displayName")
    expect(
      problem.fieldErrors.map((field: { path: string }) => field.path)
    ).toContain("/countryCode")
  })

  test("rejects non-HTTP provider website schemes", async () => {
    const response = await request("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Unsafe supplier",
        contact: { websiteUrl: "javascript:alert(1)" },
      }),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: "validation_failed" })
  })
})

describe("roast library and log review", () => {
  test("links an imported roast to a short-numbered catalog coffee", async () => {
    const coffeesResponse = await request("/api/v1/coffees?search=Guji")
    const coffee = (await coffeesResponse.json()).items[0]
    const detailResponse = await request("/api/v1/roasts/1")
    const detail = await detailResponse.json()

    const response = await request("/api/v1/roasts/1/coffee", {
      method: "PATCH",
      headers: { "If-Match": `"revision:${detail.revision}"` },
      body: JSON.stringify({ coffeeNumber: coffee.serialNumber }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("etag")).toBe(
      `"revision:${detail.revision + 1}"`
    )
    expect((await response.json()).resource).toMatchObject({
      serialNumber: 1,
      lineage: { coffee: { id: coffee.id, displayName: "Guji Shakiso" } },
    })
  })

  test("filters, sorts and paginates the roast library", async () => {
    const query = {
      viewVersion: 1,
      filters: { op: "search", query: "Guji" },
      groups: [],
      sorts: [{ field: "roastedAt", direction: "desc", nulls: "last" }],
      columns: [
        "roastedAt",
        "coffeeName",
        "providerName",
        "profileName",
        "profileRevisionNumber",
        "tastingScoreBasisPoints",
        "tastingDescriptors",
      ],
      aggregates: [{ key: "count", op: "count" }],
      page: { first: 2 },
    }
    const response = await request("/api/v1/roast-library/query", {
      method: "POST",
      body: JSON.stringify(query),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.kind).toBe("rows")
    expect(result.rows).toHaveLength(2)
    expect(result.aggregates.count).toBe(3)
    expect(result.rows[0].values).toMatchObject({
      coffeeName: "Guji Shakiso",
      providerName: "Osito Coffee",
      profileName: "Natural Light",
      profileRevisionNumber: 12,
      tastingScoreBasisPoints: 8800,
      tastingDescriptors: ["jasmine", "peach", "honey"],
    })
    expect(result.pageInfo.hasNextPage).toBe(true)
  })

  test("treats full-text search input as data rather than FTS syntax", async () => {
    const response = await request("/api/v1/roast-library/query", {
      method: "POST",
      body: JSON.stringify({
        viewVersion: 1,
        filters: { op: "search", query: 'Guji" OR *' },
        groups: [],
        sorts: [{ field: "roastedAt", direction: "desc", nulls: "last" }],
        columns: ["roastedAt", "coffeeName"],
        aggregates: [],
        page: { first: 20 },
      }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).kind).toBe("rows")
  })

  test("groups recursively by lot and provider with aggregates", async () => {
    const baseQuery = {
      viewVersion: 1,
      filters: { op: "and", clauses: [] },
      groups: [
        { field: "greenLotId", direction: "asc" },
        { field: "providerId", direction: "asc" },
      ],
      sorts: [{ field: "roastedAt", direction: "desc", nulls: "last" }],
      columns: ["roastedAt", "coffeeName", "providerName"],
      aggregates: [
        {
          key: "best_score",
          field: "tastingScoreBasisPoints",
          op: "max",
        },
      ],
      page: { first: 50 },
    }
    const rootResponse = await request("/api/v1/roast-library/query", {
      method: "POST",
      body: JSON.stringify(baseQuery),
    })
    expect(rootResponse.status).toBe(200)
    const root = await rootResponse.json()
    expect(root.kind).toBe("groups")
    expect(root.groups).toHaveLength(2)
    expect(root.groups[0]).toMatchObject({
      label: "ETH-GUJ-24-07",
      count: 3,
      aggregates: { best_score: 8800 },
    })

    const providerResponse = await request("/api/v1/roast-library/query", {
      method: "POST",
      body: JSON.stringify({ ...baseQuery, groupPath: root.groups[0].path }),
    })
    const provider = await providerResponse.json()
    expect(provider.kind).toBe("groups")
    expect(provider.groups).toHaveLength(1)
    expect(provider.groups[0]).toMatchObject({
      label: "Osito Coffee",
      count: 3,
    })

    const rowsResponse = await request("/api/v1/roast-library/query", {
      method: "POST",
      body: JSON.stringify({
        ...baseQuery,
        groupPath: provider.groups[0].path,
      }),
    })
    const rows = await rowsResponse.json()
    expect(rows.kind).toBe("rows")
    expect(rows.rows).toHaveLength(3)
  })

  test("returns roast lineage, tasting, events and annotations without sample arrays", async () => {
    const response = await request(`/api/v1/roasts/${seedIds.roasts.gujiR12}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("etag")).toBe('"revision:1"')
    const detail = await response.json()
    expect(detail).toMatchObject({
      kind: "roast",
      id: seedIds.roasts.gujiR12,
      lineage: {
        coffee: { displayName: "Guji Shakiso" },
        lot: { internalCode: "ETH-GUJ-24-07" },
        provider: { displayName: "Osito Coffee" },
      },
      profile: { displayName: "Natural Light", revisionNumber: 12 },
      sampleStream: {
        streamVersion: 1,
        rowCount: 187,
        reconciliationState: "reconciled",
      },
      promotedTasting: { scoreBasisPoints: 8800 },
    })
    expect(detail.events).toHaveLength(4)
    expect(detail.annotations).toHaveLength(3)
    expect(detail).not.toHaveProperty("points")
  })

  test("serves a bounded telemetry series and detects stream changes", async () => {
    const response = await request(
      `/api/v1/roasts/${seedIds.roasts.gujiR12}/series?streamVersion=1&maxPoints=25&channels=temperature,ror`
    )
    expect(response.status).toBe(200)
    const series = await response.json()
    expect(series.streamVersion).toBe(1)
    expect(series.downsampled).toBe(true)
    expect(series.points.length).toBeLessThanOrEqual(25)
    expect(series.points[0]).toHaveProperty("temperatureMilliC")
    expect(series.points[0]).toHaveProperty("rorMilliCPerMin")
    expect(series.points[0]).not.toHaveProperty("profileTemperatureMilliC")

    const staleResponse = await request(
      `/api/v1/roasts/${seedIds.roasts.gujiR12}/series?streamVersion=2`
    )
    expect(staleResponse.status).toBe(409)
    expect(await staleResponse.json()).toMatchObject({
      code: "stream_version_changed",
    })
  })
})

test("migrations are repeatable and hash-verified", async () => {
  await migrate(database)
  const migrations = database
    .query("SELECT version, name FROM schema_migrations")
    .all()
  expect(migrations).toEqual([
    { version: 1, name: "initial" },
    { version: 2, name: "roast_brew_workflow" },
    { version: 3, name: "klog_ingestion_safety" },
  ])
})
