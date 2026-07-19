export type ContractEvidence =
  "live_verified" | "static_inferred" | "unknown_passthrough"

export type SassiCodecErrorCode =
  | "malformed_syntax"
  | "too_large"
  | "unsupported_type"
  | "invalid_field"
  | "invalid_crc"

export type SassiCodecDiagnostic = {
  code: "unsupported_type"
  message: string
}

export type Type2ConnectionRequest = {
  kind: "connection_request"
  platform: number
  capabilityBits: number
  /** Sensitive identity material. Callers must fingerprint it before storage. */
  serialBytes: Uint8Array
  sassiVersion: number
  model: string
  manufacturerDomain: string
  description: string
  maximumPacketBytes: number
  maximumFilenameBytes: number
  crcSeed: number
}

export type Type4TimeSyncAcknowledgement = {
  kind: "time_sync_ack"
}

export type Type14InfoResponse = {
  kind: "info_response"
  data: string
  infoCode: number
}

export type Type6DirectoryListChunk = {
  kind: "directory_list_chunk"
  path: string
  outcome: number
  final: boolean
  format: number
  sequence: number
  base64Data: string
}

export type Type8FileChunk = {
  kind: "file_chunk"
  path: string
  outcome: number
  final: boolean
  modifiedAt: string
  sequence: number
  base64Data: string
}

export type Type30StatusNotification = {
  kind: "status_notification"
  data: string
  infoCode: number
}

export type Type32IncrementalFileChunk = {
  kind: "incremental_file_chunk"
  path: string
  outcome: number
  final: boolean
  modifiedAt: string
  sequence: number
  base64Data: string
}

export type UnknownInboundMessage = {
  kind: "unknown"
  type: number
}

export type KnownInboundMessage =
  | Type2ConnectionRequest
  | Type4TimeSyncAcknowledgement
  | Type6DirectoryListChunk
  | Type8FileChunk
  | Type14InfoResponse
  | Type30StatusNotification
  | Type32IncrementalFileChunk

export type DecodedSassiMessage = {
  type: number
  elapsedMs: number
  fields: readonly string[]
  evidence: ContractEvidence
  parsed: KnownInboundMessage | UnknownInboundMessage
  diagnostics: readonly SassiCodecDiagnostic[]
  /** Bounded diagnostic text. Type-2 identity and CRC are always redacted. */
  diagnosticFrame: string
}

export type SassiCodecFailure = {
  code: Exclude<SassiCodecErrorCode, "unsupported_type">
  message: string
  diagnosticFrame: string
}

export type DecodeSassiFrameResult =
  | { ok: true; message: DecodedSassiMessage }
  | { ok: false; error: SassiCodecFailure }

export type SassiCodecEvent =
  | { kind: "message"; message: DecodedSassiMessage }
  | { kind: "error"; error: SassiCodecFailure }

export type SassiDecoderOptions = {
  preHandshakeMaximumBytes?: number
  negotiatedMaximumPacketBytes?: number
  negotiatedCrcSeed?: number
}

export type NegotiatedSassiLimits = {
  maximumPacketBytes: number
  crcSeed: number
}
