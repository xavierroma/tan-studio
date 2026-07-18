import { z } from "zod"

export const UuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Expected a canonical lowercase UUIDv7"
  )

export const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Expected a canonical lowercase UUID"
  )

export const IsoInstantSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    "Expected an RFC 3339 UTC instant ending in Z"
  )
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Expected a real calendar instant"
  )

export const IanaTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format(0)
      return true
    } catch {
      return false
    }
  }, "Expected a valid IANA timezone")

export const SafeIntegerSchema = z.number().int().safe()
export const NonNegativeSafeIntegerSchema = SafeIntegerSchema.min(0)
export const PositiveSafeIntegerSchema = SafeIntegerSchema.min(1)
export const RevisionSchema = SafeIntegerSchema.min(1)
export const MassMgSchema = SafeIntegerSchema
export const NonNegativeMassMgSchema = NonNegativeSafeIntegerSchema
export const PositiveMassMgSchema = PositiveSafeIntegerSchema
export const BasisPointsSchema = SafeIntegerSchema.min(0).max(10_000)
export const RoastLevelThousandthsSchema = SafeIntegerSchema.min(0).max(10_000)
export const TemperatureMilliCSchema = SafeIntegerSchema.min(-273_150)
export const DurationMsSchema = NonNegativeSafeIntegerSchema
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/)
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

export const ResourceKindSchema = z.enum([
  "provider",
  "coffee",
  "tag",
  "purchase",
  "lot",
  "inventory_transaction",
  "inventory_transfer",
  "roast_intent",
  "roast",
  "roast_package",
  "annotation",
  "attachment",
  "tasting",
  "tasting_scale_revision",
  "next_roast_plan",
  "saved_roast_view",
  "profile",
  "profile_revision",
  "profile_validation_report",
  "native_file",
  "native_file_revision",
  "device",
  "sync_plan",
  "label_template",
  "label_template_revision",
  "printer",
  "printer_capability_snapshot",
  "print_job",
  "backup",
  "artifact",
  "job",
  "alert",
])

export const ResourceRefSchema = z
  .object({
    kind: ResourceKindSchema,
    id: z.string().min(1).max(200),
    revision: RevisionSchema.optional(),
  })
  .strict()

export const ArtifactRefSchema = z
  .object({
    hash: Sha256Schema,
    mediaType: z.string().min(1).max(200),
    byteLength: NonNegativeSafeIntegerSchema,
    filenameHint: z.string().min(1).max(255),
  })
  .strict()

export const PageInfoSchema = z
  .object({
    endCursor: z.string().min(1).max(4_096).optional(),
    hasNextPage: z.boolean(),
  })
  .strict()

export type ResourceKind = z.infer<typeof ResourceKindSchema>
export type ResourceRef = z.infer<typeof ResourceRefSchema>
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
export type PageInfo = z.infer<typeof PageInfoSchema>

export const mutableResourceFields = <TKind extends ResourceKind>(
  kind: TKind
) => ({
  kind: z.literal(kind),
  id: UuidV7Schema,
  revision: RevisionSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
})

export const immutableResourceFields = <TKind extends ResourceKind>(
  kind: TKind
) => ({
  kind: z.literal(kind),
  id: UuidV7Schema,
  createdAt: IsoInstantSchema,
})

export function cursorPageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({ items: z.array(item), pageInfo: PageInfoSchema }).strict()
}

export function mutationReceiptSchema<TResource extends z.ZodType>(
  resource: TResource
) {
  return z
    .object({ resource, affected: z.array(ResourceRefSchema).max(100) })
    .strict()
}
