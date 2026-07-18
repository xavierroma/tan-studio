import type { CompanionDatabase } from "../db/database"
import { isoInstant } from "../api/http"
import { ApiError, notFound } from "../api/problem"

type DetailRow = {
  id: string
  revision: number
  roasted_at_ms: number
  source_timezone: string
  level_thousandths: number | null
  development_basis_points: number | null
  green_input_mass_mg: number | null
  roasted_yield_mass_mg: number | null
  end_reason: string | null
  result: string
  status: string
  notes: string
  green_lot_id: string | null
  lot_code: string | null
  coffee_id: string | null
  coffee_name: string | null
  country_code: string | null
  region: string | null
  farm_producer: string | null
  process: string | null
  provider_id: string | null
  provider_name: string | null
  purchase_id: string | null
  purchase_reference: string | null
  profile_revision_id: string | null
  profile_id: string | null
  profile_name: string | null
  profile_revision_number: number | null
  stream_version: number | null
  channel_schema_json: string | null
  row_count: number | null
  first_elapsed_ms: number | null
  last_elapsed_ms: number | null
  reconciliation_state: string | null
  tasting_id: string | null
  tasted_at_ms: number | null
  score_basis_points: number | null
  descriptors_json: string | null
  tasting_notes: string | null
  conclusion: string | null
  next_action: string | null
  created_at_ms: number
  updated_at_ms: number
}

type EventRow = {
  id: string
  event_kind: string
  elapsed_ms: number
  temperature_milli_c: number | null
  source: string
  created_at_ms: number
}

type AnnotationRow = {
  id: string
  elapsed_ms: number | null
  temperature_milli_c: number | null
  annotation_type: string
  text: string
  created_at_ms: number
  updated_at_ms: number
  revision: number
}

type SeriesRow = {
  sample_seq: number
  elapsed_ms: number
  temperature_milli_c: number
  profile_temperature_milli_c: number | null
  ror_milli_c_per_min: number | null
}

const detailSql = `
  SELECT r.*,
         l.internal_code AS lot_code,
         c.display_name AS coffee_name, c.country_code, c.region, c.farm_producer, c.process,
         v.id AS provider_id, v.display_name AS provider_name,
         gp.id AS purchase_id, gp.supplier_reference AS purchase_reference,
         pr.profile_id, p.display_name AS profile_name, pr.revision_number AS profile_revision_number,
         s.stream_version, s.channel_schema_json, s.row_count, s.first_elapsed_ms,
         s.last_elapsed_ms, s.reconciliation_state,
         t.id AS tasting_id, t.tasted_at_ms, t.score_basis_points, t.descriptors_json,
         t.notes AS tasting_notes, t.conclusion, t.next_action
    FROM roasts r
    LEFT JOIN green_lots l ON l.id = r.green_lot_id
    LEFT JOIN purchase_lines pl ON pl.id = l.purchase_line_id
    LEFT JOIN green_purchases gp ON gp.id = pl.purchase_id
    LEFT JOIN providers v ON v.id = gp.provider_id
    LEFT JOIN coffee_identities c ON c.id = r.coffee_id
    LEFT JOIN profile_revisions pr ON pr.id = r.profile_revision_id
    LEFT JOIN profiles p ON p.id = pr.profile_id
    LEFT JOIN roast_sample_streams s ON s.roast_id = r.id
    LEFT JOIN tastings t ON t.id = r.promoted_tasting_id
   WHERE r.id = ?
`

export class RoastRepository {
  constructor(readonly database: CompanionDatabase) {}

  getDetail(id: string) {
    const row = this.database.query(detailSql).get(id) as DetailRow | null
    if (!row) throw notFound("roast", id)
    const events = this.database
      .query(
        "SELECT * FROM roast_events WHERE roast_id = ? ORDER BY elapsed_ms, id"
      )
      .all(id) as EventRow[]
    const annotations = this.database
      .query(
        "SELECT * FROM annotations WHERE roast_id = ? ORDER BY coalesce(elapsed_ms, 2147483647), id"
      )
      .all(id) as AnnotationRow[]

    return {
      kind: "roast" as const,
      id: row.id,
      revision: row.revision,
      greenLotId: row.green_lot_id,
      coffeeId: row.coffee_id,
      profileRevisionId: row.profile_revision_id,
      roastedAt: isoInstant(row.roasted_at_ms),
      sourceTimezone: row.source_timezone,
      roastLevelThousandths: row.level_thousandths,
      developmentBasisPoints: row.development_basis_points,
      greenInputMassMg: row.green_input_mass_mg,
      roastedYieldMassMg: row.roasted_yield_mass_mg,
      endReason: row.end_reason,
      result: row.result,
      status: row.status,
      notes: row.notes,
      promotedTastingId: row.tasting_id,
      lineage: {
        coffee: row.coffee_id
          ? { id: row.coffee_id, displayName: row.coffee_name }
          : null,
        lot: row.green_lot_id
          ? { id: row.green_lot_id, internalCode: row.lot_code }
          : null,
        provider: row.provider_id
          ? { id: row.provider_id, displayName: row.provider_name }
          : null,
        purchase: row.purchase_id
          ? { id: row.purchase_id, supplierReference: row.purchase_reference }
          : null,
        origin: {
          countryCode: row.country_code,
          region: row.region,
          farmProducer: row.farm_producer,
          process: row.process,
        },
      },
      profile: row.profile_revision_id
        ? {
            id: row.profile_id,
            revisionId: row.profile_revision_id,
            displayName: row.profile_name,
            revisionNumber: row.profile_revision_number,
          }
        : null,
      sampleStream:
        row.stream_version == null
          ? null
          : {
              streamVersion: row.stream_version,
              channels: JSON.parse(row.channel_schema_json ?? "[]") as unknown,
              rowCount: row.row_count,
              firstElapsedMs: row.first_elapsed_ms,
              lastElapsedMs: row.last_elapsed_ms,
              reconciliationState: row.reconciliation_state,
            },
      promotedTasting: row.tasting_id
        ? {
            id: row.tasting_id,
            tastedAt: isoInstant(row.tasted_at_ms!),
            scoreBasisPoints: row.score_basis_points,
            descriptors: JSON.parse(row.descriptors_json ?? "[]") as string[],
            notes: row.tasting_notes,
            conclusion: row.conclusion,
            nextAction: row.next_action,
          }
        : null,
      events: events.map((event) => ({
        id: event.id,
        kind: event.event_kind,
        elapsedMs: event.elapsed_ms,
        temperatureMilliC: event.temperature_milli_c,
        source: event.source,
        createdAt: isoInstant(event.created_at_ms),
      })),
      annotations: annotations.map((annotation) => ({
        id: annotation.id,
        revision: annotation.revision,
        elapsedMs: annotation.elapsed_ms,
        temperatureMilliC: annotation.temperature_milli_c,
        type: annotation.annotation_type,
        text: annotation.text,
        createdAt: isoInstant(annotation.created_at_ms),
        updatedAt: isoInstant(annotation.updated_at_ms),
      })),
      createdAt: isoInstant(row.created_at_ms),
      updatedAt: isoInstant(row.updated_at_ms),
    }
  }

  getSeries(
    id: string,
    options: {
      streamVersion: number
      fromElapsedMs: number
      toElapsedMs: number
      maxPoints: number
      throughSampleSeq?: number
      channels?: string
    }
  ) {
    const stream = this.database
      .query("SELECT * FROM roast_sample_streams WHERE roast_id = ?")
      .get(id) as {
      stream_version: number
      row_count: number
      first_elapsed_ms: number
      last_elapsed_ms: number
      reconciliation_state: string
    } | null
    if (!stream) {
      const roastExists = this.database
        .query("SELECT 1 FROM roasts WHERE id = ?")
        .get(id)
      if (!roastExists) throw notFound("roast", id)
      throw new ApiError({
        status: 404,
        code: "roast_series_not_found",
        title: "Series not found",
        detail: "This roast has no telemetry series.",
      })
    }
    if (stream.stream_version !== options.streamVersion) {
      throw new ApiError({
        status: 409,
        code: "stream_version_changed",
        title: "Telemetry stream changed",
        detail: `The current stream version is ${stream.stream_version}. Reload the roast descriptor.`,
      })
    }

    const channelSet = new Set(
      (options.channels ?? "temperature,profileTemperature,ror")
        .split(",")
        .map((channel) => channel.trim())
        .filter(Boolean)
    )
    const allowedChannels = new Set([
      "temperature",
      "profileTemperature",
      "ror",
    ])
    for (const channel of channelSet) {
      if (!allowedChannels.has(channel)) {
        throw new ApiError({
          status: 422,
          code: "unsupported_series_channel",
          title: "Unsupported series channel",
          detail: `The series channel is not available: ${channel}`,
        })
      }
    }

    const rows = this.database
      .query(
        `SELECT * FROM roast_series_points
               WHERE roast_id = ? AND elapsed_ms BETWEEN ? AND ?
                 AND sample_seq <= ?
               ORDER BY sample_seq`
      )
      .all(
        id,
        options.fromElapsedMs,
        options.toElapsedMs,
        options.throughSampleSeq ?? Number.MAX_SAFE_INTEGER
      ) as SeriesRow[]

    const stride =
      rows.length <= options.maxPoints
        ? 1
        : Math.ceil(rows.length / options.maxPoints)
    const sampled = rows.filter(
      (_row, index) =>
        index === 0 || index === rows.length - 1 || index % stride === 0
    )
    if (sampled.length > options.maxPoints)
      sampled.splice(options.maxPoints - 1, sampled.length - options.maxPoints)

    return {
      roastId: id,
      streamVersion: stream.stream_version,
      reconciliationState: stream.reconciliation_state,
      sourceRowCount: rows.length,
      downsampled: sampled.length < rows.length,
      throughSampleSeq: sampled.at(-1)?.sample_seq ?? null,
      points: sampled.map((row) => ({
        sampleSeq: row.sample_seq,
        elapsedMs: row.elapsed_ms,
        ...(channelSet.has("temperature")
          ? { temperatureMilliC: row.temperature_milli_c }
          : {}),
        ...(channelSet.has("profileTemperature")
          ? { profileTemperatureMilliC: row.profile_temperature_milli_c }
          : {}),
        ...(channelSet.has("ror")
          ? { rorMilliCPerMin: row.ror_milli_c_per_min }
          : {}),
      })),
    }
  }
}
