import { z } from "zod"

const nonEmptyText = z.string().trim().min(1).max(200)
const optionalText = z.string().trim().max(4_000).optional()
const nullableText = z.string().trim().max(200).nullable().optional()

const notesSchema = z.string().max(10_000).nullable()
const httpUrlSchema = z
  .url()
  .max(500)
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  }, "Website URL must use HTTP or HTTPS")
const providerAliasesSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .superRefine((aliases, context) => {
    const normalized = aliases.map((alias) =>
      alias.normalize("NFKC").toLocaleLowerCase("und")
    )
    if (new Set(normalized).size !== aliases.length) {
      context.addIssue({
        code: "custom",
        message: "Provider aliases must be unique",
      })
    }
  })
const providerContactSchema = z
  .object({
    websiteUrl: httpUrlSchema.nullable().optional(),
    email: z.email().max(320).nullable().optional(),
    phone: z.string().max(100).nullable().optional(),
  })
  .strict()

export const providerCreateSchema = z
  .object({
    displayName: nonEmptyText,
    aliases: providerAliasesSchema.optional(),
    contact: providerContactSchema.optional(),
    referenceNotes: z.string().max(2_000).nullable().optional(),
    defaultCurrencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    notes: notesSchema.optional(),
  })
  .strict()

export const providerPatchSchema = providerCreateSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required"
  )

export const coffeeCreateSchema = z
  .object({
    displayName: nonEmptyText,
    countryCode: z
      .string()
      .trim()
      .length(2)
      .toUpperCase()
      .nullable()
      .optional(),
    region: nullableText,
    farmProducer: nullableText,
    stationCooperative: nullableText,
    process: nullableText,
    varieties: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    altitudeMinMetres: z.int().min(-500).max(10_000).nullable().optional(),
    altitudeMaxMetres: z.int().min(-500).max(10_000).nullable().optional(),
    harvestLabel: z.string().max(100).nullable().optional(),
    notes: notesSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.altitudeMinMetres != null &&
      value.altitudeMaxMetres != null &&
      value.altitudeMaxMetres < value.altitudeMinMetres
    ) {
      context.addIssue({
        code: "custom",
        path: ["altitudeMaxMetres"],
        message: "Must be greater than or equal to altitudeMinMetres",
      })
    }
  })

export const coffeePatchSchema = z
  .object({
    displayName: nonEmptyText.optional(),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .toUpperCase()
      .nullable()
      .optional(),
    region: nullableText,
    farmProducer: nullableText,
    stationCooperative: nullableText,
    process: nullableText,
    varieties: z.array(nonEmptyText).max(50).optional(),
    altitudeMinMetres: z.int().min(-500).max(10_000).nullable().optional(),
    altitudeMaxMetres: z.int().min(-500).max(10_000).nullable().optional(),
    harvestLabel: nullableText,
    notes: z.string().max(10_000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required"
  )
  .superRefine((value, context) => {
    if (
      value.altitudeMinMetres != null &&
      value.altitudeMaxMetres != null &&
      value.altitudeMaxMetres < value.altitudeMinMetres
    ) {
      context.addIssue({
        code: "custom",
        path: ["altitudeMaxMetres"],
        message: "Must be greater than or equal to altitudeMinMetres",
      })
    }
  })

export const lotCreateSchema = z
  .object({
    purchaseLineId: z.uuid(),
    supplierCode: nullableText,
    internalCode: nonEmptyText,
    receivedMassMg: z.int().positive(),
    onHandMassMg: z.int().nonnegative().optional(),
    receivedAt: z.iso.datetime({ offset: true }),
    sourceTimezone: nonEmptyText,
    storageLocation: nullableText,
    storageNotes: optionalText,
    state: z.enum(["active", "depleted", "archived"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.onHandMassMg ?? value.receivedMassMg) <= value.receivedMassMg,
    { path: ["onHandMassMg"], message: "Cannot exceed receivedMassMg" }
  )

export const lotPatchSchema = z
  .object({
    supplierCode: nullableText,
    internalCode: nonEmptyText.optional(),
    storageLocation: nullableText,
    storageNotes: optionalText,
    state: z.enum(["active", "depleted", "archived"]).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required"
  )

export const roastLibraryFieldSchema = z.enum([
  "roastId",
  "roastedAt",
  "coffeeId",
  "coffeeName",
  "providerId",
  "providerName",
  "purchaseId",
  "purchaseReference",
  "greenLotId",
  "lotCode",
  "countryCode",
  "region",
  "farmProducer",
  "process",
  "varieties",
  "profileRevisionId",
  "profileName",
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
  "tastingDescriptors",
  "tastingNotes",
  "tastingConclusion",
  "tags",
  "result",
  "status",
  "needsTasting",
  "readyPlanStatus",
])

export const roastLibraryFilterSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({
        op: z.enum(["and", "or"]),
        clauses: z.array(roastLibraryFilterSchema).max(100),
      })
      .strict(),
    z
      .object({ op: z.literal("not"), clause: roastLibraryFilterSchema })
      .strict(),
    z
      .object({
        op: z.literal("search"),
        query: z.string().trim().min(1).max(512),
      })
      .strict(),
    z
      .object({
        op: z.literal("field"),
        field: roastLibraryFieldSchema,
        operator: z.enum([
          "eq",
          "neq",
          "in",
          "not_in",
          "contains",
          "not_contains",
          "starts_with",
          "lt",
          "lte",
          "gt",
          "gte",
          "between",
          "is_null",
          "is_not_null",
          "contains_any",
          "contains_all",
          "contains_none",
          "is_empty",
          "is_not_empty",
        ]),
        value: z
          .union([
            z.string().max(512),
            z.number().finite(),
            z.boolean(),
            z
              .array(
                z.union([z.string().max(512), z.number().finite(), z.boolean()])
              )
              .max(200),
          ])
          .optional(),
      })
      .strict(),
  ])
)

const groupValueFieldSchema = z.enum([
  "coffeeId",
  "providerId",
  "purchaseId",
  "greenLotId",
  "profileRevisionId",
  "countryCode",
  "region",
  "farmProducer",
  "process",
  "result",
  "status",
  "needsTasting",
  "readyPlanStatus",
])

const groupNumericFieldSchema = z.enum([
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
])

const groupKeySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("value"),
      value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      startInclusive: z.union([z.number().finite(), z.iso.datetime()]),
      endExclusive: z.union([z.number().finite(), z.iso.datetime()]),
    })
    .strict(),
])

const groupSpecSchema = z.union([
  z
    .object({
      field: groupValueFieldSchema,
      direction: z.enum(["asc", "desc"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("roastedAt"),
      direction: z.enum(["asc", "desc"]),
      bucket: z.enum(["day", "week", "month", "year"]),
      timezone: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      field: groupNumericFieldSchema,
      direction: z.enum(["asc", "desc"]),
      bucket: z
        .object({
          size: z.number().positive().finite(),
          origin: z.number().finite(),
        })
        .strict(),
    })
    .strict(),
])

const aggregateSpecSchema = z.union([
  z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      op: z.literal("count"),
    })
    .strict(),
  z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      field: roastLibraryFieldSchema,
      op: z.enum(["count_distinct", "sum", "avg", "min", "max"]),
    })
    .strict(),
])

export const roastLibraryQuerySchema = z
  .object({
    viewVersion: z.literal(1),
    filters: roastLibraryFilterSchema.default({ op: "and", clauses: [] }),
    groups: z.array(groupSpecSchema).max(3).default([]),
    groupPath: z
      .array(
        z
          .object({ field: roastLibraryFieldSchema, key: groupKeySchema })
          .strict()
      )
      .max(3)
      .optional(),
    sorts: z
      .array(
        z
          .object({
            field: roastLibraryFieldSchema,
            direction: z.enum(["asc", "desc"]),
            nulls: z.enum(["first", "last"]).default("last"),
          })
          .strict()
      )
      .max(5)
      .default([{ field: "roastedAt", direction: "desc", nulls: "last" }]),
    columns: z.array(roastLibraryFieldSchema).min(1).max(40),
    aggregates: z.array(aggregateSpecSchema).max(20).default([]),
    page: z
      .object({
        first: z.int().min(1).max(200),
        after: z.string().max(2_048).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((query, context) => {
    if ((query.groupPath?.length ?? 0) > query.groups.length) {
      context.addIssue({
        code: "custom",
        path: ["groupPath"],
        message: "Group path cannot exceed the group definition",
      })
    }
    if (new Set(query.columns).size !== query.columns.length) {
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Columns must be unique",
      })
    }
    if (
      new Set(query.aggregates.map((aggregate) => aggregate.key)).size !==
      query.aggregates.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["aggregates"],
        message: "Aggregate keys must be unique",
      })
    }
  })

export const seriesQuerySchema = z
  .object({
    format: z.enum(["json"]).default("json"),
    streamVersion: z.coerce.number().int().positive(),
    fromElapsedMs: z.coerce.number().int().nonnegative().default(0),
    toElapsedMs: z.coerce.number().int().nonnegative().default(3_600_000),
    maxPoints: z.coerce.number().int().min(2).max(2_000).default(1_000),
    throughSampleSeq: z.coerce.number().int().nonnegative().optional(),
    channels: z.string().max(200).optional(),
  })
  .strict()
  .refine((value) => value.toElapsedMs >= value.fromElapsedMs, {
    path: ["toElapsedMs"],
    message: "Must be greater than or equal to fromElapsedMs",
  })

export const collectionQuerySchema = z
  .object({
    first: z.coerce.number().int().min(1).max(200).default(50),
    after: z.string().max(2_048).optional(),
    search: z.string().trim().max(200).optional(),
    includeArchived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(false),
  })
  .strict()

export type ProviderCreate = z.infer<typeof providerCreateSchema>
export type ProviderPatch = z.infer<typeof providerPatchSchema>
export type CoffeeCreate = z.infer<typeof coffeeCreateSchema>
export type CoffeePatch = z.infer<typeof coffeePatchSchema>
export type LotCreate = z.infer<typeof lotCreateSchema>
export type LotPatch = z.infer<typeof lotPatchSchema>
export type RoastLibraryQuery = z.infer<typeof roastLibraryQuerySchema>
export type RoastLibraryField = z.infer<typeof roastLibraryFieldSchema>
