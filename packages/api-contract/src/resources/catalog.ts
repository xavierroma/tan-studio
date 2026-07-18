import { z } from "zod"
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  IanaTimezoneSchema,
  IsoInstantSchema,
  NonNegativeSafeIntegerSchema,
  PositiveMassMgSchema,
  RevisionSchema,
  UuidV7Schema,
  immutableResourceFields,
  mutableResourceFields,
} from "../primitives"

const ShortTextSchema = z.string().trim().min(1).max(200)
const NotesSchema = z.string().max(10_000).nullable()
const ProviderContactSchema = z
  .object({
    websiteUrl: z
      .string()
      .url()
      .refine(
        (value) => value.startsWith("https://") || value.startsWith("http://"),
        "Expected an HTTP(S) URL"
      )
      .nullable(),
    email: z.string().email().max(320).nullable(),
    phone: z.string().max(100).nullable(),
  })
  .strict()
const ProviderContactInputSchema = ProviderContactSchema.partial()
const ProviderAliasesSchema = z
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

export const ProviderResourceDtoSchema = z
  .object({
    ...mutableResourceFields("provider"),
    displayName: ShortTextSchema,
    aliases: ProviderAliasesSchema,
    contact: ProviderContactSchema,
    referenceNotes: z.string().max(2_000).nullable(),
    defaultCurrencyCode: CurrencyCodeSchema.nullable(),
    notes: NotesSchema,
    archivedAt: IsoInstantSchema.nullable(),
  })
  .strict()

export const CreateProviderRequestSchema = z
  .object({
    displayName: ShortTextSchema,
    aliases: ProviderAliasesSchema.optional(),
    contact: ProviderContactInputSchema.optional(),
    referenceNotes: z.string().max(2_000).nullable().optional(),
    defaultCurrencyCode: CurrencyCodeSchema.nullable().optional(),
    notes: NotesSchema.optional(),
  })
  .strict()

export const PatchProviderRequestSchema =
  CreateProviderRequestSchema.partial().refine(
    (patch) => Object.keys(patch).length > 0,
    "At least one provider field is required"
  )

export const CoffeeResourceDtoSchema = z
  .object({
    ...mutableResourceFields("coffee"),
    displayName: ShortTextSchema,
    countryCode: CountryCodeSchema.nullable(),
    region: z.string().max(200).nullable(),
    farmProducer: z.string().max(200).nullable(),
    stationCooperative: z.string().max(200).nullable(),
    process: z.string().max(200).nullable(),
    varieties: z.array(z.string().trim().min(1).max(100)).max(50),
    altitudeMinMetres: z.number().int().min(-500).max(10_000).nullable(),
    altitudeMaxMetres: z.number().int().min(-500).max(10_000).nullable(),
    harvestLabel: z.string().max(100).nullable(),
    notes: NotesSchema,
    archivedAt: IsoInstantSchema.nullable(),
  })
  .strict()
  .superRefine((coffee, context) => {
    if (
      coffee.altitudeMinMetres !== null &&
      coffee.altitudeMaxMetres !== null &&
      coffee.altitudeMinMetres > coffee.altitudeMaxMetres
    ) {
      context.addIssue({
        code: "custom",
        message: "Minimum altitude cannot exceed maximum altitude",
        path: ["altitudeMinMetres"],
      })
    }
  })

export const CreateCoffeeRequestSchema = z
  .object({
    displayName: ShortTextSchema,
    countryCode: CountryCodeSchema.nullable().optional(),
    region: z.string().max(200).nullable().optional(),
    farmProducer: z.string().max(200).nullable().optional(),
    stationCooperative: z.string().max(200).nullable().optional(),
    process: z.string().max(200).nullable().optional(),
    varieties: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    altitudeMinMetres: z
      .number()
      .int()
      .min(-500)
      .max(10_000)
      .nullable()
      .optional(),
    altitudeMaxMetres: z
      .number()
      .int()
      .min(-500)
      .max(10_000)
      .nullable()
      .optional(),
    harvestLabel: z.string().max(100).nullable().optional(),
    notes: NotesSchema.optional(),
  })
  .strict()
  .superRefine((coffee, context) => {
    if (
      coffee.altitudeMinMetres != null &&
      coffee.altitudeMaxMetres != null &&
      coffee.altitudeMinMetres > coffee.altitudeMaxMetres
    ) {
      context.addIssue({
        code: "custom",
        message: "Minimum altitude cannot exceed maximum altitude",
        path: ["altitudeMinMetres"],
      })
    }
  })

export const PatchCoffeeRequestSchema = z
  .object({
    displayName: ShortTextSchema.optional(),
    countryCode: CountryCodeSchema.nullable().optional(),
    region: z.string().max(200).nullable().optional(),
    farmProducer: z.string().max(200).nullable().optional(),
    stationCooperative: z.string().max(200).nullable().optional(),
    process: z.string().max(200).nullable().optional(),
    varieties: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    altitudeMinMetres: z
      .number()
      .int()
      .min(-500)
      .max(10_000)
      .nullable()
      .optional(),
    altitudeMaxMetres: z
      .number()
      .int()
      .min(-500)
      .max(10_000)
      .nullable()
      .optional(),
    harvestLabel: z.string().max(100).nullable().optional(),
    notes: NotesSchema.optional(),
  })
  .strict()
  .superRefine((coffee, context) => {
    if (Object.keys(coffee).length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one coffee field is required",
      })
    }
    if (
      coffee.altitudeMinMetres != null &&
      coffee.altitudeMaxMetres != null &&
      coffee.altitudeMinMetres > coffee.altitudeMaxMetres
    ) {
      context.addIssue({
        code: "custom",
        message: "Minimum altitude cannot exceed maximum altitude",
        path: ["altitudeMinMetres"],
      })
    }
  })

export const PurchaseLineDtoSchema = z
  .object({
    id: UuidV7Schema,
    revision: RevisionSchema,
    coffeeId: UuidV7Schema,
    orderedMassMg: NonNegativeSafeIntegerSchema,
    receivedMassMg: NonNegativeSafeIntegerSchema,
    costMinorUnits: NonNegativeSafeIntegerSchema.nullable(),
    notes: z.string().max(2_000).nullable(),
    createdAt: IsoInstantSchema,
    updatedAt: IsoInstantSchema,
  })
  .strict()

export const PurchaseResourceDtoSchema = z
  .object({
    ...mutableResourceFields("purchase"),
    providerId: UuidV7Schema,
    purchasedAt: IsoInstantSchema,
    receivedAt: IsoInstantSchema.nullable(),
    sourceTimezone: IanaTimezoneSchema,
    supplierReference: z.string().max(200).nullable(),
    currencyCode: CurrencyCodeSchema.nullable(),
    totalMinorUnits: NonNegativeSafeIntegerSchema.nullable(),
    notes: NotesSchema,
    lines: z.array(PurchaseLineDtoSchema).max(200),
  })
  .strict()
  .superRefine((purchase, context) => {
    if (
      (purchase.currencyCode === null) !==
      (purchase.totalMinorUnits === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Currency and total must be supplied together",
        path: ["totalMinorUnits"],
      })
    }
  })

export const GreenLotResourceDtoSchema = z
  .object({
    ...mutableResourceFields("lot"),
    purchaseLineId: UuidV7Schema,
    coffeeId: UuidV7Schema,
    supplierCode: z.string().max(100).nullable(),
    internalCode: z.string().trim().min(1).max(100),
    receivedMassMg: PositiveMassMgSchema,
    receivedAt: IsoInstantSchema,
    sourceTimezone: IanaTimezoneSchema,
    storageLocation: z.string().max(200).nullable(),
    storageNotes: z.string().max(2_000).nullable(),
    state: z.enum(["active", "depleted", "archived"]),
    balanceMg: z.number().int().safe(),
  })
  .strict()

export const AcquisitionLotInputSchema = z
  .object({
    internalCode: z.string().trim().min(1).max(100),
    supplierCode: z.string().max(100).nullable().optional(),
    receivedMassMg: PositiveMassMgSchema,
    receivedAt: IsoInstantSchema,
    sourceTimezone: IanaTimezoneSchema,
    storageLocation: z.string().max(200).nullable().optional(),
    storageNotes: z.string().max(2_000).nullable().optional(),
    receiptReason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()

export const AcquisitionLineInputSchema = z
  .object({
    coffeeId: UuidV7Schema,
    orderedMassMg: NonNegativeSafeIntegerSchema,
    receivedMassMg: NonNegativeSafeIntegerSchema,
    costMinorUnits: NonNegativeSafeIntegerSchema.nullable().optional(),
    notes: z.string().max(2_000).nullable().optional(),
    lots: z.array(AcquisitionLotInputSchema).min(1).max(200),
  })
  .strict()
  .superRefine((line, context) => {
    const allocated = line.lots.reduce(
      (total, lot) => total + lot.receivedMassMg,
      0
    )
    if (!Number.isSafeInteger(allocated) || allocated !== line.receivedMassMg) {
      context.addIssue({
        code: "custom",
        message: "Lot masses must equal receivedMassMg",
        path: ["receivedMassMg"],
      })
    }
  })

export const RecordAcquisitionRequestSchema = z
  .object({
    providerId: UuidV7Schema,
    purchasedAt: IsoInstantSchema,
    receivedAt: IsoInstantSchema.nullable().optional(),
    sourceTimezone: IanaTimezoneSchema,
    supplierReference: z.string().max(200).nullable().optional(),
    currencyCode: CurrencyCodeSchema.nullable().optional(),
    totalMinorUnits: NonNegativeSafeIntegerSchema.nullable().optional(),
    notes: NotesSchema.optional(),
    lines: z.array(AcquisitionLineInputSchema).min(1).max(200),
  })
  .strict()
  .superRefine((purchase, context) => {
    const hasCurrency = purchase.currencyCode != null
    const hasTotal = purchase.totalMinorUnits != null
    if (hasCurrency !== hasTotal) {
      context.addIssue({
        code: "custom",
        message: "Currency and total must be supplied together",
        path: ["totalMinorUnits"],
      })
    }
  })

export const InventoryTransactionResourceDtoSchema = z
  .object({
    ...immutableResourceFields("inventory_transaction"),
    lotId: UuidV7Schema,
    transactionKind: z.enum([
      "receipt",
      "roast_consumption",
      "adjustment",
      "transfer_in",
      "transfer_out",
      "write_off",
    ]),
    deltaMg: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0),
    occurredAt: IsoInstantSchema,
    reason: z.string().trim().min(1).max(1_000),
    sourceRoastId: UuidV7Schema.nullable(),
    transferId: UuidV7Schema.nullable(),
  })
  .strict()
  .superRefine((transaction, context) => {
    const positive = transaction.deltaMg > 0
    const negative = transaction.deltaMg < 0
    const valid =
      transaction.transactionKind === "receipt"
        ? positive &&
          transaction.sourceRoastId === null &&
          transaction.transferId === null
        : transaction.transactionKind === "roast_consumption"
          ? negative &&
            transaction.sourceRoastId !== null &&
            transaction.transferId === null
          : transaction.transactionKind === "adjustment"
            ? transaction.sourceRoastId === null &&
              transaction.transferId === null
            : transaction.transactionKind === "transfer_in"
              ? positive &&
                transaction.sourceRoastId === null &&
                transaction.transferId !== null
              : transaction.transactionKind === "transfer_out"
                ? negative &&
                  transaction.sourceRoastId === null &&
                  transaction.transferId !== null
                : negative &&
                  transaction.sourceRoastId === null &&
                  transaction.transferId === null
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "Transaction references or sign do not match its kind",
        path: ["transactionKind"],
      })
  })

export const InventoryTransferResourceDtoSchema = z
  .object({
    ...immutableResourceFields("inventory_transfer"),
    sourceLotId: UuidV7Schema,
    destinationLotId: UuidV7Schema,
    massMg: PositiveMassMgSchema,
    occurredAt: IsoInstantSchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .refine((transfer) => transfer.sourceLotId !== transfer.destinationLotId, {
    message: "Source and destination lots must differ",
    path: ["destinationLotId"],
  })

export const TransferInventoryRequestSchema = z
  .object({
    sourceLotId: UuidV7Schema,
    destinationLotId: UuidV7Schema,
    massMg: PositiveMassMgSchema,
    reason: z.string().trim().min(1).max(1_000),
    allowNegativeBalance: z.boolean().optional(),
  })
  .strict()
  .refine((transfer) => transfer.sourceLotId !== transfer.destinationLotId, {
    message: "Source and destination lots must differ",
    path: ["destinationLotId"],
  })

export const AdjustInventoryRequestSchema = z
  .object({
    transactionKind: z.enum(["adjustment", "write_off"]),
    deltaMg: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0),
    reason: z.string().trim().min(1).max(1_000),
    allowNegativeBalance: z.boolean().optional(),
  })
  .strict()
  .superRefine((adjustment, context) => {
    if (adjustment.transactionKind === "write_off" && adjustment.deltaMg >= 0) {
      context.addIssue({
        code: "custom",
        message: "A write-off must be negative",
        path: ["deltaMg"],
      })
    }
  })

export type ProviderResourceDto = z.infer<typeof ProviderResourceDtoSchema>
export type CoffeeResourceDto = z.infer<typeof CoffeeResourceDtoSchema>
export type PurchaseResourceDto = z.infer<typeof PurchaseResourceDtoSchema>
export type GreenLotResourceDto = z.infer<typeof GreenLotResourceDtoSchema>
export type InventoryTransactionResourceDto = z.infer<
  typeof InventoryTransactionResourceDtoSchema
>
export type InventoryTransferResourceDto = z.infer<
  typeof InventoryTransferResourceDtoSchema
>
