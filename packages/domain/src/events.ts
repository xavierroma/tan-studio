import type { CorrelationId, DomainEventId } from "./shared/ids"
import type { InstantMs } from "./shared/units"
import { invariant } from "./shared/errors"

export type DomainEvent<TType extends string, TPayload> = Readonly<{
  eventId: DomainEventId
  type: TType
  schemaVersion: 1
  aggregateId: string
  aggregateRevision: number
  eventOrdinal: number
  occurredAt: InstantMs
  correlationId: CorrelationId
  causationId: string | null
  payload: Readonly<TPayload>
}>

export function domainEvent<TType extends `${string}.${string}.v1`, TPayload>(
  input: Omit<DomainEvent<TType, TPayload>, "schemaVersion">
): DomainEvent<TType, TPayload> {
  invariant(
    input.aggregateRevision >= 1 &&
      Number.isSafeInteger(input.aggregateRevision),
    "invalid_event_revision",
    "Event aggregate revision is invalid",
    "aggregateRevision"
  )
  invariant(
    input.eventOrdinal >= 0 && Number.isSafeInteger(input.eventOrdinal),
    "invalid_event_ordinal",
    "Event ordinal is invalid",
    "eventOrdinal"
  )
  return Object.freeze({ ...input, schemaVersion: 1 })
}
