import { z } from "zod"
import {
  BasisPointsSchema,
  DurationMsSchema,
  IanaTimezoneSchema,
  IsoInstantSchema,
  NonNegativeMassMgSchema,
  PositiveMassMgSchema,
  RoastLevelThousandthsSchema,
  TemperatureMilliCSchema,
  UuidV7Schema,
  immutableResourceFields,
  mutableResourceFields,
} from "../primitives"

export const RoastStatusSchema = z.enum([
  "provisional",
  "reconciling",
  "awaiting_finalization",
  "completed",
  "interrupted",
  "recovery_required",
])
export const RoastResultSchema = z.enum([
  "success",
  "aborted",
  "fault",
  "unknown",
])

export const RoastResourceDtoSchema = z
  .object({
    ...mutableResourceFields("roast"),
    greenLotId: UuidV7Schema.nullable(),
    coffeeId: UuidV7Schema.nullable(),
    profileRevisionId: UuidV7Schema.nullable(),
    roastedAt: IsoInstantSchema,
    sourceTimezone: IanaTimezoneSchema,
    roastLevelThousandths: RoastLevelThousandthsSchema,
    developmentBasisPoints: BasisPointsSchema.nullable(),
    greenInputMassMg: PositiveMassMgSchema.nullable(),
    roastedYieldMassMg: NonNegativeMassMgSchema.nullable(),
    status: RoastStatusSchema,
    result: RoastResultSchema.nullable(),
    endReason: z.string().max(500).nullable(),
    promotedTastingId: UuidV7Schema.nullable(),
    notes: z.string().max(10_000).nullable(),
  })
  .strict()
  .superRefine((roast, context) => {
    if (
      roast.greenInputMassMg !== null &&
      roast.roastedYieldMassMg !== null &&
      roast.roastedYieldMassMg > roast.greenInputMassMg
    ) {
      context.addIssue({
        code: "custom",
        message: "Roasted yield cannot exceed green input",
        path: ["roastedYieldMassMg"],
      })
    }
    const finalized = roast.status === "completed"
    if (
      finalized &&
      (roast.result === null ||
        roast.endReason === null ||
        roast.roastedYieldMassMg === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed roast is missing finalization fields",
        path: ["status"],
      })
    }
  })

export const BrewContextDtoSchema = z
  .object({
    method: z.string().max(100).nullable(),
    doseMassMg: PositiveMassMgSchema.nullable(),
    beverageMassMg: PositiveMassMgSchema.nullable(),
    waterTemperatureMilliC: TemperatureMilliCSchema.nullable(),
    grindSetting: z.string().max(100).nullable(),
    notes: z.string().max(1_000).nullable(),
  })
  .strict()

export const TastingOutcomeSchema = z.enum([
  "positive",
  "mixed",
  "negative",
  "neutral",
])

export const TastingResourceDtoSchema = z
  .object({
    ...immutableResourceFields("tasting"),
    rootTastingId: UuidV7Schema,
    supersedesTastingId: UuidV7Schema.nullable(),
    roastId: UuidV7Schema,
    tastedAt: IsoInstantSchema,
    sourceTimezone: IanaTimezoneSchema,
    restAgeMs: DurationMsSchema,
    scaleRevisionId: UuidV7Schema,
    scoreBasisPoints: BasisPointsSchema.nullable(),
    componentScores: z.record(
      z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
      BasisPointsSchema
    ),
    descriptors: z.array(z.string().trim().min(1).max(100)).max(100),
    brewContext: BrewContextDtoSchema,
    notes: z.string().max(10_000).nullable(),
    outcome: TastingOutcomeSchema,
    worked: z.string().max(2_000).nullable(),
    didNotWork: z.string().max(2_000).nullable(),
    nextAction: z.string().max(2_000).nullable(),
    authorLabel: z.string().max(100).nullable(),
  })
  .strict()

export const TastingContentRequestSchema = z
  .object({
    tastedAt: IsoInstantSchema,
    sourceTimezone: IanaTimezoneSchema,
    restAgeMs: DurationMsSchema,
    scaleRevisionId: UuidV7Schema,
    scoreBasisPoints: BasisPointsSchema.nullable().optional(),
    componentScores: z
      .record(z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/), BasisPointsSchema)
      .optional(),
    descriptors: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    brewContext: BrewContextDtoSchema.partial().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    outcome: TastingOutcomeSchema,
    worked: z.string().max(2_000).nullable().optional(),
    didNotWork: z.string().max(2_000).nullable().optional(),
    nextAction: z.string().max(2_000).nullable().optional(),
    authorLabel: z.string().max(100).nullable().optional(),
  })
  .strict()

export const NextRoastPlanStatusSchema = z.enum([
  "draft",
  "ready",
  "used",
  "superseded",
  "cancelled",
])

export const ProposedRoastSettingsDtoSchema = z
  .object({
    profileRevisionId: UuidV7Schema.nullable(),
    roastLevelThousandths: RoastLevelThousandthsSchema.nullable(),
    greenLoadMassMg: PositiveMassMgSchema.nullable(),
    rationale: z.string().max(5_000).nullable(),
  })
  .strict()

export const NextRoastPlanResourceDtoSchema = z
  .object({
    ...mutableResourceFields("next_roast_plan"),
    coffeeId: UuidV7Schema,
    lotId: UuidV7Schema.nullable(),
    objective: z.string().trim().min(1).max(2_000),
    proposedSettings: ProposedRoastSettingsDtoSchema,
    status: NextRoastPlanStatusSchema,
    supersedesPlanId: UuidV7Schema.nullable(),
    executedRoastId: UuidV7Schema.nullable(),
  })
  .strict()
  .superRefine((plan, context) => {
    if ((plan.status === "used") !== (plan.executedRoastId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only a used plan has an executed roast",
        path: ["executedRoastId"],
      })
    }
  })

export const CreateNextRoastPlanRequestSchema = z
  .object({
    lotId: UuidV7Schema.nullable().optional(),
    objective: z.string().trim().min(1).max(2_000),
    proposedSettings: ProposedRoastSettingsDtoSchema,
    supersedesPlanId: UuidV7Schema.nullable().optional(),
  })
  .strict()

export const TransitionNextRoastPlanRequestSchema = z
  .object({
    status: z.enum(["ready", "cancelled"]),
  })
  .strict()

export type RoastResourceDto = z.infer<typeof RoastResourceDtoSchema>
export type TastingResourceDto = z.infer<typeof TastingResourceDtoSchema>
export type NextRoastPlanResourceDto = z.infer<
  typeof NextRoastPlanResourceDtoSchema
>
