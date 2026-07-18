import {
  createCoffeeIdentity,
  createGreenLot,
  createGreenPurchase,
  createInventoryTransaction,
  createInventoryTransfer,
  createProvider,
  createPurchaseLine,
  domainEvent,
  archiveCoffeeIdentity,
  archiveProvider,
  moneyMinorUnits,
  normalizedLookup,
  updateCoffeeIdentity,
  updateProvider,
  type CoffeeId,
  type CoffeeIdentity,
  type CorrelationId,
  type GreenLot,
  type GreenLotId,
  type GreenPurchase,
  type IdempotencyKey,
  type InstantMs,
  type InventoryTransaction,
  type InventoryTransferResult,
  type InventoryTransactionKind,
  type Provider,
  type ProviderId,
  type PurchaseLine,
  type ProviderContactInput,
  type Revision,
} from "@tan-studio/domain"
import { ApplicationError, conflict, mapDomainError, notFound } from "../errors"
import type { CatalogUnitOfWork } from "../ports/catalog"
import type { Clock, IdGenerator } from "../ports/system"

type MutationContext = Readonly<{ correlationId: CorrelationId }>

export type CreateProviderCommand = Readonly<
  MutationContext & {
    displayName: string
    aliases?: readonly string[]
    contact?: ProviderContactInput
    referenceNotes?: string | null
    defaultCurrencyCode?: string | null
    notes?: string | null
  }
>

export class CreateProvider {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: CreateProviderCommand): Promise<Provider> {
    try {
      const now = this.clock.now()
      const provider = createProvider({
        id: this.ids.next("Provider"),
        displayName: command.displayName,
        ...(command.aliases !== undefined ? { aliases: command.aliases } : {}),
        ...(command.contact !== undefined ? { contact: command.contact } : {}),
        ...(command.referenceNotes !== undefined
          ? { referenceNotes: command.referenceNotes }
          : {}),
        ...(command.defaultCurrencyCode !== undefined
          ? { defaultCurrencyCode: command.defaultCurrencyCode }
          : {}),
        ...(command.notes !== undefined ? { notes: command.notes } : {}),
        now,
      })

      return await this.unitOfWork.run(async (transaction) => {
        if (
          await transaction.catalog.findProviderByNormalizedName(
            provider.normalizedName
          )
        ) {
          throw conflict(
            "provider_name_exists",
            "A provider with this normalized name already exists",
            "displayName"
          )
        }
        await transaction.catalog.insertProvider(provider)
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "catalog.providerCreated.v1",
            aggregateId: provider.id,
            aggregateRevision: provider.revision,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: { providerId: provider.id },
          }),
        ])
        await transaction.audit.append({
          action: "catalog.provider_created",
          targetKind: "provider",
          targetId: provider.id,
          targetRevision: provider.revision,
          correlationId: command.correlationId,
          summary: { displayName: provider.displayName },
        })
        return provider
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

export type CreateCoffeeCommand = Readonly<
  MutationContext & {
    displayName: string
    countryCode?: string | null
    region?: string | null
    farmProducer?: string | null
    stationCooperative?: string | null
    process?: string | null
    varieties?: readonly string[]
    altitudeMinMetres?: number | null
    altitudeMaxMetres?: number | null
    harvestLabel?: string | null
    notes?: string | null
  }
>

export class CreateCoffee {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: CreateCoffeeCommand): Promise<CoffeeIdentity> {
    try {
      const now = this.clock.now()
      const coffee = createCoffeeIdentity({
        id: this.ids.next("Coffee"),
        displayName: command.displayName,
        ...(command.countryCode !== undefined
          ? { countryCode: command.countryCode }
          : {}),
        ...(command.region !== undefined ? { region: command.region } : {}),
        ...(command.farmProducer !== undefined
          ? { farmProducer: command.farmProducer }
          : {}),
        ...(command.stationCooperative !== undefined
          ? { stationCooperative: command.stationCooperative }
          : {}),
        ...(command.process !== undefined ? { process: command.process } : {}),
        ...(command.varieties !== undefined
          ? { varieties: command.varieties }
          : {}),
        ...(command.altitudeMinMetres !== undefined
          ? { altitudeMinMetres: command.altitudeMinMetres }
          : {}),
        ...(command.altitudeMaxMetres !== undefined
          ? { altitudeMaxMetres: command.altitudeMaxMetres }
          : {}),
        ...(command.harvestLabel !== undefined
          ? { harvestLabel: command.harvestLabel }
          : {}),
        ...(command.notes !== undefined ? { notes: command.notes } : {}),
        now,
      })
      return await this.unitOfWork.run(async (transaction) => {
        if (
          await transaction.catalog.findCoffeeByNormalizedName(
            coffee.normalizedName
          )
        ) {
          throw conflict(
            "coffee_name_exists",
            "A coffee with this normalized name already exists",
            "displayName"
          )
        }
        await transaction.catalog.insertCoffee(coffee)
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "catalog.coffeeIdentityCreated.v1",
            aggregateId: coffee.id,
            aggregateRevision: coffee.revision,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: { coffeeId: coffee.id },
          }),
        ])
        return coffee
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

export type UpdateProviderCommand = Readonly<
  MutationContext & {
    providerId: ProviderId
    expectedRevision: Revision
    displayName?: string
    aliases?: readonly string[]
    contact?: ProviderContactInput
    referenceNotes?: string | null
    defaultCurrencyCode?: string | null
    notes?: string | null
  }
>

export class UpdateProvider {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: UpdateProviderCommand): Promise<Provider> {
    try {
      const now = this.clock.now()
      return await this.unitOfWork.run(async (transaction) => {
        const current = await transaction.catalog.getProvider(
          command.providerId
        )
        if (!current)
          throw notFound(
            "provider_not_found",
            "Provider was not found",
            "providerId"
          )
        if (current.revision !== command.expectedRevision) {
          throw conflict(
            "revision_conflict",
            "Provider changed since it was read",
            "expectedRevision"
          )
        }
        const updated = updateProvider(
          current,
          {
            ...(command.displayName !== undefined
              ? { displayName: command.displayName }
              : {}),
            ...(command.aliases !== undefined
              ? { aliases: command.aliases }
              : {}),
            ...(command.contact !== undefined
              ? { contact: command.contact }
              : {}),
            ...(command.referenceNotes !== undefined
              ? { referenceNotes: command.referenceNotes }
              : {}),
            ...(command.defaultCurrencyCode !== undefined
              ? { defaultCurrencyCode: command.defaultCurrencyCode }
              : {}),
            ...(command.notes !== undefined ? { notes: command.notes } : {}),
          },
          now
        )
        const duplicate =
          await transaction.catalog.findProviderByNormalizedName(
            updated.normalizedName
          )
        if (duplicate && duplicate.id !== current.id) {
          throw conflict(
            "provider_name_exists",
            "A provider with this normalized name already exists",
            "displayName"
          )
        }
        await transaction.catalog.updateProvider(updated, current.revision)
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "catalog.providerUpdated.v1",
            aggregateId: updated.id,
            aggregateRevision: updated.revision,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: { providerId: updated.id },
          }),
        ])
        return updated
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

export type UpdateCoffeeCommand = Readonly<
  MutationContext & {
    coffeeId: CoffeeId
    expectedRevision: Revision
    displayName?: string
    countryCode?: string | null
    region?: string | null
    farmProducer?: string | null
    stationCooperative?: string | null
    process?: string | null
    varieties?: readonly string[]
    altitudeMinMetres?: number | null
    altitudeMaxMetres?: number | null
    harvestLabel?: string | null
    notes?: string | null
  }
>

export class UpdateCoffee {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: UpdateCoffeeCommand): Promise<CoffeeIdentity> {
    try {
      const now = this.clock.now()
      return await this.unitOfWork.run(async (transaction) => {
        const current = await transaction.catalog.getCoffee(command.coffeeId)
        if (!current)
          throw notFound("coffee_not_found", "Coffee was not found", "coffeeId")
        if (current.revision !== command.expectedRevision) {
          throw conflict(
            "revision_conflict",
            "Coffee changed since it was read",
            "expectedRevision"
          )
        }
        const {
          coffeeId: _coffeeId,
          expectedRevision: _expectedRevision,
          correlationId: _correlationId,
          ...patch
        } = command
        const updated = updateCoffeeIdentity(current, patch, now)
        const duplicate = await transaction.catalog.findCoffeeByNormalizedName(
          updated.normalizedName
        )
        if (duplicate && duplicate.id !== current.id) {
          throw conflict(
            "coffee_name_exists",
            "A coffee with this normalized name already exists",
            "displayName"
          )
        }
        await transaction.catalog.updateCoffee(updated, current.revision)
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "catalog.coffeeIdentityUpdated.v1",
            aggregateId: updated.id,
            aggregateRevision: updated.revision,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: { coffeeId: updated.id },
          }),
        ])
        return updated
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

export type ArchiveCatalogEntityCommand = Readonly<
  MutationContext & {
    expectedRevision: Revision
  }
> &
  (
    | Readonly<{ kind: "provider"; id: ProviderId }>
    | Readonly<{ kind: "coffee"; id: CoffeeId }>
  )

export class ArchiveCatalogEntity {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(
    command: ArchiveCatalogEntityCommand
  ): Promise<Provider | CoffeeIdentity> {
    const now = this.clock.now()
    return this.unitOfWork.run(async (transaction) => {
      if (command.kind === "provider") {
        const current = await transaction.catalog.getProvider(command.id)
        if (!current)
          throw notFound("provider_not_found", "Provider was not found", "id")
        if (current.revision !== command.expectedRevision)
          throw conflict(
            "revision_conflict",
            "Provider changed since it was read",
            "expectedRevision"
          )
        const archived = archiveProvider(current, now)
        await transaction.catalog.updateProvider(archived, current.revision)
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "catalog.providerArchived.v1",
            aggregateId: archived.id,
            aggregateRevision: archived.revision,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: { providerId: archived.id },
          }),
        ])
        return archived
      }
      const current = await transaction.catalog.getCoffee(command.id)
      if (!current)
        throw notFound("coffee_not_found", "Coffee was not found", "id")
      if (current.revision !== command.expectedRevision)
        throw conflict(
          "revision_conflict",
          "Coffee changed since it was read",
          "expectedRevision"
        )
      const archived = archiveCoffeeIdentity(current, now)
      await transaction.catalog.updateCoffee(archived, current.revision)
      await transaction.events.append([
        domainEvent({
          eventId: this.ids.next("DomainEvent"),
          type: "catalog.coffeeIdentityArchived.v1",
          aggregateId: archived.id,
          aggregateRevision: archived.revision,
          eventOrdinal: 0,
          occurredAt: now,
          correlationId: command.correlationId,
          causationId: null,
          payload: { coffeeId: archived.id },
        }),
      ])
      return archived
    })
  }
}

export type RecordAcquisitionLot = Readonly<{
  internalCode: string
  supplierCode?: string | null
  receivedMassMg: number
  receivedAt: InstantMs
  sourceTimezone: string
  storageLocation?: string | null
  storageNotes?: string | null
  receiptReason?: string
}>

export type RecordAcquisitionLine = Readonly<{
  coffeeId: CoffeeId
  orderedMassMg: number
  receivedMassMg: number
  costMinorUnits?: number | null
  notes?: string | null
  lots: readonly RecordAcquisitionLot[]
}>

export type RecordAcquisitionCommand = Readonly<
  MutationContext & {
    providerId: ProviderId
    purchasedAt: InstantMs
    receivedAt?: InstantMs | null
    sourceTimezone: string
    supplierReference?: string | null
    currencyCode?: string | null
    totalMinorUnits?: number | null
    notes?: string | null
    lines: readonly RecordAcquisitionLine[]
    idempotencyKey: IdempotencyKey
  }
>

export type RecordedAcquisition = Readonly<{
  purchase: GreenPurchase
  lines: readonly PurchaseLine[]
  lots: readonly GreenLot[]
  receipts: readonly InventoryTransaction[]
}>

export class RecordAcquisition {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(
    command: RecordAcquisitionCommand
  ): Promise<RecordedAcquisition> {
    try {
      if (command.lines.length === 0) {
        throw new ApplicationError(
          "validation",
          "acquisition_lines_required",
          "An acquisition needs at least one line",
          { field: "lines" }
        )
      }
      if (command.lines.length > 200) {
        throw new ApplicationError(
          "validation",
          "too_many_acquisition_lines",
          "An acquisition has too many lines",
          { field: "lines" }
        )
      }
      const now = this.clock.now()
      const providerId = command.providerId
      const purchase = createGreenPurchase({
        id: this.ids.next("Purchase"),
        providerId,
        purchasedAt: command.purchasedAt,
        ...(command.receivedAt !== undefined
          ? { receivedAt: command.receivedAt }
          : {}),
        sourceTimezone: command.sourceTimezone,
        ...(command.supplierReference !== undefined
          ? { supplierReference: command.supplierReference }
          : {}),
        ...(command.currencyCode !== undefined
          ? { currencyCode: command.currencyCode }
          : {}),
        totalMinorUnits:
          command.totalMinorUnits === null ||
          command.totalMinorUnits === undefined
            ? null
            : moneyMinorUnits(command.totalMinorUnits),
        ...(command.notes !== undefined ? { notes: command.notes } : {}),
        now,
      })

      return await this.unitOfWork.run(async (transaction) => {
        const provider = await transaction.catalog.getProvider(providerId)
        if (!provider)
          throw notFound(
            "provider_not_found",
            "Provider was not found",
            "providerId"
          )
        if (provider.archivedAt !== null)
          throw conflict(
            "provider_archived",
            "Archived provider cannot receive a purchase",
            "providerId"
          )

        const lines: PurchaseLine[] = []
        const lots: GreenLot[] = []
        const receipts: InventoryTransaction[] = []
        for (const [lineIndex, lineInput] of command.lines.entries()) {
          const coffeeId = lineInput.coffeeId
          const coffee = await transaction.catalog.getCoffee(coffeeId)
          if (!coffee)
            throw notFound(
              "coffee_not_found",
              "Coffee was not found",
              `lines/${lineIndex}/coffeeId`
            )
          if (coffee.archivedAt !== null)
            throw conflict(
              "coffee_archived",
              "Archived coffee cannot receive a purchase",
              `lines/${lineIndex}/coffeeId`
            )
          const lotTotal = lineInput.lots.reduce(
            (sum, lot) => sum + lot.receivedMassMg,
            0
          )
          if (
            !Number.isSafeInteger(lotTotal) ||
            lotTotal !== lineInput.receivedMassMg
          ) {
            throw new ApplicationError(
              "validation",
              "lot_mass_mismatch",
              "Lot masses must add up to the line received mass",
              {
                field: `lines/${lineIndex}/receivedMassMg`,
              }
            )
          }

          const line = createPurchaseLine({
            id: this.ids.next("PurchaseLine"),
            purchaseId: purchase.id,
            coffeeId,
            orderedMassMg: lineInput.orderedMassMg,
            receivedMassMg: lineInput.receivedMassMg,
            costMinorUnits:
              lineInput.costMinorUnits === null ||
              lineInput.costMinorUnits === undefined
                ? null
                : moneyMinorUnits(lineInput.costMinorUnits),
            ...(lineInput.notes !== undefined
              ? { notes: lineInput.notes }
              : {}),
            now,
          })
          lines.push(line)

          for (const lotInput of lineInput.lots) {
            const lot = createGreenLot({
              id: this.ids.next("GreenLot"),
              purchaseLineId: line.id,
              ...lotInput,
              receivedAt: lotInput.receivedAt,
              now,
            })
            const receipt = createInventoryTransaction({
              id: this.ids.next("InventoryTransaction"),
              lotId: lot.id,
              kind: "receipt",
              deltaMg: lot.receivedMassMg,
              occurredAt: lot.receivedAt,
              reason: lotInput.receiptReason ?? "Initial lot receipt",
              idempotencyKey: command.idempotencyKey,
            })
            lots.push(lot)
            receipts.push(receipt)
          }
        }

        await transaction.purchases.insertAcquisition(purchase, lines, lots)
        for (const receipt of receipts)
          await transaction.inventory.append(receipt)
        await transaction.events.append(
          lots.map((lot, index) =>
            domainEvent({
              eventId: this.ids.next("DomainEvent"),
              type: "catalog.greenLotReceived.v1",
              aggregateId: purchase.id,
              aggregateRevision: purchase.revision,
              eventOrdinal: index,
              occurredAt: now,
              correlationId: command.correlationId,
              causationId: null,
              payload: {
                purchaseId: purchase.id,
                lotId: lot.id,
                receivedMassMg: lot.receivedMassMg,
              },
            })
          )
        )
        await transaction.audit.append({
          action: "catalog.acquisition_recorded",
          targetKind: "purchase",
          targetId: purchase.id,
          targetRevision: purchase.revision,
          correlationId: command.correlationId,
          summary: { lineCount: lines.length, lotCount: lots.length },
        })
        return Object.freeze({
          purchase,
          lines: Object.freeze(lines),
          lots: Object.freeze(lots),
          receipts: Object.freeze(receipts),
        })
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

export type TransferInventoryCommand = Readonly<
  MutationContext & {
    sourceLotId: GreenLotId
    destinationLotId: GreenLotId
    massMg: number
    reason: string
    idempotencyKey: IdempotencyKey
    allowNegativeBalance?: boolean
  }
>

export class TransferInventory {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(
    command: TransferInventoryCommand
  ): Promise<InventoryTransferResult> {
    try {
      const now = this.clock.now()
      return await this.unitOfWork.run(async (transaction) => {
        const [sourceLot, destinationLot] = await Promise.all([
          transaction.purchases.getLot(command.sourceLotId),
          transaction.purchases.getLot(command.destinationLotId),
        ])
        if (!sourceLot)
          throw notFound(
            "source_lot_not_found",
            "Source lot was not found",
            "sourceLotId"
          )
        if (!destinationLot)
          throw notFound(
            "destination_lot_not_found",
            "Destination lot was not found",
            "destinationLotId"
          )
        if (
          sourceLot.state === "archived" ||
          destinationLot.state === "archived"
        ) {
          throw conflict(
            "lot_archived",
            "Inventory cannot be transferred to or from an archived lot",
            "sourceLotId"
          )
        }
        const sourceBalanceMg = await transaction.inventory.balance(
          command.sourceLotId
        )
        const result = createInventoryTransfer({
          transferId: this.ids.next("InventoryTransfer"),
          sourceTransactionId: this.ids.next("InventoryTransaction"),
          destinationTransactionId: this.ids.next("InventoryTransaction"),
          sourceLotId: command.sourceLotId,
          destinationLotId: command.destinationLotId,
          massMg: command.massMg,
          sourceBalanceMg,
          occurredAt: now,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
          ...(command.allowNegativeBalance !== undefined
            ? { allowNegativeBalance: command.allowNegativeBalance }
            : {}),
        })
        await transaction.inventory.appendTransfer(
          result.transfer,
          result.source,
          result.destination
        )
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "inventory.inventoryTransferred.v1",
            aggregateId: result.transfer.id,
            aggregateRevision: 1,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: {
              transferId: result.transfer.id,
              sourceLotId: result.transfer.sourceLotId,
              destinationLotId: result.transfer.destinationLotId,
              massMg: result.transfer.massMg,
            },
          }),
        ])
        return result
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

export type AdjustInventoryCommand = Readonly<
  MutationContext & {
    lotId: GreenLotId
    kind: Extract<InventoryTransactionKind, "adjustment" | "write_off">
    deltaMg: number
    reason: string
    idempotencyKey: IdempotencyKey
    allowNegativeBalance?: boolean
  }
>

export class AdjustInventory {
  constructor(
    private readonly unitOfWork: CatalogUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(
    command: AdjustInventoryCommand
  ): Promise<InventoryTransaction> {
    try {
      const now = this.clock.now()
      return await this.unitOfWork.run(async (transaction) => {
        const lot = await transaction.purchases.getLot(command.lotId)
        if (!lot) throw notFound("lot_not_found", "Lot was not found", "lotId")
        if (lot.state === "archived")
          throw conflict(
            "lot_archived",
            "Archived lot inventory cannot be adjusted",
            "lotId"
          )
        const currentBalance = await transaction.inventory.balance(
          command.lotId
        )
        if (
          command.allowNegativeBalance !== true &&
          currentBalance + command.deltaMg < 0
        ) {
          throw new ApplicationError(
            "validation",
            "insufficient_inventory",
            "Adjustment would make lot inventory negative",
            { field: "deltaMg" }
          )
        }
        const adjustment = createInventoryTransaction({
          id: this.ids.next("InventoryTransaction"),
          lotId: command.lotId,
          kind: command.kind,
          deltaMg: command.deltaMg,
          occurredAt: now,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
        })
        await transaction.inventory.append(adjustment)
        await transaction.events.append([
          domainEvent({
            eventId: this.ids.next("DomainEvent"),
            type: "inventory.inventoryAdjusted.v1",
            aggregateId: adjustment.id,
            aggregateRevision: 1,
            eventOrdinal: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            causationId: null,
            payload: {
              transactionId: adjustment.id,
              lotId: adjustment.lotId,
              deltaMg: adjustment.deltaMg,
            },
          }),
        ])
        return adjustment
      })
    } catch (error) {
      mapDomainError(error)
    }
  }
}

// Kept private to this module so transport DTOs never become application commands.
export const normalizeCatalogLookup = normalizedLookup
