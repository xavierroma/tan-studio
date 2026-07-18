import { z } from "zod"
import {
  ArtifactRefSchema,
  BasisPointsSchema,
  IsoInstantSchema,
  ResourceRefSchema,
  Sha256Schema,
  UuidSchema,
  UuidV7Schema,
  mutableResourceFields,
} from "./primitives"

export const JobTypeSchema = z.enum([
  "native_import",
  "native_export",
  "roast_library_export",
  "device_connection",
  "sync_plan",
  "sync_execution",
  "profile_deployment",
  "label_render",
  "printer_discovery",
  "print_submission",
  "backup",
  "restore_validation",
  "restore_activation",
  "projection_rebuild",
  "diagnostic_preview",
  "diagnostic_bundle",
  "artifact_export",
  "system_document_open",
  "system_print_dialog",
])
export const JobStateSchema = z.enum([
  "queued",
  "running",
  "waiting_external",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
])

export const PrintLifecycleSchema = z.enum([
  "draft",
  "rendering",
  "ready",
  "submitting",
  "active",
  "succeeded",
  "failed",
  "cancelled",
  "indeterminate",
])
export const PrintEvidenceSchema = z
  .object({
    kind: z.enum([
      "submitted",
      "spooled",
      "deviceAccepted",
      "physicallyConfirmed",
      "failed",
      "unknown",
    ]),
    observedAt: IsoInstantSchema,
    source: z.string().min(1).max(100),
    safeCode: z.string().max(200).nullable(),
  })
  .strict()

const NativeImportResultSchema = z
  .object({
    artifacts: z.array(ArtifactRefSchema),
    roasts: z.array(ResourceRefSchema),
    profileRevisions: z.array(ResourceRefSchema),
    warningCount: z.number().int().min(0),
  })
  .strict()
const NativeExportResultSchema = z
  .object({ artifact: ArtifactRefSchema })
  .strict()
const RoastLibraryExportResultSchema = z
  .object({ artifact: ArtifactRefSchema, rowCount: z.number().int().min(0) })
  .strict()
const DeviceConnectionResultSchema = z
  .object({
    device: ResourceRefSchema,
    sessionId: UuidV7Schema,
    capabilitySnapshotId: UuidV7Schema,
  })
  .strict()
const SyncPlanResultSchema = z
  .object({
    syncPlan: ResourceRefSchema,
    operationCount: z.number().int().min(0),
  })
  .strict()
const SyncExecutionResultSchema = z
  .object({
    syncPlan: ResourceRefSchema,
    pulled: z.number().int().min(0),
    pushed: z.number().int().min(0),
    conflicts: z.number().int().min(0),
  })
  .strict()
const ProfileDeploymentResultSchema = z
  .object({
    profileRevision: ResourceRefSchema,
    device: ResourceRefSchema,
    receiptId: z.string().min(1).max(200),
  })
  .strict()
const LabelRenderResultSchema = z
  .object({ artifact: ArtifactRefSchema })
  .strict()
const PrinterDiscoveryResultSchema = z
  .object({ printers: z.array(ResourceRefSchema) })
  .strict()
const PrintSubmissionResultSchema = z
  .object({
    printJob: ResourceRefSchema,
    lifecycle: PrintLifecycleSchema,
    evidence: z.array(PrintEvidenceSchema),
  })
  .strict()
const BackupResultSchema = z
  .object({ backup: ResourceRefSchema, artifact: ArtifactRefSchema })
  .strict()
const RestoreValidationResultSchema = z
  .object({
    validationId: UuidV7Schema,
    reportHash: Sha256Schema,
    mode: z.enum(["replace", "merge"]),
    valid: z.boolean(),
    warningCount: z.number().int().min(0),
    conflictCount: z.number().int().min(0),
  })
  .strict()
const RestoreActivationResultSchema = z
  .object({ storeGenerationId: UuidV7Schema, activatedAt: IsoInstantSchema })
  .strict()
const ProjectionRebuildResultSchema = z
  .object({
    projection: z.string().min(1).max(200),
    rowCount: z.number().int().min(0),
    verificationHash: Sha256Schema,
  })
  .strict()
const DiagnosticPreviewResultSchema = z
  .object({
    previewId: UuidV7Schema,
    categoryCount: z.number().int().min(0),
    redactionCount: z.number().int().min(0),
  })
  .strict()
const DiagnosticBundleResultSchema = z
  .object({ artifact: ArtifactRefSchema })
  .strict()
const ArtifactExportResultSchema = z
  .object({
    artifact: ArtifactRefSchema,
    outcome: z.enum(["saved", "cancelled"]),
  })
  .strict()
const SystemDocumentOpenResultSchema = z
  .object({
    artifact: ArtifactRefSchema,
    outcome: z.enum(["opened", "cancelled"]),
  })
  .strict()
const SystemPrintDialogResultSchema = z
  .object({
    artifact: ArtifactRefSchema,
    outcome: z.enum(["presented", "cancelled", "submitted"]),
    osJobId: z.string().max(500).optional(),
  })
  .strict()

const resultSchemas = {
  native_import: NativeImportResultSchema,
  native_export: NativeExportResultSchema,
  roast_library_export: RoastLibraryExportResultSchema,
  device_connection: DeviceConnectionResultSchema,
  sync_plan: SyncPlanResultSchema,
  sync_execution: SyncExecutionResultSchema,
  profile_deployment: ProfileDeploymentResultSchema,
  label_render: LabelRenderResultSchema,
  printer_discovery: PrinterDiscoveryResultSchema,
  print_submission: PrintSubmissionResultSchema,
  backup: BackupResultSchema,
  restore_validation: RestoreValidationResultSchema,
  restore_activation: RestoreActivationResultSchema,
  projection_rebuild: ProjectionRebuildResultSchema,
  diagnostic_preview: DiagnosticPreviewResultSchema,
  diagnostic_bundle: DiagnosticBundleResultSchema,
  artifact_export: ArtifactExportResultSchema,
  system_document_open: SystemDocumentOpenResultSchema,
  system_print_dialog: SystemPrintDialogResultSchema,
} as const

export const JobResultSchema = z.union(Object.values(resultSchemas))

export const JobFailureSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    detail: z.string().min(1).max(2_000),
    retryable: z.boolean(),
    manualReconciliationRequired: z.boolean(),
  })
  .strict()

export const JobProgressSchema = z
  .object({
    basisPoints: BasisPointsSchema,
    phase: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    messageCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    messageParams: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()])
      )
      .optional(),
  })
  .strict()

export const JobResourceSchema = z
  .object({
    ...mutableResourceFields("job"),
    jobType: JobTypeSchema,
    state: JobStateSchema,
    progress: JobProgressSchema,
    attempt: z.number().int().min(0),
    correlationId: UuidSchema,
    cancellationSupported: z.boolean(),
    result: JobResultSchema.optional(),
    failure: JobFailureSchema.optional(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.state === "succeeded") {
      if (job.result === undefined)
        context.addIssue({
          code: "custom",
          message: "A succeeded job requires a result",
          path: ["result"],
        })
      else if (!resultSchemas[job.jobType].safeParse(job.result).success) {
        context.addIssue({
          code: "custom",
          message: `Result does not match ${job.jobType}`,
          path: ["result"],
        })
      }
      if (job.failure !== undefined)
        context.addIssue({
          code: "custom",
          message: "A succeeded job cannot have a failure",
          path: ["failure"],
        })
    } else if (job.state === "failed") {
      if (job.failure === undefined)
        context.addIssue({
          code: "custom",
          message: "A failed job requires a failure",
          path: ["failure"],
        })
      if (job.result !== undefined)
        context.addIssue({
          code: "custom",
          message: "A failed job cannot have a result",
          path: ["result"],
        })
    } else {
      if (job.result !== undefined)
        context.addIssue({
          code: "custom",
          message: "Only a succeeded job may have a result",
          path: ["result"],
        })
      if (job.failure !== undefined)
        context.addIssue({
          code: "custom",
          message: "Only a failed job may have a failure",
          path: ["failure"],
        })
    }
  })

export type JobResource = z.infer<typeof JobResourceSchema>
