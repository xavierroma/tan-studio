import type {
  CoffeeId,
  GreenLotId,
  NextRoastPlanId,
  ProfileRevisionId,
  RoastId,
} from "../shared/ids"
import type {
  InstantMs,
  MassMg,
  Revision,
  RoastLevelThousandths,
} from "../shared/units"
import { nextRevision, revision } from "../shared/units"
import { invariant } from "../shared/errors"
import { optionalText, requiredText } from "../shared/text"

export type NextRoastPlanStatus =
  "draft" | "ready" | "used" | "superseded" | "cancelled"

export type ProposedRoastSettings = Readonly<{
  profileRevisionId: ProfileRevisionId | null
  roastLevelThousandths: RoastLevelThousandths | null
  greenLoadMassMg: MassMg | null
  rationale: string | null
}>

export type NextRoastPlan = Readonly<{
  id: NextRoastPlanId
  coffeeId: CoffeeId
  lotId: GreenLotId | null
  objective: string
  proposedSettings: ProposedRoastSettings
  status: NextRoastPlanStatus
  supersedesPlanId: NextRoastPlanId | null
  executedRoastId: RoastId | null
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type CreateNextRoastPlanInput = Readonly<{
  id: NextRoastPlanId
  coffeeId: CoffeeId
  lotId?: GreenLotId | null
  objective: string
  proposedSettings: ProposedRoastSettings
  supersedesPlanId?: NextRoastPlanId | null
  now: InstantMs
}>

export function createNextRoastPlan(
  input: CreateNextRoastPlanInput
): NextRoastPlan {
  return Object.freeze({
    id: input.id,
    coffeeId: input.coffeeId,
    lotId: input.lotId ?? null,
    objective: requiredText(input.objective, "objective", 2_000),
    proposedSettings: Object.freeze({
      ...input.proposedSettings,
      rationale: optionalText(
        input.proposedSettings.rationale,
        "proposedSettings.rationale",
        5_000
      ),
    }),
    status: "draft",
    supersedesPlanId: input.supersedesPlanId ?? null,
    executedRoastId: null,
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export function transitionNextRoastPlan(
  plan: NextRoastPlan,
  transition: "ready" | "cancelled",
  now: InstantMs
): NextRoastPlan {
  const allowed =
    plan.status === "draft"
      ? transition === "ready" || transition === "cancelled"
      : plan.status === "ready" && transition === "cancelled"
  invariant(
    allowed,
    "invalid_plan_transition",
    `Cannot transition plan from ${plan.status} to ${transition}`,
    "status"
  )
  return Object.freeze({
    ...plan,
    status: transition,
    revision: nextRevision(plan.revision),
    updatedAt: now,
  })
}

export function markNextRoastPlanUsed(
  plan: NextRoastPlan,
  roastId: RoastId,
  now: InstantMs
): NextRoastPlan {
  invariant(
    plan.status === "ready",
    "plan_not_ready",
    "Only a ready plan can be marked used",
    "status"
  )
  return Object.freeze({
    ...plan,
    status: "used",
    executedRoastId: roastId,
    revision: nextRevision(plan.revision),
    updatedAt: now,
  })
}

export function supersedeNextRoastPlan(
  plan: NextRoastPlan,
  successor: NextRoastPlan,
  now: InstantMs
): NextRoastPlan {
  invariant(
    plan.status === "ready",
    "plan_not_ready",
    "Only a ready plan can be superseded",
    "status"
  )
  invariant(
    successor.status === "draft",
    "successor_not_draft",
    "A successor must begin as a draft",
    "status"
  )
  invariant(
    successor.supersedesPlanId === plan.id,
    "wrong_plan_successor",
    "Successor does not reference the plan it supersedes",
    "supersedesPlanId"
  )
  invariant(
    successor.coffeeId === plan.coffeeId && successor.lotId === plan.lotId,
    "plan_scope_changed",
    "A successor must retain the coffee and lot scope",
    "coffeeId"
  )
  return Object.freeze({
    ...plan,
    status: "superseded",
    revision: nextRevision(plan.revision),
    updatedAt: now,
  })
}
