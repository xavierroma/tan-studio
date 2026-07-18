import type {
  CoffeeId,
  GreenLotId,
  IdempotencyKey,
  ProfileRevisionId,
  RoastId,
  TastingId,
} from "../shared/ids"
import type {
  BasisPoints,
  InstantMs,
  MassMg,
  Revision,
  RoastLevelThousandths,
} from "../shared/units"
import {
  nextRevision,
  nonNegativeMassMg,
  positiveMassMg,
  revision,
} from "../shared/units"
import { invariant } from "../shared/errors"
import { assertIanaTimezone, optionalText, requiredText } from "../shared/text"

export type RoastStatus =
  | "provisional"
  | "reconciling"
  | "awaiting_finalization"
  | "completed"
  | "interrupted"
  | "recovery_required"

export type RoastResult = "success" | "aborted" | "fault" | "unknown"

export type Roast = Readonly<{
  id: RoastId
  greenLotId: GreenLotId | null
  coffeeId: CoffeeId | null
  profileRevisionId: ProfileRevisionId | null
  roastedAt: InstantMs
  sourceTimezone: string
  roastLevelThousandths: RoastLevelThousandths
  developmentBasisPoints: BasisPoints | null
  greenInputMassMg: MassMg | null
  roastedYieldMassMg: MassMg | null
  status: RoastStatus
  result: RoastResult | null
  endReason: string | null
  promotedTastingId: TastingId | null
  finalizationKey: IdempotencyKey | null
  notes: string | null
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type CreateRoastInput = Readonly<
  Omit<
    Roast,
    | "greenInputMassMg"
    | "roastedYieldMassMg"
    | "status"
    | "result"
    | "endReason"
    | "promotedTastingId"
    | "finalizationKey"
    | "notes"
    | "revision"
    | "createdAt"
    | "updatedAt"
  > & {
    greenInputMassMg?: number | null
    notes?: string | null
    now: InstantMs
  }
>

export function createRoast(input: CreateRoastInput): Roast {
  return Object.freeze({
    id: input.id,
    greenLotId: input.greenLotId,
    coffeeId: input.coffeeId,
    profileRevisionId: input.profileRevisionId,
    roastedAt: input.roastedAt,
    sourceTimezone: assertIanaTimezone(input.sourceTimezone),
    roastLevelThousandths: input.roastLevelThousandths,
    developmentBasisPoints: input.developmentBasisPoints,
    greenInputMassMg:
      input.greenInputMassMg === null || input.greenInputMassMg === undefined
        ? null
        : positiveMassMg(input.greenInputMassMg, "greenInputMassMg"),
    roastedYieldMassMg: null,
    status: "provisional",
    result: null,
    endReason: null,
    promotedTastingId: null,
    finalizationKey: null,
    notes: optionalText(input.notes, "notes", 10_000),
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type FinalizeRoastInput = Readonly<{
  finalizationKey: IdempotencyKey
  roastedYieldMassMg: number
  greenInputMassMg?: number | null
  result: RoastResult
  endReason: string
  now: InstantMs
}>

export function finalizeRoast(roast: Roast, input: FinalizeRoastInput): Roast {
  const greenInput =
    input.greenInputMassMg === undefined
      ? roast.greenInputMassMg
      : input.greenInputMassMg === null
        ? null
        : positiveMassMg(input.greenInputMassMg, "greenInputMassMg")
  const yieldMass = nonNegativeMassMg(
    input.roastedYieldMassMg,
    "roastedYieldMassMg"
  )
  const endReason = requiredText(input.endReason, "endReason", 500)
  invariant(
    greenInput === null || yieldMass <= greenInput,
    "yield_exceeds_input",
    "Roasted yield cannot exceed green input",
    "roastedYieldMassMg"
  )

  if (roast.finalizationKey !== null) {
    invariant(
      roast.finalizationKey === input.finalizationKey &&
        roast.greenInputMassMg === greenInput &&
        roast.roastedYieldMassMg === yieldMass &&
        roast.result === input.result &&
        roast.endReason === endReason,
      "roast_already_finalized",
      "Roast was already finalized with different inputs",
      "finalizationKey"
    )
    return roast
  }

  invariant(
    roast.status !== "completed",
    "roast_already_completed",
    "A completed roast cannot be finalized again",
    "status"
  )
  return Object.freeze({
    ...roast,
    greenInputMassMg: greenInput,
    roastedYieldMassMg: yieldMass,
    status: "completed",
    result: input.result,
    endReason,
    finalizationKey: input.finalizationKey,
    revision: nextRevision(roast.revision),
    updatedAt: input.now,
  })
}

export function promoteTasting(
  roast: Roast,
  tastingId: TastingId | null,
  now: InstantMs
): Roast {
  invariant(
    roast.status === "completed",
    "roast_not_completed",
    "Only a completed roast may promote a tasting",
    "status"
  )
  if (roast.promotedTastingId === tastingId) return roast
  return Object.freeze({
    ...roast,
    promotedTastingId: tastingId,
    revision: nextRevision(roast.revision),
    updatedAt: now,
  })
}
