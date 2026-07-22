import { z } from "zod"

import { UuidSchema } from "./primitives"

export const TanBridgeSetupSchemaVersion = 1 as const
export const TanBridgeSetupMaxLineBytes = 4_096 as const
export const TanBridgeSetupMaxInFlightRequests = 8 as const
export const TanBridgeBackendHost = "xrc.local" as const
export const TanBridgeBackendPort = 8_082 as const

export const TanBridgeLifecycleSchema = z.enum([
  "booting",
  "unprovisioned",
  "provisioning",
  "claiming",
  "operational",
  "recovery",
])

export const TanBridgeWifiStateSchema = z.enum([
  "disabled",
  "scanning",
  "associating",
  "obtainingAddress",
  "online",
  "backoff",
])

export const TanBridgeBackendStateSchema = z.enum([
  "offline",
  "resolving",
  "connecting",
  "authenticating",
  "synchronizing",
  "online",
  "backoff",
])

export const TanBridgeClaimStateSchema = z.enum([
  "unclaimed",
  "pending",
  "claimed",
])

export const TanBridgeWifiAuthModeSchema = z.enum([
  "open",
  "wep",
  "wpa-personal",
  "wpa2-personal",
  "wpa-wpa2-personal",
  "wpa3-personal",
  "wpa2-wpa3-personal",
  "enterprise",
  "unknown",
])

export const TanBridgeSetupStatusSchema = z
  .object({
    protocolVersion: z.literal(TanBridgeSetupSchemaVersion),
    bridgeId: z.string().regex(/^[a-z2-7]{26}$/u),
    firmware: z
      .object({
        version: z.string().min(1).max(64),
        build: z.string().min(1).max(64),
      })
      .strict(),
    lifecycle: TanBridgeLifecycleSchema,
    wifi: z
      .object({
        state: TanBridgeWifiStateSchema,
      })
      .strict(),
    backend: z
      .object({
        state: TanBridgeBackendStateSchema,
        host: z.literal(TanBridgeBackendHost),
        port: z.literal(TanBridgeBackendPort),
      })
      .strict(),
    claim: z
      .object({
        state: TanBridgeClaimStateSchema,
      })
      .strict(),
  })
  .strict()

export const TanBridgeVisibleWifiNetworkSchema = z
  .object({
    networkId: z.string().regex(/^[0-9a-f]{16}$/u),
    ssid: z.string().max(32),
    authMode: TanBridgeWifiAuthModeSchema,
    channel: z.number().int().min(1).max(14),
    rssi: z.number().int().min(-127).max(0),
  })
  .strict()

export const TanBridgeWifiScanSchema = z
  .object({
    scanId: z.string().regex(/^[0-9a-f]{16}$/u),
    networks: z.array(TanBridgeVisibleWifiNetworkSchema).max(12),
  })
  .strict()

export const TanBridgeSetupErrorSchema = z
  .object({
    code: z.enum([
      "invalid_request",
      "unsupported_operation",
      "busy",
      "wifi_scan_failed",
      "wifi_configuration_failed",
      "claim_failed",
      "internal_error",
    ]),
    message: z.string().min(1).max(200),
    retryable: z.boolean(),
  })
  .strict()

const SetupRequestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(TanBridgeSetupSchemaVersion),
    requestId: UuidSchema,
  })
  .strict()

export const TanBridgeSetupGetStatusRequestSchema =
  SetupRequestEnvelopeSchema.extend({
    type: z.literal("setup.getStatus"),
    payload: z.object({}).strict(),
  }).strict()

export const TanBridgeSetupScanWifiRequestSchema =
  SetupRequestEnvelopeSchema.extend({
    type: z.literal("setup.scanWifi"),
    payload: z.object({}).strict(),
  }).strict()

export const TanBridgeSetupConfigureRequestSchema =
  SetupRequestEnvelopeSchema.extend({
    type: z.literal("setup.configure"),
    payload: z
      .object({
        ssid: z.string().min(1).max(32),
        credential: z.string().max(63),
        claimToken: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict(),
  }).strict()

export const TanBridgeSetupRequestSchema = z.discriminatedUnion("type", [
  TanBridgeSetupGetStatusRequestSchema,
  TanBridgeSetupScanWifiRequestSchema,
  TanBridgeSetupConfigureRequestSchema,
])

const SetupResponseEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(TanBridgeSetupSchemaVersion),
    requestId: UuidSchema,
  })
  .strict()

export const TanBridgeSetupGetStatusResponseSchema = z.union([
  SetupResponseEnvelopeSchema.extend({
    result: TanBridgeSetupStatusSchema,
  }).strict(),
  SetupResponseEnvelopeSchema.extend({
    error: TanBridgeSetupErrorSchema,
  }).strict(),
])

export const TanBridgeSetupScanWifiResponseSchema = z.union([
  SetupResponseEnvelopeSchema.extend({
    result: TanBridgeWifiScanSchema,
  }).strict(),
  SetupResponseEnvelopeSchema.extend({
    error: TanBridgeSetupErrorSchema,
  }).strict(),
])

export const TanBridgeSetupConfigureResponseSchema = z.union([
  SetupResponseEnvelopeSchema.extend({
    result: z
      .object({
        accepted: z.literal(true),
        configurationGeneration: z.number().int().positive(),
      })
      .strict(),
  }).strict(),
  SetupResponseEnvelopeSchema.extend({
    error: TanBridgeSetupErrorSchema,
  }).strict(),
])

export const TanBridgeSetupResponseEnvelopeSchema = z.union([
  z
    .object({
      schemaVersion: z.literal(TanBridgeSetupSchemaVersion),
      requestId: UuidSchema,
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(TanBridgeSetupSchemaVersion),
      requestId: UuidSchema,
      error: TanBridgeSetupErrorSchema,
    })
    .strict(),
])

export type TanBridgeSetupStatus = z.infer<typeof TanBridgeSetupStatusSchema>
export type TanBridgeVisibleWifiNetwork = z.infer<
  typeof TanBridgeVisibleWifiNetworkSchema
>
export type TanBridgeWifiScan = z.infer<typeof TanBridgeWifiScanSchema>
export type TanBridgeSetupError = z.infer<typeof TanBridgeSetupErrorSchema>
export type TanBridgeSetupRequest = z.infer<typeof TanBridgeSetupRequestSchema>
