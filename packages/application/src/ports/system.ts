import type { EntityId, EntityKind, InstantMs } from "@tan-studio/domain"

export interface Clock {
  now(): InstantMs
}

export interface IdGenerator {
  next<TKind extends EntityKind>(kind: TKind): EntityId<TKind>
}
