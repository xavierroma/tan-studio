import { describe, expect, test } from "bun:test"
import {
  correlationId,
  createCoffeeIdentity,
  createGreenLot,
  createProvider,
  entityId,
  idempotencyKey,
  instantMs,
  massMg,
  revision,
  type CoffeeIdentity,
  type DomainEvent,
  type EntityId,
  type EntityKind,
  type GreenLot,
  type GreenPurchase,
  type InventoryTransaction,
  type InventoryTransfer,
  type Provider,
  type PurchaseLine,
} from "@tan-studio/domain"
import {
  ApplicationError,
  AdjustInventory,
  CreateProvider,
  QueryRoastLibrary,
  RecordAcquisition,
  TransferInventory,
  UpdateProvider,
  type AuditEntry,
  type CatalogTransaction,
  type CatalogUnitOfWork,
  type Clock,
  type IdGenerator,
  type RoastLibraryQuery,
  type RoastLibraryReadModel,
  type RoastLibraryResult,
} from "../src"

const now = instantMs(1_720_000_000_000)
const commandCorrelationId = correlationId(
  "018f0c3a-0000-4000-8000-000000000001"
)
const commandKey = idempotencyKey("018f0c3a-0000-4000-8000-000000000002")

class SequentialIds implements IdGenerator {
  private value = 0

  next<TKind extends EntityKind>(kind: TKind): EntityId<TKind> {
    this.value += 1
    const group = this.value.toString(16).padStart(4, "0")
    const tail = this.value.toString(16).padStart(12, "0")
    return entityId(
      kind,
      `018f0c3a-${group}-7${group.slice(1)}-8${group.slice(1)}-${tail}`
    )
  }
}

class FixedClock implements Clock {
  now() {
    return now
  }
}

class MemoryCatalogUnitOfWork implements CatalogUnitOfWork {
  readonly providers = new Map<string, Provider>()
  readonly coffees = new Map<string, CoffeeIdentity>()
  readonly purchases: GreenPurchase[] = []
  readonly lines: PurchaseLine[] = []
  readonly lots: GreenLot[] = []
  readonly inventory: InventoryTransaction[] = []
  readonly transfers: InventoryTransfer[] = []
  readonly events: DomainEvent<string, unknown>[] = []
  readonly audits: AuditEntry[] = []

  readonly transaction: CatalogTransaction = {
    catalog: {
      getProvider: async (id) => this.providers.get(id) ?? null,
      findProviderByNormalizedName: async (name) =>
        [...this.providers.values()].find(
          (provider) => provider.normalizedName === name
        ) ?? null,
      insertProvider: async (provider) => {
        this.providers.set(provider.id, provider)
      },
      updateProvider: async (provider) => {
        this.providers.set(provider.id, provider)
      },
      getCoffee: async (id) => this.coffees.get(id) ?? null,
      findCoffeeByNormalizedName: async (name) =>
        [...this.coffees.values()].find(
          (coffee) => coffee.normalizedName === name
        ) ?? null,
      insertCoffee: async (coffee) => {
        this.coffees.set(coffee.id, coffee)
      },
      updateCoffee: async (coffee) => {
        this.coffees.set(coffee.id, coffee)
      },
    },
    purchases: {
      getLot: async (id) => this.lots.find((lot) => lot.id === id) ?? null,
      insertAcquisition: async (purchase, lines, lots) => {
        this.purchases.push(purchase)
        this.lines.push(...lines)
        this.lots.push(...lots)
      },
    },
    inventory: {
      balance: async (lotId) =>
        massMg(
          this.inventory
            .filter((item) => item.lotId === lotId)
            .reduce((sum, item) => sum + item.deltaMg, 0)
        ),
      append: async (transaction) => {
        this.inventory.push(transaction)
      },
      appendTransfer: async (transfer, source, destination) => {
        this.transfers.push(transfer)
        this.inventory.push(source, destination)
      },
    },
    events: {
      append: async (events) => {
        this.events.push(...events)
      },
    },
    audit: {
      append: async (entry) => {
        this.audits.push(entry)
      },
    },
  }

  async run<TResult>(
    work: (transaction: CatalogTransaction) => Promise<TResult>
  ): Promise<TResult> {
    return work(this.transaction)
  }
}

describe("catalog use cases", () => {
  test("creates a provider and its outbox event in one unit of work", async () => {
    const memory = new MemoryCatalogUnitOfWork()
    const useCase = new CreateProvider(
      memory,
      new FixedClock(),
      new SequentialIds()
    )
    const provider = await useCase.execute({
      correlationId: commandCorrelationId,
      displayName: "Sweet Maria's",
    })

    expect(memory.providers.get(provider.id)).toEqual(provider)
    expect(memory.events).toHaveLength(1)
    expect(memory.events[0]?.type).toBe("catalog.providerCreated.v1")
    expect(memory.audits[0]?.targetId).toBe(provider.id)

    await expect(
      useCase.execute({
        correlationId: commandCorrelationId,
        displayName: "  SWEET MARIA'S ",
      })
    ).rejects.toMatchObject({
      category: "conflict",
      code: "provider_name_exists",
    })
  })

  test("records purchase, lot and receipt together", async () => {
    const ids = new SequentialIds()
    const memory = new MemoryCatalogUnitOfWork()
    const provider = createProvider({
      id: ids.next("Provider"),
      displayName: "Nordic Approach",
      now,
    })
    const coffee = createCoffeeIdentity({
      id: ids.next("Coffee"),
      displayName: "Worka Chelbesa",
      countryCode: "ET",
      now,
    })
    memory.providers.set(provider.id, provider)
    memory.coffees.set(coffee.id, coffee)

    const result = await new RecordAcquisition(
      memory,
      new FixedClock(),
      ids
    ).execute({
      correlationId: commandCorrelationId,
      idempotencyKey: commandKey,
      providerId: provider.id,
      purchasedAt: now,
      receivedAt: now,
      sourceTimezone: "America/Los_Angeles",
      lines: [
        {
          coffeeId: coffee.id,
          orderedMassMg: 1_000_000,
          receivedMassMg: 1_000_000,
          lots: [
            {
              internalCode: "NA-WORKA-01",
              receivedMassMg: 1_000_000,
              receivedAt: now,
              sourceTimezone: "America/Los_Angeles",
            },
          ],
        },
      ],
    })

    expect(result.lines).toHaveLength(1)
    expect(result.lots).toHaveLength(1)
    expect(result.receipts[0]?.deltaMg).toBe(1_000_000)
    expect(memory.events[0]?.type).toBe("catalog.greenLotReceived.v1")
  })

  test("guards provider updates with aggregate revision", async () => {
    const ids = new SequentialIds()
    const memory = new MemoryCatalogUnitOfWork()
    const provider = createProvider({
      id: ids.next("Provider"),
      displayName: "Old name",
      now,
    })
    memory.providers.set(provider.id, provider)
    const useCase = new UpdateProvider(memory, new FixedClock(), ids)
    const updated = await useCase.execute({
      correlationId: commandCorrelationId,
      providerId: provider.id,
      expectedRevision: provider.revision,
      displayName: "New name",
      aliases: ["Previous supplier name"],
    })
    expect(updated.displayName).toBe("New name")
    expect(updated.revision).toBe(2)
    await expect(
      useCase.execute({
        correlationId: commandCorrelationId,
        providerId: provider.id,
        expectedRevision: revision(1),
        notes: "Stale update",
      })
    ).rejects.toMatchObject({ code: "revision_conflict" })
  })

  test("transfers inventory as one balanced operation", async () => {
    const ids = new SequentialIds()
    const memory = new MemoryCatalogUnitOfWork()
    const sourceLotId = ids.next("GreenLot")
    const destinationLotId = ids.next("GreenLot")
    const purchaseLineId = ids.next("PurchaseLine")
    memory.lots.push(
      createGreenLot({
        id: sourceLotId,
        purchaseLineId,
        internalCode: "SOURCE",
        receivedMassMg: 1_000_000,
        receivedAt: now,
        sourceTimezone: "America/Los_Angeles",
        now,
      }),
      createGreenLot({
        id: destinationLotId,
        purchaseLineId,
        internalCode: "DESTINATION",
        receivedMassMg: 1,
        receivedAt: now,
        sourceTimezone: "America/Los_Angeles",
        now,
      })
    )
    memory.inventory.push({
      id: ids.next("InventoryTransaction"),
      lotId: sourceLotId,
      kind: "receipt",
      deltaMg: massMg(1_000_000),
      occurredAt: now,
      reason: "Initial receipt",
      sourceRoastId: null,
      transferId: null,
      idempotencyKey: commandKey,
    })
    const result = await new TransferInventory(
      memory,
      new FixedClock(),
      ids
    ).execute({
      correlationId: commandCorrelationId,
      sourceLotId,
      destinationLotId,
      massMg: 250_000,
      reason: "Split storage",
      idempotencyKey: commandKey,
    })
    expect(result.source.deltaMg + result.destination.deltaMg).toBe(0)
    expect(memory.transfers).toHaveLength(1)
  })

  test("blocks a stock adjustment that would silently go negative", async () => {
    const ids = new SequentialIds()
    const memory = new MemoryCatalogUnitOfWork()
    const lot = createGreenLot({
      id: ids.next("GreenLot"),
      purchaseLineId: ids.next("PurchaseLine"),
      internalCode: "ADJUST",
      receivedMassMg: 100_000,
      receivedAt: now,
      sourceTimezone: "America/Los_Angeles",
      now,
    })
    memory.lots.push(lot)
    await expect(
      new AdjustInventory(memory, new FixedClock(), ids).execute({
        correlationId: commandCorrelationId,
        lotId: lot.id,
        kind: "write_off",
        deltaMg: -1,
        reason: "No balance has been received into the test ledger",
        idempotencyKey: commandKey,
      })
    ).rejects.toMatchObject({ code: "insufficient_inventory" })
  })
})

describe("roast library query use case", () => {
  const emptyResult: RoastLibraryResult = {
    kind: "rows",
    scope: [],
    rows: [],
    aggregates: {},
    pageInfo: { hasNextPage: false },
  }
  const validQuery: RoastLibraryQuery = {
    viewVersion: 1,
    filters: { op: "search", query: "ethiopia" },
    groups: [],
    sorts: [{ field: "roastedAt", direction: "desc", nulls: "last" }],
    columns: ["roastId", "roastedAt", "coffeeName"],
    aggregates: [],
    page: { first: 50 },
  }

  test("validates bounds before invoking the read model", async () => {
    let calls = 0
    const readModel: RoastLibraryReadModel = {
      query: async () => {
        calls += 1
        return emptyResult
      },
    }
    const useCase = new QueryRoastLibrary(readModel)
    expect(await useCase.execute(validQuery)).toEqual(emptyResult)
    expect(calls).toBe(1)

    await expect(
      useCase.execute({ ...validQuery, page: { first: 201 } })
    ).rejects.toBeInstanceOf(ApplicationError)
    expect(calls).toBe(1)
  })

  test("does not dispatch an already-cancelled query", async () => {
    const readModel: RoastLibraryReadModel = { query: async () => emptyResult }
    const controller = new AbortController()
    controller.abort()
    await expect(
      new QueryRoastLibrary(readModel).execute(validQuery, controller.signal)
    ).rejects.toMatchObject({ code: "query_cancelled" })
  })
})
