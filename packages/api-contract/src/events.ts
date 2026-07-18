import { z } from "zod"
import { JobResourceSchema } from "./jobs"
import {
  IsoInstantSchema,
  NonNegativeSafeIntegerSchema,
  ResourceRefSchema,
  Sha256Schema,
  UuidV7Schema,
} from "./primitives"

export function eventEnvelopeSchema<
  TType extends string,
  TPayload extends z.ZodType,
>(type: TType, payload: TPayload) {
  return z
    .object({
      schemaVersion: z.literal(1),
      sessionId: UuidV7Schema,
      seq: z.number().int().min(0).safe(),
      monotonicMs: z.number().int().min(0).safe(),
      emittedAt: IsoInstantSchema,
      type: z.literal(type),
      payload,
    })
    .strict()
}

export const DeviceCandidateSnapshotSchema = z
  .object({
    candidateId: z.string().min(1).max(200),
    transport: z.literal("usb"),
    safeLabel: z.string().min(1).max(200),
    trust: z.enum(["unopened", "identity_pending", "trusted", "rejected"]),
    firstSeenAt: IsoInstantSchema,
    lastSeenAt: IsoInstantSchema,
  })
  .strict()

export const DeviceOperationCapabilitySchema = z
  .object({
    supported: z.boolean(),
    enabled: z.boolean(),
    reasonCode: z.string().max(200).nullable(),
  })
  .strict()

export const DeviceCapabilitySnapshotSchema = z
  .object({
    snapshotId: UuidV7Schema,
    deviceId: UuidV7Schema,
    observedAt: IsoInstantSchema,
    capabilityHash: Sha256Schema,
    protocol: z
      .object({
        name: z.literal("sassi"),
        version: z.number().int().min(1),
        rawCapabilityBitsHex: z.string().regex(/^[0-9a-f]+$/),
        maxPacketBytes: z.number().int().min(1),
        maxFilenameBytes: z.number().int().min(1),
      })
      .strict(),
    target: z
      .object({
        model: z.string().min(1).max(100),
        firmware: z.string().max(100).optional(),
        schemaVersions: z.array(z.string().max(100)).max(100),
      })
      .strict(),
    operations: z.record(
      z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
      DeviceOperationCapabilitySchema
    ),
  })
  .strict()

export const DeviceOperationalStatusSchema = z
  .object({
    state: z.enum(["idle", "roasting", "cooling", "fault", "unknown"]),
    busy: z.boolean(),
    elapsedMs: NonNegativeSafeIntegerSchema.optional(),
    storage: z
      .object({
        freeBytes: NonNegativeSafeIntegerSchema,
        totalBytes: NonNegativeSafeIntegerSchema,
      })
      .strict()
      .optional(),
    faults: z
      .array(
        z
          .object({
            code: z.string().min(1).max(200),
            severity: z.enum(["info", "warning", "fault"]),
            messageCode: z.string().min(1).max(200),
          })
          .strict()
      )
      .max(100),
  })
  .strict()
  .refine(
    (status) =>
      status.storage === undefined ||
      status.storage.freeBytes <= status.storage.totalBytes,
    {
      message: "Free storage cannot exceed total storage",
      path: ["storage", "freeBytes"],
    }
  )

export const DeviceSnapshotSchema = z
  .object({
    deviceId: UuidV7Schema,
    targetFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    displayName: z.string().min(1).max(200),
    model: z.string().min(1).max(100),
    firmware: z.string().max(100).optional(),
    connection: z
      .object({
        sessionId: UuidV7Schema.optional(),
        state: z.enum([
          "absent",
          "candidate",
          "opening",
          "awaiting_request",
          "trusted_read_only",
          "negotiating",
          "idle",
          "busy",
          "transferring",
          "reconciling",
          "reconnecting",
          "backoff",
          "rejected",
          "faulted",
        ]),
        transport: z.enum(["usb", "official_lan", "mirror", "future_bridge"]),
        safeLabel: z.string().min(1).max(200),
        connectedAt: IsoInstantSchema.optional(),
      })
      .strict(),
    capabilities: DeviceCapabilitySnapshotSchema,
    status: z.union([
      z.object({ quality: z.literal("unknown") }).strict(),
      z
        .object({
          quality: z.enum(["current", "stale"]),
          observedAt: IsoInstantSchema,
          value: DeviceOperationalStatusSchema,
        })
        .strict(),
    ]),
  })
  .strict()

export const AlertSnapshotSchema = z
  .object({
    alertId: UuidV7Schema,
    severity: z.enum(["info", "warning", "fault"]),
    code: z.string().min(1).max(200),
    messageCode: z.string().min(1).max(200),
    messageParams: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()])
      )
      .optional(),
    raisedAt: IsoInstantSchema,
    resource: ResourceRefSchema.optional(),
  })
  .strict()

export const LiveSessionSnapshotSchema = z
  .object({
    liveSessionId: UuidV7Schema,
    roastId: UuidV7Schema,
    streamId: UuidV7Schema,
    streamVersion: z.number().int().min(1),
    state: z.enum([
      "starting",
      "roasting",
      "cooling",
      "reconciling",
      "awaiting_finalization",
      "completed",
      "interrupted",
      "recovery_required",
    ]),
    freshness: z.enum(["current", "stale", "unknown"]),
    startedAt: IsoInstantSchema,
    lastSampleSeq: NonNegativeSafeIntegerSchema,
    lastElapsedMs: NonNegativeSafeIntegerSchema,
    channelSchemaHash: Sha256Schema,
    latestValues: z.record(
      z.string().min(1).max(100),
      z.number().finite().nullable()
    ),
    gaps: z
      .array(
        z
          .object({
            afterSampleSeq: NonNegativeSafeIntegerSchema,
            beforeSampleSeq: NonNegativeSafeIntegerSchema,
          })
          .strict()
      )
      .max(1_000),
  })
  .strict()

export const LiveSampleBatchSchema = z
  .object({
    liveSessionId: UuidV7Schema,
    roastId: UuidV7Schema,
    streamId: UuidV7Schema,
    sampleSeqStart: NonNegativeSafeIntegerSchema,
    sampleSeqEnd: NonNegativeSafeIntegerSchema,
    elapsedMs: z.array(NonNegativeSafeIntegerSchema).min(1).max(256),
    channels: z
      .array(
        z
          .object({
            channelId: z.string().min(1).max(100),
            values: z.array(z.number().finite().nullable()).min(1).max(256),
          })
          .strict()
      )
      .max(100),
  })
  .strict()
  .superRefine((batch, context) => {
    const expected = batch.sampleSeqEnd - batch.sampleSeqStart + 1
    if (expected !== batch.elapsedMs.length) {
      context.addIssue({
        code: "custom",
        message: "Sample sequence span must match elapsed values",
        path: ["sampleSeqEnd"],
      })
    }
    for (const [index, channel] of batch.channels.entries()) {
      if (channel.values.length !== batch.elapsedMs.length) {
        context.addIssue({
          code: "custom",
          message: "Every channel must contain one value per sample",
          path: ["channels", index, "values"],
        })
      }
    }
  })

export const CollectionKeySchema = z.enum([
  "providers",
  "coffees",
  "tags",
  "purchases",
  "lots",
  "inventory",
  "roast_intents",
  "roasts",
  "roast_library",
  "roast_packages",
  "annotations",
  "attachments",
  "tastings",
  "tasting_scales",
  "next_roast_plans",
  "saved_roast_views",
  "profiles",
  "profile_validations",
  "native_files",
  "devices",
  "sync_plans",
  "label_templates",
  "printers",
  "print_jobs",
  "backups",
  "settings",
  "capabilities",
])

const SessionSnapshotEventSchema = eventEnvelopeSchema(
  "session.snapshot.v1",
  z
    .object({
      buildVersion: z.string().min(1).max(100),
      apiVersion: z.literal("v1"),
      databaseSchemaVersion: z.number().int().min(0),
      recoveryState: z.enum(["ready", "degraded", "recovery"]),
      systemCapabilityHash: Sha256Schema,
      candidates: z.array(DeviceCandidateSnapshotSchema),
      devices: z.array(DeviceSnapshotSchema),
      activeLiveSession: LiveSessionSnapshotSchema.optional(),
      activeJobs: z.array(JobResourceSchema),
      alerts: z.array(AlertSnapshotSchema),
    })
    .strict()
)

const HeartbeatEventSchema = eventEnvelopeSchema(
  "system.heartbeat.v1",
  z.object({ serverMonotonicMs: NonNegativeSafeIntegerSchema }).strict()
)
const CapabilitiesChangedEventSchema = eventEnvelopeSchema(
  "system.capabilities_changed.v1",
  z.object({ capabilityHash: Sha256Schema }).strict()
)
const ResourceChangedEventSchema = eventEnvelopeSchema(
  "resource.changed.v1",
  z
    .object({
      change: z.enum(["created", "updated", "archived", "deleted"]),
      resources: z.array(ResourceRefSchema).min(1).max(100),
      invalidate: z.array(CollectionKeySchema).min(1).max(100),
    })
    .strict()
)
const JobChangedEventSchema = eventEnvelopeSchema(
  "job.changed.v1",
  z.object({ job: JobResourceSchema }).strict()
)
const CandidateChangedEventSchema = eventEnvelopeSchema(
  "device.candidate_changed.v1",
  z
    .object({
      change: z.enum(["appeared", "updated", "disappeared"]),
      candidate: DeviceCandidateSnapshotSchema,
    })
    .strict()
)
const DeviceChangedEventSchema = eventEnvelopeSchema(
  "device.snapshot_changed.v1",
  z.object({ device: DeviceSnapshotSchema }).strict()
)
const LiveSessionChangedEventSchema = eventEnvelopeSchema(
  "live.session_changed.v1",
  z
    .object({
      change: z.enum(["started", "updated", "ended"]),
      session: LiveSessionSnapshotSchema,
    })
    .strict()
)
const LiveSamplesEventSchema = eventEnvelopeSchema(
  "live.samples.v1",
  LiveSampleBatchSchema
)
const LiveGapEventSchema = eventEnvelopeSchema(
  "live.gap.v1",
  z
    .object({
      liveSessionId: UuidV7Schema,
      roastId: UuidV7Schema,
      afterSampleSeq: NonNegativeSafeIntegerSchema,
      beforeSampleSeq: NonNegativeSafeIntegerSchema,
      reason: z.enum(["device", "transport", "server_backpressure", "unknown"]),
    })
    .strict()
)
const AlertChangedEventSchema = eventEnvelopeSchema(
  "alert.changed.v1",
  z
    .object({
      change: z.enum(["raised", "updated", "resolved"]),
      alert: AlertSnapshotSchema,
    })
    .strict()
)
const ServerShutdownEventSchema = eventEnvelopeSchema(
  "server.shutdown.v1",
  z
    .object({
      reason: z.enum(["application_exit", "update", "restart", "recovery"]),
      retryAfterMs: NonNegativeSafeIntegerSchema.optional(),
    })
    .strict()
)

export const ApiEventSchema = z.discriminatedUnion("type", [
  SessionSnapshotEventSchema,
  HeartbeatEventSchema,
  CapabilitiesChangedEventSchema,
  ResourceChangedEventSchema,
  JobChangedEventSchema,
  CandidateChangedEventSchema,
  DeviceChangedEventSchema,
  LiveSessionChangedEventSchema,
  LiveSamplesEventSchema,
  LiveGapEventSchema,
  AlertChangedEventSchema,
  ServerShutdownEventSchema,
])

export type ApiEvent = z.infer<typeof ApiEventSchema>
