import { z } from "zod"
import {
  IsoInstantSchema,
  PageInfoSchema,
  RevisionSchema,
  UuidV7Schema,
} from "./primitives"

export const RoastFieldSchema = z.enum([
  "roastId",
  "roastNumber",
  "nativeLogNumber",
  "roastedAt",
  "durationMs",
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

export type RoastField = z.infer<typeof RoastFieldSchema>

const idFields = new Set<RoastField>([
  "roastId",
  "coffeeId",
  "providerId",
  "purchaseId",
  "greenLotId",
  "profileRevisionId",
])
const textFields = new Set<RoastField>([
  "coffeeName",
  "providerName",
  "purchaseReference",
  "lotCode",
  "region",
  "farmProducer",
  "process",
  "profileName",
  "tastingNotes",
  "tastingConclusion",
])
const enumFields = new Set<RoastField>([
  "countryCode",
  "result",
  "status",
  "readyPlanStatus",
])
const booleanFields = new Set<RoastField>(["needsTasting"])
const orderedFields = new Set<RoastField>([
  "roastNumber",
  "nativeLogNumber",
  "roastedAt",
  "durationMs",
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
])
const setFields = new Set<RoastField>([
  "varieties",
  "tastingDescriptors",
  "tags",
])
const nullableFields = new Set<RoastField>([
  "nativeLogNumber",
  "durationMs",
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
  "result",
  "status",
  "readyPlanStatus",
])

export const FieldOperatorSchema = z.enum([
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
  "contains_any",
  "contains_all",
  "contains_none",
  "is_empty",
  "is_not_empty",
  "is_null",
  "is_not_null",
])

export type FilterScalar = string | number | boolean
export type FilterExpression =
  | { op: "and" | "or"; clauses: FilterExpression[] }
  | { op: "not"; clause: FilterExpression }
  | { op: "search"; query: string }
  | {
      op: "field"
      field: RoastField
      operator: z.infer<typeof FieldOperatorSchema>
      value?: FilterScalar | FilterScalar[] | undefined
    }

const scalarValueSchema = z.union([
  z.string().max(256),
  z.number().safe(),
  z.boolean(),
])
const filterValueSchema = z.union([
  scalarValueSchema,
  z.array(scalarValueSchema).max(200),
])

const fieldFilterSchema = z
  .object({
    op: z.literal("field"),
    field: RoastFieldSchema,
    operator: FieldOperatorSchema,
    value: filterValueSchema.optional(),
  })
  .strict()
  .superRefine((filter, context) => {
    const nullOperator =
      filter.operator === "is_null" || filter.operator === "is_not_null"
    const emptyOperator =
      filter.operator === "is_empty" || filter.operator === "is_not_empty"
    if ((nullOperator || emptyOperator) && filter.value !== undefined) {
      context.addIssue({
        code: "custom",
        message: `${filter.operator} does not accept a value`,
        path: ["value"],
      })
    }
    if (!nullOperator && !emptyOperator && filter.value === undefined) {
      context.addIssue({
        code: "custom",
        message: `${filter.operator} requires a value`,
        path: ["value"],
      })
    }
    if (nullOperator && !nullableFields.has(filter.field)) {
      context.addIssue({
        code: "custom",
        message: `${filter.field} is not nullable`,
        path: ["operator"],
      })
    }
    if (emptyOperator && !setFields.has(filter.field)) {
      context.addIssue({
        code: "custom",
        message: `${filter.operator} is only valid for set fields`,
        path: ["operator"],
      })
    }

    let allowed: ReadonlySet<string>
    if (setFields.has(filter.field)) {
      allowed = new Set([
        "contains_any",
        "contains_all",
        "contains_none",
        "is_empty",
        "is_not_empty",
        "is_null",
        "is_not_null",
      ])
    } else if (textFields.has(filter.field)) {
      allowed = new Set([
        "eq",
        "neq",
        "in",
        "not_in",
        "contains",
        "not_contains",
        "starts_with",
        "is_null",
        "is_not_null",
      ])
    } else if (orderedFields.has(filter.field)) {
      allowed = new Set([
        "eq",
        "neq",
        "in",
        "not_in",
        "lt",
        "lte",
        "gt",
        "gte",
        "between",
        "is_null",
        "is_not_null",
      ])
    } else if (
      idFields.has(filter.field) ||
      enumFields.has(filter.field) ||
      booleanFields.has(filter.field)
    ) {
      allowed = new Set(["eq", "neq", "in", "not_in", "is_null", "is_not_null"])
    } else {
      allowed = new Set()
    }
    if (!allowed.has(filter.operator)) {
      context.addIssue({
        code: "custom",
        message: `${filter.operator} is not valid for ${filter.field}`,
        path: ["operator"],
      })
    }

    const listOperator = [
      "in",
      "not_in",
      "between",
      "contains_any",
      "contains_all",
      "contains_none",
    ].includes(filter.operator)
    if (listOperator && !Array.isArray(filter.value)) {
      context.addIssue({
        code: "custom",
        message: `${filter.operator} requires an array value`,
        path: ["value"],
      })
    }
    if (
      filter.operator === "between" &&
      Array.isArray(filter.value) &&
      filter.value.length !== 2
    ) {
      context.addIssue({
        code: "custom",
        message: "between requires exactly two values",
        path: ["value"],
      })
    }
  })

const rawFilterExpressionSchema: z.ZodType<FilterExpression> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.enum(["and", "or"]),
        clauses: z.array(rawFilterExpressionSchema).max(100),
      })
      .strict(),
    z
      .object({ op: z.literal("not"), clause: rawFilterExpressionSchema })
      .strict(),
    z
      .object({
        op: z.literal("search"),
        query: z.string().trim().min(1).max(512),
      })
      .strict(),
    fieldFilterSchema,
  ])
)

function filterBounds(
  filter: FilterExpression,
  depth = 1
): { depth: number; leaves: number } {
  if (filter.op === "and" || filter.op === "or") {
    return filter.clauses.reduce(
      (result, clause) => {
        const nested = filterBounds(clause, depth + 1)
        return {
          depth: Math.max(result.depth, nested.depth),
          leaves: result.leaves + nested.leaves,
        }
      },
      { depth, leaves: 0 }
    )
  }
  if (filter.op === "not") return filterBounds(filter.clause, depth + 1)
  return { depth, leaves: 1 }
}

export const FilterExpressionSchema = rawFilterExpressionSchema.superRefine(
  (filter, context) => {
    const bounds = filterBounds(filter)
    if (bounds.depth > 5)
      context.addIssue({
        code: "custom",
        message: "Filter depth may not exceed five",
      })
    if (bounds.leaves > 100)
      context.addIssue({
        code: "custom",
        message: "Filter may not exceed one hundred leaves",
      })
  }
)

export const GroupValueFieldSchema = z.enum([
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
export const GroupNumericFieldSchema = z.enum([
  "roastNumber",
  "nativeLogNumber",
  "durationMs",
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
])
export const SortableFieldSchema = z.enum([
  "roastId",
  "roastNumber",
  "nativeLogNumber",
  "roastedAt",
  "durationMs",
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
  "profileRevisionId",
  "profileName",
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
  "tastingNotes",
  "tastingConclusion",
  "result",
  "status",
  "needsTasting",
  "readyPlanStatus",
])
export const AggregatableFieldSchema = z.enum([
  "roastNumber",
  "nativeLogNumber",
  "roastedAt",
  "durationMs",
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
  "readyPlanStatus",
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
])

export const GroupSpecSchema = z.union([
  z
    .object({
      field: GroupValueFieldSchema,
      direction: z.enum(["asc", "desc"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("roastedAt"),
      direction: z.enum(["asc", "desc"]),
      bucket: z.enum(["day", "week", "month", "year"]),
      timezone: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      field: GroupNumericFieldSchema,
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

export const GroupKeySchema = z.union([
  z
    .object({
      kind: z.literal("value"),
      value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      startInclusive: z.union([z.number().finite(), IsoInstantSchema]),
      endExclusive: z.union([z.number().finite(), IsoInstantSchema]),
    })
    .strict(),
])

export const GroupPathEntrySchema = z
  .object({ field: RoastFieldSchema, key: GroupKeySchema })
  .strict()
export const SortSpecSchema = z
  .object({
    field: SortableFieldSchema,
    direction: z.enum(["asc", "desc"]),
    nulls: z.enum(["first", "last"]),
  })
  .strict()

export const AggregateSpecSchema = z.union([
  z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      op: z.literal("count"),
    })
    .strict(),
  z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      field: AggregatableFieldSchema,
      op: z.enum(["count_distinct", "sum", "avg", "min", "max"]),
    })
    .strict(),
])

export const RoastLibraryQuerySchema = z
  .object({
    viewVersion: z.literal(1),
    filters: FilterExpressionSchema,
    groups: z.array(GroupSpecSchema).max(3),
    groupPath: z.array(GroupPathEntrySchema).max(3).optional(),
    sorts: z.array(SortSpecSchema).max(5),
    columns: z.array(RoastFieldSchema).min(1).max(50),
    aggregates: z.array(AggregateSpecSchema).max(20),
    page: z
      .object({
        first: z.number().int().min(1).max(200),
        after: z.string().min(1).max(4_096).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((query, context) => {
    if ((query.groupPath?.length ?? 0) > query.groups.length) {
      context.addIssue({
        code: "custom",
        message: "Group path cannot be deeper than the group definition",
        path: ["groupPath"],
      })
    }
    if (new Set(query.columns).size !== query.columns.length) {
      context.addIssue({
        code: "custom",
        message: "Columns must be unique",
        path: ["columns"],
      })
    }
    if (
      new Set(query.aggregates.map((aggregate) => aggregate.key)).size !==
      query.aggregates.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Aggregate keys must be unique",
        path: ["aggregates"],
      })
    }
  })

export const RoastCellValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
])

export const RoastLibraryRowDtoSchema = z
  .object({
    roastId: UuidV7Schema,
    revision: RevisionSchema,
    values: z.partialRecord(RoastFieldSchema, RoastCellValueSchema),
  })
  .strict()

export const RoastLibraryGroupDtoSchema = z
  .object({
    path: z.array(GroupPathEntrySchema).max(3),
    key: GroupKeySchema,
    label: z.string().max(500),
    count: z.number().int().min(0),
    aggregates: z.record(
      z.string(),
      z.union([z.number().finite(), z.string(), z.null()])
    ),
  })
  .strict()

const AggregateValuesSchema = z.record(
  z.string(),
  z.union([z.number().finite(), z.string(), z.null()])
)

export const RoastLibraryResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("groups"),
      scope: z.array(GroupPathEntrySchema).max(3),
      groups: z.array(RoastLibraryGroupDtoSchema),
      pageInfo: PageInfoSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rows"),
      scope: z.array(GroupPathEntrySchema).max(3),
      rows: z.array(RoastLibraryRowDtoSchema).max(200),
      aggregates: AggregateValuesSchema,
      pageInfo: PageInfoSchema,
    })
    .strict(),
])

export const FacetResultSchema = z
  .object({
    field: RoastFieldSchema,
    buckets: z.array(
      z
        .object({
          value: z.union([
            z.string(),
            z.number().finite(),
            z.boolean(),
            z.null(),
          ]),
          label: z.string().max(500),
          count: z.number().int().min(0),
        })
        .strict()
    ),
    truncated: z.boolean(),
  })
  .strict()

export type RoastLibraryQuery = z.infer<typeof RoastLibraryQuerySchema>
export type RoastLibraryResult = z.infer<typeof RoastLibraryResultSchema>
