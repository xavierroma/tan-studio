import { describe, expect, test } from "bun:test"
import {
  ApiEventSchema,
  ApiProblemSchema,
  InventoryTransactionResourceDtoSchema,
  JobResourceSchema,
  ProviderResourceDtoSchema,
  RecordAcquisitionRequestSchema,
  RoastLibraryQuerySchema,
} from "../src"

const id = "018f0c3a-1111-7111-8111-111111111111"
const id2 = "018f0c3a-2222-7222-8222-222222222222"
const instant = "2026-07-18T17:30:00.000Z"
const hash = "a".repeat(64)

describe("strict resource DTOs", () => {
  test("accepts a provider DTO and rejects unknown transport fields", () => {
    const provider = {
      kind: "provider",
      id,
      revision: 1,
      createdAt: instant,
      updatedAt: instant,
      displayName: "Nordic Approach",
      aliases: ["NA"],
      contact: {
        websiteUrl: "https://nordicapproach.no",
        email: null,
        phone: null,
      },
      referenceNotes: null,
      defaultCurrencyCode: "USD",
      notes: null,
      archivedAt: null,
    }
    expect(ProviderResourceDtoSchema.safeParse(provider).success).toBe(true)
    expect(
      ProviderResourceDtoSchema.safeParse({
        ...provider,
        normalizedName: "must-stay-private",
      }).success
    ).toBe(false)
  })

  test("checks nested acquisition allocation", () => {
    const request = {
      providerId: id,
      purchasedAt: instant,
      receivedAt: instant,
      sourceTimezone: "America/Los_Angeles",
      lines: [
        {
          coffeeId: id2,
          orderedMassMg: 1_000_000,
          receivedMassMg: 1_000_000,
          lots: [
            {
              internalCode: "LOT-01",
              receivedMassMg: 1_000_000,
              receivedAt: instant,
              sourceTimezone: "America/Los_Angeles",
            },
          ],
        },
      ],
    }
    expect(RecordAcquisitionRequestSchema.safeParse(request).success).toBe(true)
    expect(
      RecordAcquisitionRequestSchema.safeParse({
        ...request,
        lines: [{ ...request.lines[0], receivedMassMg: 900_000 }],
      }).success
    ).toBe(false)
  })

  test("rejects inventory signs and references that disagree with the kind", () => {
    const transaction = {
      kind: "inventory_transaction",
      id,
      createdAt: instant,
      lotId: id2,
      transactionKind: "roast_consumption",
      deltaMg: -100_000,
      occurredAt: instant,
      reason: "Roast input",
      sourceRoastId: id,
      transferId: null,
    }
    expect(
      InventoryTransactionResourceDtoSchema.safeParse(transaction).success
    ).toBe(true)
    expect(
      InventoryTransactionResourceDtoSchema.safeParse({
        ...transaction,
        deltaMg: 100_000,
      }).success
    ).toBe(false)
  })
})

describe("Problem Details", () => {
  test("requires strict, safe RFC 9457 extensions", () => {
    const problem = {
      type: "https://tan.studio/problems/invalid-coffee",
      title: "Coffee is invalid",
      status: 422,
      detail: "One or more fields need attention.",
      instance: "/api/v1/coffees",
      code: "invalid_coffee",
      correlationId: "018f0c3a-0000-4000-8000-000000000001",
      retryable: false,
      fieldErrors: [
        {
          path: "/countryCode",
          code: "invalid_country",
          message: "Use an ISO alpha-2 code.",
        },
      ],
    }
    expect(ApiProblemSchema.safeParse(problem).success).toBe(true)
    expect(
      ApiProblemSchema.safeParse({
        ...problem,
        fieldErrors: [{ ...problem.fieldErrors[0], path: "/bad~2pointer" }],
      }).success
    ).toBe(false)
    expect(
      ApiProblemSchema.safeParse({ ...problem, retryAfterMs: 500 }).success
    ).toBe(false)
    expect(
      ApiProblemSchema.safeParse({ ...problem, stack: "secret" }).success
    ).toBe(false)
  })
})

describe("roast library query contract", () => {
  const validQuery = {
    viewVersion: 1,
    filters: {
      op: "and",
      clauses: [
        {
          op: "field",
          field: "countryCode",
          operator: "in",
          value: ["ET", "KE"],
        },
        { op: "search", query: "jasmine" },
      ],
    },
    groups: [{ field: "coffeeId", direction: "asc" }],
    sorts: [{ field: "roastedAt", direction: "desc", nulls: "last" }],
    columns: ["roastId", "roastedAt", "coffeeName"],
    aggregates: [{ key: "count", op: "count" }],
    page: { first: 50 },
  } as const

  test("validates a bounded compound query", () => {
    expect(RoastLibraryQuerySchema.safeParse(validQuery).success).toBe(true)
  })

  test("rejects operators that do not belong to a field family", () => {
    expect(
      RoastLibraryQuerySchema.safeParse({
        ...validQuery,
        filters: {
          op: "field",
          field: "greenInputMassMg",
          operator: "contains",
          value: "10",
        },
      }).success
    ).toBe(false)
    expect(
      RoastLibraryQuerySchema.safeParse({
        ...validQuery,
        filters: {
          op: "field",
          field: "countryCode",
          operator: "in",
          value: "ET",
        },
      }).success
    ).toBe(false)
  })

  test("rejects excessive recursive depth", () => {
    const filters = {
      op: "not",
      clause: {
        op: "not",
        clause: {
          op: "not",
          clause: {
            op: "not",
            clause: { op: "not", clause: { op: "search", query: "deep" } },
          },
        },
      },
    }
    expect(
      RoastLibraryQuerySchema.safeParse({ ...validQuery, filters }).success
    ).toBe(false)
  })
})

describe("jobs and event envelopes", () => {
  test("ties a successful job result to its job type", () => {
    const job = {
      kind: "job",
      id,
      revision: 1,
      createdAt: instant,
      updatedAt: instant,
      jobType: "native_export",
      state: "succeeded",
      progress: {
        basisPoints: 10_000,
        phase: "complete",
        messageCode: "job.complete",
      },
      attempt: 1,
      correlationId: id2,
      cancellationSupported: false,
      result: {
        artifact: {
          hash,
          mediaType: "application/octet-stream",
          byteLength: 100,
          filenameHint: "roast.klog",
        },
      },
    }
    expect(JobResourceSchema.safeParse(job).success).toBe(true)
    expect(
      JobResourceSchema.safeParse({
        ...job,
        jobType: "roast_library_export",
      }).success
    ).toBe(false)
  })

  test("accepts only registered, strict envelopes", () => {
    const heartbeat = {
      schemaVersion: 1,
      sessionId: id,
      seq: 12,
      monotonicMs: 8_000,
      emittedAt: instant,
      type: "system.heartbeat.v1",
      payload: { serverMonotonicMs: 8_000 },
    }
    expect(ApiEventSchema.safeParse(heartbeat).success).toBe(true)
    expect(
      ApiEventSchema.safeParse({
        ...heartbeat,
        payload: { serverMonotonicMs: 8_000, token: "leak" },
      }).success
    ).toBe(false)
    expect(
      ApiEventSchema.safeParse({ ...heartbeat, type: "system.surprise.v1" })
        .success
    ).toBe(false)
  })

  test("rejects malformed live sample batches", () => {
    const event = {
      schemaVersion: 1,
      sessionId: id,
      seq: 13,
      monotonicMs: 8_100,
      emittedAt: instant,
      type: "live.samples.v1",
      payload: {
        liveSessionId: id,
        roastId: id2,
        streamId: "018f0c3a-3333-7333-8333-333333333333",
        sampleSeqStart: 1,
        sampleSeqEnd: 2,
        elapsedMs: [0, 1_000],
        channels: [{ channelId: "bean_temperature", values: [21_000] }],
      },
    }
    expect(ApiEventSchema.safeParse(event).success).toBe(false)
  })
})
