import type {
  CoffeeId,
  GreenLotId,
  ProviderId,
  PurchaseId,
  PurchaseLineId,
} from "../shared/ids"
import type {
  InstantMs,
  MassMg,
  MoneyMinorUnits,
  Revision,
} from "../shared/units"
import { nonNegativeMassMg, positiveMassMg, revision } from "../shared/units"
import { invariant } from "../shared/errors"
import { assertIanaTimezone, optionalText, requiredText } from "../shared/text"

export type GreenPurchase = Readonly<{
  id: PurchaseId
  providerId: ProviderId
  purchasedAt: InstantMs
  receivedAt: InstantMs | null
  sourceTimezone: string
  supplierReference: string | null
  currencyCode: string | null
  totalMinorUnits: MoneyMinorUnits | null
  notes: string | null
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type PurchaseLine = Readonly<{
  id: PurchaseLineId
  purchaseId: PurchaseId
  coffeeId: CoffeeId
  orderedMassMg: MassMg
  receivedMassMg: MassMg
  costMinorUnits: MoneyMinorUnits | null
  notes: string | null
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type GreenLotState = "active" | "depleted" | "archived"

export type GreenLot = Readonly<{
  id: GreenLotId
  purchaseLineId: PurchaseLineId
  supplierCode: string | null
  internalCode: string
  receivedMassMg: MassMg
  receivedAt: InstantMs
  sourceTimezone: string
  storageLocation: string | null
  storageNotes: string | null
  state: GreenLotState
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type CreateGreenPurchaseInput = Readonly<{
  id: PurchaseId
  providerId: ProviderId
  purchasedAt: InstantMs
  receivedAt?: InstantMs | null
  sourceTimezone: string
  supplierReference?: string | null
  currencyCode?: string | null
  totalMinorUnits?: MoneyMinorUnits | null
  notes?: string | null
  now: InstantMs
}>

function currencyCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null
  const code = value.trim().toUpperCase()
  invariant(
    /^[A-Z]{3}$/.test(code),
    "invalid_currency_code",
    "Currency code must be ISO 4217 format",
    "currencyCode"
  )
  return code
}

export function createGreenPurchase(
  input: CreateGreenPurchaseInput
): GreenPurchase {
  const currency = currencyCode(input.currencyCode)
  const total = input.totalMinorUnits ?? null
  invariant(
    (currency === null) === (total === null),
    "incomplete_money",
    "Currency and total must be supplied together",
    "totalMinorUnits"
  )
  if (input.receivedAt !== null && input.receivedAt !== undefined) {
    invariant(
      input.receivedAt >= input.purchasedAt,
      "received_before_purchase",
      "Received time cannot precede purchase time",
      "receivedAt"
    )
  }

  return Object.freeze({
    id: input.id,
    providerId: input.providerId,
    purchasedAt: input.purchasedAt,
    receivedAt: input.receivedAt ?? null,
    sourceTimezone: assertIanaTimezone(input.sourceTimezone),
    supplierReference: optionalText(
      input.supplierReference,
      "supplierReference",
      200
    ),
    currencyCode: currency,
    totalMinorUnits: total,
    notes: optionalText(input.notes, "notes", 10_000),
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type CreatePurchaseLineInput = Readonly<{
  id: PurchaseLineId
  purchaseId: PurchaseId
  coffeeId: CoffeeId
  orderedMassMg: number
  receivedMassMg: number
  costMinorUnits?: MoneyMinorUnits | null
  notes?: string | null
  now: InstantMs
}>

export function createPurchaseLine(
  input: CreatePurchaseLineInput
): PurchaseLine {
  const ordered = nonNegativeMassMg(input.orderedMassMg, "orderedMassMg")
  const received = nonNegativeMassMg(input.receivedMassMg, "receivedMassMg")
  invariant(
    ordered > 0 || received > 0,
    "empty_purchase_line",
    "A purchase line must have ordered or received mass",
    "orderedMassMg"
  )
  return Object.freeze({
    id: input.id,
    purchaseId: input.purchaseId,
    coffeeId: input.coffeeId,
    orderedMassMg: ordered,
    receivedMassMg: received,
    costMinorUnits: input.costMinorUnits ?? null,
    notes: optionalText(input.notes, "notes", 2_000),
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type CreateGreenLotInput = Readonly<{
  id: GreenLotId
  purchaseLineId: PurchaseLineId
  supplierCode?: string | null
  internalCode: string
  receivedMassMg: number
  receivedAt: InstantMs
  sourceTimezone: string
  storageLocation?: string | null
  storageNotes?: string | null
  now: InstantMs
}>

export function createGreenLot(input: CreateGreenLotInput): GreenLot {
  return Object.freeze({
    id: input.id,
    purchaseLineId: input.purchaseLineId,
    supplierCode: optionalText(input.supplierCode, "supplierCode", 100),
    internalCode: requiredText(input.internalCode, "internalCode", 100),
    receivedMassMg: positiveMassMg(input.receivedMassMg, "receivedMassMg"),
    receivedAt: input.receivedAt,
    sourceTimezone: assertIanaTimezone(input.sourceTimezone),
    storageLocation: optionalText(
      input.storageLocation,
      "storageLocation",
      200
    ),
    storageNotes: optionalText(input.storageNotes, "storageNotes", 2_000),
    state: "active",
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}
