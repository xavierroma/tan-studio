import {
  parseKlog,
  type KlogDocument,
  type KlogSample,
} from "@tan-studio/native-format-adapters"

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

/** Transactional, idempotent import of one immutable device roast log. */
export class KlogImporter {
  constructor(readonly database: CompanionDatabase) {}

  import(input: ImportKlogInput): ImportKlogResult {
    const document = parseKlog(input.bytes)
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
        milli(values.temp ?? values.mean_temp ?? values.spot_temp ?? 0),
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
  const roastEndMs = document.events.find(
    (event) => event.kind === "roast_end"
  )?.elapsedMs
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
  const result = successful ? "success" : durationMs > 0 ? "aborted" : "unknown"
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
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
}

function parseSassiDate(value: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})\d(\d{2})(\d{2})(\d{2})$/u.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
}

function schemaInteger(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed * 1_000)) : 1
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function nullableMilli(value: number | undefined): number | null {
  return value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 1_000)
}

function milli(value: number): number {
  return Math.round(value * 1_000)
}

function nullableInteger(value: number | undefined): number | null {
  return value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value)
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
  const temperature = nearest?.values.temp
  return temperature === undefined ? null : milli(temperature)
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
