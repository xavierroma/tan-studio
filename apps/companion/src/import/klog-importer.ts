import {
  assertKlogImportable,
  NativeFormatError,
  parseKlog,
  type KlogDocument,
  type KlogSample,
} from "@tan-studio/native-format-adapters"
import { CryptoHasher } from "bun"

import { newId, normalizeName } from "../api/http"
import type { CompanionDatabase } from "../db/database"
import { withImmediateTransaction } from "../db/database"

export type ImportKlogInput = {
  bytes: Uint8Array
  devicePath: string
  filename: string
  sourceModifiedAt: string
}

export type ImportKlogResult = {
  roastId: string
  serialNumber: number
  nativeLogNumber: number | null
  sourceHash: string
  imported: boolean
  updated: boolean
  sampleCount: number
  warningCount: number
}

type ExistingImport = {
  roast_id: string
  serial_number: number
}

type ExistingLogicalRoast = ExistingImport & {
  source_file_id: string
  stream_version: number | null
}

const MAXIMUM_RETAINED_FILE_BYTES = 64 * 1024 * 1024
const MAXIMUM_JSON_BYTES = 1024 * 1024
const MAXIMUM_ROW_JSON_BYTES = 256 * 1024
const textEncoder = new TextEncoder()

export class KlogImportRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "KlogImportRejectedError"
  }
}

/** Transactional, idempotent import of one immutable device roast log. */
export class KlogImporter {
  constructor(readonly database: CompanionDatabase) {}

  isQuarantinedError(error: unknown): boolean {
    return error instanceof KlogImportRejectedError
  }

  import(input: ImportKlogInput): ImportKlogResult {
    let document: KlogDocument
    try {
      document = parseKlog(input.bytes)
      assertKlogImportable(document)
      assertImportProjection(document, input)
    } catch (error) {
      const rejected = classifyImportRejection(error)
      this.#quarantine(input, rejected)
      throw rejected
    }
    const existing = this.database
      .query(
        `SELECT r.id AS roast_id, r.serial_number
           FROM native_files f JOIN roasts r ON r.source_file_id = f.id
          WHERE f.sha256 = ?`
      )
      .get(document.lossless.sourceHash) as ExistingImport | null
    if (existing) {
      return {
        roastId: existing.roast_id,
        serialNumber: existing.serial_number,
        nativeLogNumber: nativeLogNumber(document, input.filename),
        sourceHash: document.lossless.sourceHash,
        imported: false,
        updated: false,
        sampleCount: document.samples.length,
        warningCount: document.diagnostics.length,
      }
    }

    return withImmediateTransaction(this.database, () => {
      const logical = this.database
        .query(
          `SELECT r.id AS roast_id, r.serial_number, r.source_file_id,
                  s.stream_version
             FROM native_files f
             JOIN roasts r ON r.source_file_id = f.id
             LEFT JOIN roast_sample_streams s ON s.roast_id = r.id
            WHERE f.device_path = ?
            ORDER BY f.imported_at_ms DESC LIMIT 1`
        )
        .get(input.devicePath) as ExistingLogicalRoast | null

      const now = Date.now()
      const sourceFileId = newId()
      this.database
        .query(
          `INSERT INTO native_files
          (id, sha256, kind, filename, device_path, source_modified_at, byte_length,
           original_bytes, parser_version, warnings_json, imported_at_ms)
          VALUES (?, ?, 'klog', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sourceFileId,
          document.lossless.sourceHash,
          input.filename,
          input.devicePath,
          input.sourceModifiedAt,
          input.bytes.byteLength,
          input.bytes,
          document.parserVersion,
          JSON.stringify(document.diagnostics),
          now
        )

      const profileRevisionId = this.#resolveProfile(document, now)
      const facts = roastFacts(document, input)
      const roastId = logical?.roast_id ?? newId()
      const serialNumber = logical?.serial_number ?? this.#nextSerial("roasts")
      const streamVersion = (logical?.stream_version ?? 0) + 1

      if (logical) {
        this.database
          .query(
            `UPDATE roasts
                SET profile_revision_id = ?, roasted_at_ms = ?, source_timezone = 'UTC',
                    level_thousandths = ?, development_basis_points = ?, green_input_mass_mg = ?,
                    end_reason = ?, result = ?, status = ?, notes = ?, native_log_number = ?,
                    roast_duration_ms = ?, cooldown_end_ms = ?, source_file_id = ?,
                    native_metadata_json = ?, import_warnings_json = ?, updated_at_ms = ?,
                    revision = revision + 1
              WHERE id = ?`
          )
          .run(
            profileRevisionId,
            facts.roastedAtMs,
            facts.levelThousandths,
            facts.developmentBasisPoints,
            facts.greenInputMassMg,
            facts.endReason,
            facts.result,
            facts.status,
            facts.notes,
            facts.nativeLogNumber,
            facts.durationMs,
            facts.cooldownEndMs,
            sourceFileId,
            JSON.stringify(facts.publicMetadata),
            JSON.stringify(document.diagnostics),
            now,
            roastId
          )
        this.#replaceTelemetry(roastId, streamVersion, document, now)
        this.#refreshExistingProjection(roastId, facts, profileRevisionId)
      } else {
        this.database
          .query(
            `INSERT INTO roasts
            (id, serial_number, profile_revision_id, roasted_at_ms, source_timezone,
             level_thousandths, development_basis_points, green_input_mass_mg,
             end_reason, result, status, notes, native_log_number, roast_duration_ms,
             cooldown_end_ms, source_file_id, native_metadata_json, import_warnings_json,
             created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            roastId,
            serialNumber,
            profileRevisionId,
            facts.roastedAtMs,
            facts.levelThousandths,
            facts.developmentBasisPoints,
            facts.greenInputMassMg,
            facts.endReason,
            facts.result,
            facts.status,
            facts.notes,
            facts.nativeLogNumber,
            facts.durationMs,
            facts.cooldownEndMs,
            sourceFileId,
            JSON.stringify(facts.publicMetadata),
            JSON.stringify(document.diagnostics),
            now,
            now
          )
        this.#replaceTelemetry(roastId, streamVersion, document, now)
        this.#insertProjection(roastId, serialNumber, facts, profileRevisionId)
      }

      return {
        roastId,
        serialNumber,
        nativeLogNumber: facts.nativeLogNumber,
        sourceHash: document.lossless.sourceHash,
        imported: !logical,
        updated: Boolean(logical),
        sampleCount: document.samples.length,
        warningCount: document.diagnostics.length,
      }
    })
  }

  #quarantine(
    input: ImportKlogInput,
    rejection: KlogImportRejectedError
  ): void {
    const now = Date.now()
    const sourceHash = new CryptoHasher("sha256")
      .update(input.bytes)
      .digest("hex")
    const retainedBytes =
      input.bytes.byteLength <= MAXIMUM_RETAINED_FILE_BYTES ? input.bytes : null
    this.database
      .query(
        `INSERT INTO native_file_quarantine
        (sha256, kind, filename, device_path, source_modified_at, byte_length,
         original_bytes, parser_version, error_code, error_detail,
         first_seen_at_ms, last_seen_at_ms, attempt_count)
        VALUES (?, 'klog', ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, 1)
        ON CONFLICT(sha256) DO UPDATE SET
          last_seen_at_ms = excluded.last_seen_at_ms,
          attempt_count = native_file_quarantine.attempt_count + 1,
          error_code = excluded.error_code,
          error_detail = excluded.error_detail`
      )
      .run(
        sourceHash,
        safeText(input.filename, 512, "unnamed.klog"),
        safeOptionalText(input.devicePath, 2_048),
        safeOptionalText(input.sourceModifiedAt, 512),
        input.bytes.byteLength,
        retainedBytes,
        safeText(rejection.code, 64, "unsafe_semantic_projection"),
        safeText(rejection.message, 2_048, "Kaffelogic log rejected"),
        now,
        now
      )
  }

  #resolveProfile(document: KlogDocument, now: number): string | null {
    const shortName =
      document.effectiveMetadata.profile_short_name?.trim() ||
      document.effectiveMetadata.profile_file_name?.trim() ||
      "Imported profile"
    const normalizedName = normalizeName(shortName)
    let profile = this.database
      .query(
        "SELECT id FROM profiles WHERE normalized_name = ? AND origin = 'extracted' ORDER BY created_at_ms LIMIT 1"
      )
      .get(normalizedName) as { id: string } | null
    if (!profile) {
      profile = { id: newId() }
      this.database
        .query(
          `INSERT INTO profiles
          (id, display_name, normalized_name, family, origin, created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, 'extracted', ?, ?)`
        )
        .run(profile.id, shortName, normalizedName, shortName, now, now)
    }

    const profileDocument = profileMetadata(document)
    const documentJson = JSON.stringify(profileDocument)
    const existingRevision = this.database
      .query(
        "SELECT id FROM profile_revisions WHERE profile_id = ? AND document_json = ?"
      )
      .get(profile.id, documentJson) as { id: string } | null
    if (existingRevision) return existingRevision.id

    const revisionNumber = this.database
      .query(
        "SELECT coalesce(max(revision_number), 0) + 1 AS value FROM profile_revisions WHERE profile_id = ?"
      )
      .get(profile.id) as { value: number }
    const revisionId = newId()
    this.database
      .query(
        `INSERT INTO profile_revisions
        (id, profile_id, revision_number, schema_version, short_name, document_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        revisionId,
        profile.id,
        revisionNumber.value,
        schemaInteger(document.effectiveMetadata.profile_schema_version),
        shortName,
        documentJson,
        now
      )
    return revisionId
  }

  #replaceTelemetry(
    roastId: string,
    streamVersion: number,
    document: KlogDocument,
    now: number
  ): void {
    this.database
      .query("DELETE FROM roast_series_points WHERE roast_id = ?")
      .run(roastId)
    this.database
      .query(
        "DELETE FROM roast_events WHERE roast_id = ? AND source = 'native'"
      )
      .run(roastId)
    this.database
      .query("DELETE FROM roast_sample_streams WHERE roast_id = ?")
      .run(roastId)

    const firstElapsedMs = document.samples[0]?.elapsedMs ?? 0
    const lastElapsedMs = document.samples.at(-1)?.elapsedMs ?? 0
    this.database
      .query(
        `INSERT INTO roast_sample_streams
        (roast_id, stream_version, channel_schema_json, row_count, first_elapsed_ms,
         last_elapsed_ms, reconciliation_state)
        VALUES (?, ?, ?, ?, ?, ?, 'reconciled')`
      )
      .run(
        roastId,
        streamVersion,
        JSON.stringify(document.channels),
        document.samples.length,
        firstElapsedMs,
        lastElapsedMs
      )

    const insertSample = this.database.query(
      `INSERT INTO roast_series_points
      (roast_id, sample_seq, elapsed_ms, temperature_milli_c,
       profile_temperature_milli_c, ror_milli_c_per_min,
       spot_temperature_milli_c, mean_temperature_milli_c,
       profile_ror_milli_c_per_min, desired_ror_milli_c_per_min,
       power_milli_kw, motor_voltage_trace_milli, kp_milli, ki_milli, kd_milli,
       actual_fan_rpm, values_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const sample of document.samples) {
      const values = sample.values
      insertSample.run(
        roastId,
        sample.sampleSeq,
        sample.elapsedMs,
        milli(masterTemperature(values)),
        nullableMilli(values.profile),
        nullableMilli(values.actual_ROR),
        nullableMilli(values.spot_temp),
        nullableMilli(values.mean_temp),
        nullableMilli(values.profile_ROR),
        nullableMilli(values.desired_ROR),
        nullableMilli(values.power_kW),
        nullableMilli(values["volts-9"]),
        nullableMilli(values.Kp),
        nullableMilli(values.Ki),
        nullableMilli(values.Kd),
        nullableInteger(values.actual_fan_RPM),
        JSON.stringify(values)
      )
    }

    const temperatureOffset =
      document.channels.find((channel) => channel.name === "temp")?.offsetMs ??
      0
    const insertEvent = this.database.query(
      `INSERT INTO roast_events
      (id, roast_id, event_kind, elapsed_ms, temperature_milli_c, source, created_at_ms)
      VALUES (?, ?, ?, ?, ?, 'native', ?)`
    )
    for (const event of document.events) {
      // Negative native roast-end times are legitimate interrupted-preheat
      // markers. They remain in immutable metadata but are not chart anchors.
      if (event.elapsedMs < 0) continue
      insertEvent.run(
        newId(),
        roastId,
        event.kind,
        event.elapsedMs,
        nearestTemperature(
          document.samples,
          event.elapsedMs,
          temperatureOffset
        ),
        now
      )
    }
  }

  #insertProjection(
    roastId: string,
    serialNumber: number,
    facts: ReturnType<typeof roastFacts>,
    profileRevisionId: string | null
  ): void {
    const profile = profileRevisionId
      ? (this.database
          .query(
            `SELECT p.display_name, pr.revision_number
               FROM profile_revisions pr JOIN profiles p ON p.id = pr.profile_id
              WHERE pr.id = ?`
          )
          .get(profileRevisionId) as {
          display_name: string
          revision_number: number
        })
      : null
    this.database
      .query(
        `INSERT INTO roast_library_rows
        (roast_id, serial_number, revision, roasted_at_ms, coffee_name, provider_name,
         varieties_json, profile_revision_id, profile_name, profile_revision_number,
         roast_level_thousandths, green_input_mass_mg, development_basis_points,
         tags_json, result, status, needs_tasting, native_log_number, duration_ms)
        VALUES (?, ?, 1, ?, 'Unassigned coffee', NULL, '[]', ?, ?, ?, ?, ?, ?, '[]', ?, ?, 1, ?, ?)`
      )
      .run(
        roastId,
        serialNumber,
        facts.roastedAtMs,
        profileRevisionId,
        profile?.display_name ?? "Imported profile",
        profile?.revision_number ?? 1,
        facts.levelThousandths,
        facts.greenInputMassMg,
        facts.developmentBasisPoints,
        facts.result,
        facts.status,
        facts.nativeLogNumber,
        facts.durationMs
      )
    this.#replaceFts(roastId, "Unassigned coffee", "", "", facts.notes)
  }

  #refreshExistingProjection(
    roastId: string,
    facts: ReturnType<typeof roastFacts>,
    profileRevisionId: string | null
  ): void {
    const profile = profileRevisionId
      ? (this.database
          .query(
            `SELECT p.display_name, pr.revision_number
               FROM profile_revisions pr JOIN profiles p ON p.id = pr.profile_id
              WHERE pr.id = ?`
          )
          .get(profileRevisionId) as {
          display_name: string
          revision_number: number
        })
      : null
    this.database
      .query(
        `UPDATE roast_library_rows
            SET revision = revision + 1, roasted_at_ms = ?, profile_revision_id = ?,
                profile_name = ?, profile_revision_number = ?, roast_level_thousandths = ?,
                green_input_mass_mg = ?, development_basis_points = ?, result = ?, status = ?,
                native_log_number = ?, duration_ms = ?
          WHERE roast_id = ?`
      )
      .run(
        facts.roastedAtMs,
        profileRevisionId,
        profile?.display_name ?? "Imported profile",
        profile?.revision_number ?? 1,
        facts.levelThousandths,
        facts.greenInputMassMg,
        facts.developmentBasisPoints,
        facts.result,
        facts.status,
        facts.nativeLogNumber,
        facts.durationMs,
        roastId
      )
    const projection = this.database
      .query(
        `SELECT coffee_name, provider_name, farm_producer, process,
                coalesce(tasting_notes, '') AS tasting_notes
           FROM roast_library_rows WHERE roast_id = ?`
      )
      .get(roastId) as {
      coffee_name: string | null
      provider_name: string | null
      farm_producer: string | null
      process: string | null
      tasting_notes: string
    }
    this.#replaceFts(
      roastId,
      projection.coffee_name ?? "Unassigned coffee",
      projection.provider_name ?? "",
      projection.farm_producer ?? "",
      `${projection.tasting_notes} ${facts.notes}`.trim(),
      projection.process ?? ""
    )
  }

  #replaceFts(
    roastId: string,
    coffeeName: string,
    providerName: string,
    farmProducer: string,
    notes: string,
    process = ""
  ): void {
    this.database
      .query("DELETE FROM roast_library_fts WHERE roast_id = ?")
      .run(roastId)
    this.database
      .query(
        `INSERT INTO roast_library_fts
        (roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion)
        VALUES (?, ?, ?, ?, ?, ?, '')`
      )
      .run(roastId, coffeeName, providerName, farmProducer, process, notes)
  }

  #nextSerial(table: "roasts"): number {
    const value = this.database
      .query(
        `SELECT coalesce(max(serial_number), 0) + 1 AS value FROM ${table}`
      )
      .get() as { value: number }
    return value.value
  }
}

function roastFacts(document: KlogDocument, input: ImportKlogInput) {
  const metadata = document.effectiveMetadata
  const nativeEndReason = finiteNumber(metadata.roast_end_reason)
  const nativeRoastEndMs = document.events.find(
    (event) => event.kind === "roast_end"
  )?.elapsedMs
  const roastEndMs =
    nativeRoastEndMs !== undefined && nativeRoastEndMs > 0
      ? nativeRoastEndMs
      : undefined
  const firstCrackMs = document.events.find(
    (event) => event.kind === "first_crack"
  )?.elapsedMs
  const cooldownEndMs = Math.max(
    0,
    document.samples.at(-1)?.elapsedMs ?? roastEndMs ?? 0
  )
  const durationMs = roastEndMs ?? Math.max(0, cooldownEndMs)
  const successful = nativeEndReason === 0 && durationMs >= 60_000
  const status = successful ? "completed" : "interrupted"
  const result = successful
    ? "success"
    : nativeEndReason !== undefined || document.samples.length > 0
      ? "aborted"
      : "unknown"
  const greenLoadGrams =
    positiveNumber(metadata.boost_load_size) ??
    positiveNumber(metadata.reference_load_size)
  const publicMetadata = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      key === "model"
        ? value.replace(/^(KN[^/]+\/[^/]+)\/.*$/u, "$1/<redacted>")
        : value,
    ])
  )
  return {
    nativeLogNumber: nativeLogNumber(document, input.filename),
    roastedAtMs:
      parseKaffelogicDate(metadata.roast_date) ??
      parseSassiDate(input.sourceModifiedAt) ??
      Date.now(),
    levelThousandths: nullableMilli(finiteNumber(metadata.roasting_level)),
    developmentBasisPoints:
      firstCrackMs && roastEndMs && firstCrackMs < roastEndMs
        ? Math.round(((roastEndMs - firstCrackMs) / roastEndMs) * 10_000)
        : nullablePercentBasisPoints(metadata.development_percent),
    greenInputMassMg:
      greenLoadGrams === undefined ? null : Math.round(greenLoadGrams * 1_000),
    endReason:
      nativeEndReason === undefined
        ? null
        : `${nativeEndReason}:${endReasonLabel(nativeEndReason)}`,
    result,
    status,
    notes: (metadata.tasting_notes ?? "").replaceAll("\\v", "\n"),
    durationMs,
    cooldownEndMs,
    publicMetadata,
  }
}

function profileMetadata(document: KlogDocument): Record<string, string> {
  const roastOnly = new Set([
    "log_file_name",
    "roasting_level",
    "roast_date",
    "roast_end",
    "roast_end_reason",
    "tasting_notes",
    "ambient_temperature",
    "mains_voltage",
    "heater_power_available",
    "model",
    "motor_hours",
    "heater_hours",
    "firmware_version",
  ])
  return Object.fromEntries(
    Object.entries(document.effectiveMetadata)
      .filter(([key]) => !roastOnly.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

function nativeLogNumber(
  document: KlogDocument,
  filename: string
): number | null {
  const source = document.effectiveMetadata.log_file_name ?? filename
  const match = /log0*([0-9]+)\.klog$/iu.exec(source)
  return match?.[1] ? Number(match[1]) : null
}

function parseKaffelogicDate(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match =
    /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})(?: UTC)?$/u.exec(
      value.trim()
    )
  if (!match) return undefined
  const [, day, month, year, hour, minute, second] = match
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
  const date = new Date(timestamp)
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
    ? timestamp
    : undefined
}

function parseSassiDate(value: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})\d(\d{2})(\d{2})(\d{2})$/u.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
  const date = new Date(timestamp)
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
    ? timestamp
    : undefined
}

function schemaInteger(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000
    ? Math.round(parsed * 1_000)
    : 1
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && Math.abs(parsed) <= 1_000_000_000_000
    ? parsed
    : undefined
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function nullableMilli(value: number | undefined): number | null {
  return value === undefined ? null : milli(value)
}

function milli(value: number): number {
  const scaled = Math.round(value * 1_000)
  if (!Number.isSafeInteger(scaled))
    throw new KlogImportRejectedError(
      "unsafe_scaled_integer",
      "A Kaffelogic telemetry value cannot be stored as an exact integer"
    )
  return scaled
}

function nullableInteger(value: number | undefined): number | null {
  if (value === undefined) return null
  const rounded = Math.round(value)
  if (!Number.isSafeInteger(rounded))
    throw new KlogImportRejectedError(
      "unsafe_scaled_integer",
      "A Kaffelogic telemetry value cannot be stored as an exact integer"
    )
  return rounded
}

function nullablePercentBasisPoints(value: string | undefined): number | null {
  const parsed = finiteNumber(value)
  return parsed === undefined ? null : Math.round(parsed * 100)
}

function nearestTemperature(
  samples: readonly KlogSample[],
  elapsedMs: number,
  offsetMs: number
): number | null {
  let nearest: KlogSample | undefined
  let distance = Number.POSITIVE_INFINITY
  for (const sample of samples) {
    const candidate = Math.abs(sample.elapsedMs + offsetMs - elapsedMs)
    if (candidate < distance) {
      distance = candidate
      nearest = sample
    }
  }
  return nearest === undefined ? null : milli(masterTemperature(nearest.values))
}

function masterTemperature(values: Readonly<Record<string, number>>): number {
  const temperature =
    values.temp ??
    values.mean_temp ??
    values.BT ??
    values.Bean_temp ??
    values.Bean_temperature ??
    values.spot_temp
  if (temperature === undefined) {
    throw new KlogImportRejectedError(
      "missing_master_temperature",
      "No supported bean-temperature value is present"
    )
  }
  return temperature
}

function assertImportProjection(
  document: KlogDocument,
  input: ImportKlogInput
): void {
  if (input.filename.length === 0 || input.filename.length > 512)
    throw new KlogImportRejectedError(
      "invalid_source_identity",
      "The Kaffelogic filename is outside the supported range"
    )
  if (input.devicePath.length > 2_048 || input.sourceModifiedAt.length > 512)
    throw new KlogImportRejectedError(
      "invalid_source_identity",
      "The Kaffelogic source identity is outside the supported range"
    )

  assertJsonSize(document.channels, MAXIMUM_ROW_JSON_BYTES, "channel schema")
  assertJsonSize(document.diagnostics, MAXIMUM_ROW_JSON_BYTES, "diagnostics")
  assertJsonSize(
    document.effectiveMetadata,
    MAXIMUM_JSON_BYTES,
    "native metadata"
  )

  let previousElapsed = Number.NEGATIVE_INFINITY
  document.samples.forEach((sample, index) => {
    if (sample.sampleSeq !== index || sample.elapsedMs < previousElapsed) {
      throw new KlogImportRejectedError(
        "invalid_sample_order",
        "Kaffelogic telemetry samples are not in deterministic time order"
      )
    }
    previousElapsed = sample.elapsedMs
    assertRange(masterTemperature(sample.values), -500, 1_000, "temperature")
    assertOptionalRange(sample.values.profile, -500, 1_000, "profile")
    assertOptionalRange(
      sample.values.spot_temp,
      -500,
      1_000,
      "spot temperature"
    )
    assertOptionalRange(
      sample.values.mean_temp,
      -500,
      1_000,
      "mean temperature"
    )
    assertOptionalRange(
      sample.values.actual_ROR,
      -10_000,
      10_000,
      "rate of rise"
    )
    assertOptionalRange(
      sample.values.profile_ROR,
      -10_000,
      10_000,
      "profile rate of rise"
    )
    assertOptionalRange(
      sample.values.desired_ROR,
      -10_000,
      10_000,
      "desired rate of rise"
    )
    assertOptionalRange(sample.values.power_kW, -1_000, 1_000, "heater power")
    assertOptionalRange(
      sample.values.actual_fan_RPM,
      -1_000_000,
      1_000_000,
      "fan speed"
    )
    for (const value of Object.values(sample.values)) milli(value)
    assertJsonSize(sample.values, MAXIMUM_ROW_JSON_BYTES, "telemetry row")
  })

  const metadata = document.effectiveMetadata
  assertMetadataNumber(metadata, "roasting_level", -100, 100, "roast level")
  assertMetadataNumber(metadata, "boost_load_size", 0, 1_000_000, "load size")
  assertMetadataNumber(
    metadata,
    "reference_load_size",
    0,
    1_000_000,
    "reference load size"
  )
  assertMetadataNumber(
    metadata,
    "development_percent",
    0,
    100,
    "development percent"
  )
  assertMetadataNumber(
    metadata,
    "roast_end_reason",
    -1_000_000,
    1_000_000,
    "roast end reason"
  )
  assertMetadataNumber(
    metadata,
    "profile_schema_version",
    0.001,
    1_000,
    "profile schema version"
  )
  const shortName =
    metadata.profile_short_name ?? metadata.profile_file_name ?? ""
  if (shortName.length > 512) {
    throw new KlogImportRejectedError(
      "projection_too_large",
      "The Kaffelogic profile name exceeds 512 characters"
    )
  }
  if (
    metadata.roast_date !== undefined &&
    !parseKaffelogicDate(metadata.roast_date)
  ) {
    throw new KlogImportRejectedError(
      "invalid_roast_date",
      "The Kaffelogic roast date is invalid"
    )
  }
}

function assertMetadataNumber(
  metadata: Readonly<Record<string, string>>,
  key: string,
  minimum: number,
  maximum: number,
  label: string
): void {
  const raw = metadata[key]
  if (raw === undefined) return
  const value = Number(raw)
  assertRange(value, minimum, maximum, label)
}

function assertOptionalRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
  label: string
): void {
  if (value !== undefined) assertRange(value, minimum, maximum, label)
}

function assertRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new KlogImportRejectedError(
      "unsafe_projected_value",
      `The ${label} value is outside the safe storage range`
    )
  }
}

function assertJsonSize(value: unknown, limit: number, label: string): void {
  const length = textEncoder.encode(JSON.stringify(value)).byteLength
  if (length > limit) {
    throw new KlogImportRejectedError(
      "projection_too_large",
      `The Kaffelogic ${label} exceeds ${limit} projected bytes`
    )
  }
}

function classifyImportRejection(error: unknown): KlogImportRejectedError {
  if (error instanceof KlogImportRejectedError) return error
  if (error instanceof NativeFormatError)
    return new KlogImportRejectedError(error.code, error.message)
  return new KlogImportRejectedError(
    "klog_parse_failed",
    "The Kaffelogic log could not be safely parsed"
  )
}

function safeOptionalText(value: string, maximum: number): string | null {
  return value.length === 0 ? null : value.slice(0, maximum)
}

function safeText(value: string, maximum: number, fallback: string): string {
  const safe = value.slice(0, maximum)
  return safe.length === 0 ? fallback : safe
}

function endReasonLabel(value: number): string {
  return (
    (
      {
        0: "level",
        1: "dtr_user_first_crack",
        2: "user",
        3: "studio_user",
        4: "too_slow",
        5: "too_fast",
        6: "too_long",
        7: "interrupted",
        8: "thermal_runaway",
        9: "thermal_dip",
        10: "dtr_expected_first_crack",
        11: "dialled_dtr_without_lock",
      } as Record<number, string>
    )[value] ?? "unknown"
  )
}
