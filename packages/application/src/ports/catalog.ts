import type {
  CoffeeId,
  CoffeeIdentity,
  DomainEvent,
  GreenLot,
  GreenLotId,
  GreenPurchase,
  InventoryTransaction,
  InventoryTransfer,
  MassMg,
  Provider,
  ProviderId,
  PurchaseLine,
  Revision,
} from "@tan-studio/domain"

export interface CatalogRepository {
  getProvider(id: ProviderId): Promise<Provider | null>
  findProviderByNormalizedName(normalizedName: string): Promise<Provider | null>
  insertProvider(provider: Provider): Promise<void>
  updateProvider(provider: Provider, expectedRevision: Revision): Promise<void>

  getCoffee(id: CoffeeId): Promise<CoffeeIdentity | null>
  findCoffeeByNormalizedName(
    normalizedName: string
  ): Promise<CoffeeIdentity | null>
  insertCoffee(coffee: CoffeeIdentity): Promise<void>
  updateCoffee(
    coffee: CoffeeIdentity,
    expectedRevision: Revision
  ): Promise<void>
}

export interface PurchaseRepository {
  getLot(id: GreenLotId): Promise<GreenLot | null>
  insertAcquisition(
    purchase: GreenPurchase,
    lines: readonly PurchaseLine[],
    lots: readonly GreenLot[]
  ): Promise<void>
}

export interface InventoryLedgerRepository {
  balance(lotId: GreenLotId): Promise<MassMg>
  append(transaction: InventoryTransaction): Promise<void>
  appendTransfer(
    transfer: InventoryTransfer,
    source: InventoryTransaction,
    destination: InventoryTransaction
  ): Promise<void>
}

export interface DomainEventOutboxPort {
  append(events: readonly DomainEvent<string, unknown>[]): Promise<void>
}

export type AuditEntry = Readonly<{
  action: string
  targetKind: string
  targetId: string
  targetRevision: number | null
  correlationId: string
  summary: Readonly<Record<string, string | number | boolean | null>>
}>

export interface AuditPort {
  append(entry: AuditEntry): Promise<void>
}

export type CatalogTransaction = Readonly<{
  catalog: CatalogRepository
  purchases: PurchaseRepository
  inventory: InventoryLedgerRepository
  events: DomainEventOutboxPort
  audit: AuditPort
}>

export interface CatalogUnitOfWork {
  run<TResult>(
    work: (transaction: CatalogTransaction) => Promise<TResult>
  ): Promise<TResult>
}
