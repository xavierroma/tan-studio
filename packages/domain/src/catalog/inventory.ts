import type {
  GreenLotId,
  IdempotencyKey,
  InventoryTransactionId,
  InventoryTransferId,
  RoastId,
} from "../shared/ids"
import type { InstantMs, MassMg } from "../shared/units"
import { massMg, positiveMassMg } from "../shared/units"
import { invariant } from "../shared/errors"
import { requiredText } from "../shared/text"

export type InventoryTransactionKind =
  | "receipt"
  | "roast_consumption"
  | "adjustment"
  | "transfer_in"
  | "transfer_out"
  | "write_off"

export type InventoryTransaction = Readonly<{
  id: InventoryTransactionId
  lotId: GreenLotId
  kind: InventoryTransactionKind
  deltaMg: MassMg
  occurredAt: InstantMs
  reason: string
  sourceRoastId: RoastId | null
  transferId: InventoryTransferId | null
  idempotencyKey: IdempotencyKey
}>

export type InventoryTransfer = Readonly<{
  id: InventoryTransferId
  sourceLotId: GreenLotId
  destinationLotId: GreenLotId
  massMg: MassMg
  occurredAt: InstantMs
  reason: string
  idempotencyKey: IdempotencyKey
}>

export type InventoryTransferResult = Readonly<{
  transfer: InventoryTransfer
  source: InventoryTransaction
  destination: InventoryTransaction
}>

export type CreateInventoryTransactionInput = Readonly<{
  id: InventoryTransactionId
  lotId: GreenLotId
  kind: InventoryTransactionKind
  deltaMg: number
  occurredAt: InstantMs
  reason: string
  sourceRoastId?: RoastId | null
  transferId?: InventoryTransferId | null
  idempotencyKey: IdempotencyKey
}>

export function createInventoryTransaction(
  input: CreateInventoryTransactionInput
): InventoryTransaction {
  const delta = massMg(input.deltaMg)
  const sourceRoastId = input.sourceRoastId ?? null
  const transferId = input.transferId ?? null
  invariant(
    delta !== 0,
    "zero_inventory_delta",
    "Inventory transaction cannot have a zero delta",
    "deltaMg"
  )

  switch (input.kind) {
    case "receipt":
      invariant(
        delta > 0 && sourceRoastId === null && transferId === null,
        "invalid_receipt",
        "Receipt must be positive and have no source roast or transfer",
        "deltaMg"
      )
      break
    case "roast_consumption":
      invariant(
        delta < 0 && sourceRoastId !== null && transferId === null,
        "invalid_roast_consumption",
        "Roast consumption must be negative and reference exactly one roast",
        "deltaMg"
      )
      break
    case "adjustment":
      invariant(
        sourceRoastId === null && transferId === null,
        "invalid_adjustment",
        "Adjustment cannot reference a roast or transfer",
        "kind"
      )
      break
    case "transfer_in":
      invariant(
        delta > 0 && transferId !== null && sourceRoastId === null,
        "invalid_transfer_in",
        "Transfer-in must be positive and reference a transfer",
        "deltaMg"
      )
      break
    case "transfer_out":
      invariant(
        delta < 0 && transferId !== null && sourceRoastId === null,
        "invalid_transfer_out",
        "Transfer-out must be negative and reference a transfer",
        "deltaMg"
      )
      break
    case "write_off":
      invariant(
        delta < 0 && sourceRoastId === null && transferId === null,
        "invalid_write_off",
        "Write-off must be negative and have no source references",
        "deltaMg"
      )
      break
  }

  return Object.freeze({
    id: input.id,
    lotId: input.lotId,
    kind: input.kind,
    deltaMg: delta,
    occurredAt: input.occurredAt,
    reason: requiredText(input.reason, "reason", 1_000),
    sourceRoastId,
    transferId,
    idempotencyKey: input.idempotencyKey,
  })
}

export function inventoryBalance(
  lotId: GreenLotId,
  transactions: readonly InventoryTransaction[]
): MassMg {
  let balance = 0
  for (const transaction of transactions) {
    invariant(
      transaction.lotId === lotId,
      "mixed_inventory_lots",
      "Inventory balance can only be computed from one lot",
      "lotId"
    )
    balance += transaction.deltaMg
    invariant(
      Number.isSafeInteger(balance),
      "inventory_balance_overflow",
      "Inventory balance exceeded the safe integer range",
      "deltaMg"
    )
  }
  return massMg(balance)
}

export type CreateInventoryTransferInput = Readonly<{
  transferId: InventoryTransferId
  sourceTransactionId: InventoryTransactionId
  destinationTransactionId: InventoryTransactionId
  sourceLotId: GreenLotId
  destinationLotId: GreenLotId
  massMg: number
  sourceBalanceMg: MassMg
  occurredAt: InstantMs
  reason: string
  idempotencyKey: IdempotencyKey
  allowNegativeBalance?: boolean
}>

export function createInventoryTransfer(
  input: CreateInventoryTransferInput
): InventoryTransferResult {
  invariant(
    input.sourceLotId !== input.destinationLotId,
    "self_inventory_transfer",
    "Source and destination lots must differ",
    "destinationLotId"
  )
  const amount = positiveMassMg(input.massMg, "massMg")
  invariant(
    input.allowNegativeBalance === true || input.sourceBalanceMg >= amount,
    "insufficient_inventory",
    "Source lot has insufficient inventory",
    "massMg",
    {
      availableMg: input.sourceBalanceMg,
      requestedMg: amount,
    }
  )
  const reason = requiredText(input.reason, "reason", 1_000)
  const transfer: InventoryTransfer = Object.freeze({
    id: input.transferId,
    sourceLotId: input.sourceLotId,
    destinationLotId: input.destinationLotId,
    massMg: amount,
    occurredAt: input.occurredAt,
    reason,
    idempotencyKey: input.idempotencyKey,
  })

  return Object.freeze({
    transfer,
    source: createInventoryTransaction({
      id: input.sourceTransactionId,
      lotId: input.sourceLotId,
      kind: "transfer_out",
      deltaMg: -amount,
      occurredAt: input.occurredAt,
      reason,
      transferId: input.transferId,
      idempotencyKey: input.idempotencyKey,
    }),
    destination: createInventoryTransaction({
      id: input.destinationTransactionId,
      lotId: input.destinationLotId,
      kind: "transfer_in",
      deltaMg: amount,
      occurredAt: input.occurredAt,
      reason,
      transferId: input.transferId,
      idempotencyKey: input.idempotencyKey,
    }),
  })
}
