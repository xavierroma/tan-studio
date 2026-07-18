import { invariant } from "./errors"

declare const brand: unique symbol

export type Brand<TValue, TName extends string> = TValue & {
  readonly [brand]: TName
}

export type EntityKind =
  | "Provider"
  | "Coffee"
  | "Purchase"
  | "PurchaseLine"
  | "GreenLot"
  | "InventoryTransaction"
  | "InventoryTransfer"
  | "Roast"
  | "Tasting"
  | "TastingScaleRevision"
  | "NextRoastPlan"
  | "ProfileRevision"
  | "DomainEvent"

export type EntityId<TKind extends EntityKind> = Brand<
  string,
  `uuidv7:${TKind}`
>

export type ProviderId = EntityId<"Provider">
export type CoffeeId = EntityId<"Coffee">
export type PurchaseId = EntityId<"Purchase">
export type PurchaseLineId = EntityId<"PurchaseLine">
export type GreenLotId = EntityId<"GreenLot">
export type InventoryTransactionId = EntityId<"InventoryTransaction">
export type InventoryTransferId = EntityId<"InventoryTransfer">
export type RoastId = EntityId<"Roast">
export type TastingId = EntityId<"Tasting">
export type TastingScaleRevisionId = EntityId<"TastingScaleRevision">
export type NextRoastPlanId = EntityId<"NextRoastPlan">
export type ProfileRevisionId = EntityId<"ProfileRevision">
export type DomainEventId = EntityId<"DomainEvent">

export type CorrelationId = Brand<string, "correlation-id">
export type IdempotencyKey = Brand<string, "idempotency-key">

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function entityId<TKind extends EntityKind>(
  kind: TKind,
  value: string
): EntityId<TKind> {
  invariant(
    UUID_V7.test(value),
    "invalid_uuid_v7",
    `${kind} ID must be a canonical lowercase UUIDv7`,
    "id"
  )
  return value as EntityId<TKind>
}

export function correlationId(value: string): CorrelationId {
  invariant(
    UUID.test(value),
    "invalid_correlation_id",
    "Correlation ID must be a canonical lowercase UUID",
    "correlationId"
  )
  return value as CorrelationId
}

export function idempotencyKey(value: string): IdempotencyKey {
  invariant(
    UUID.test(value),
    "invalid_idempotency_key",
    "Idempotency key must be a canonical lowercase UUID",
    "idempotencyKey"
  )
  return value as IdempotencyKey
}
