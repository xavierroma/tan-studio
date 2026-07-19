import type { CompanionDatabase } from "../db/database"
import { withImmediateTransaction } from "../db/database"
import { isoInstant, newId, normalizeName } from "../api/http"
import { ApiError, notFound, revisionConflict } from "../api/problem"
import type {
  CoffeeCreate,
  CoffeePatch,
  LotCreate,
  LotPatch,
  ProviderCreate,
  ProviderPatch,
} from "../api/schemas"

type ListOptions = {
  first: number
  offset: number
  search?: string
  includeArchived: boolean
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function constraint(error: unknown, code: string, detail: string): never {
  if (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed")
  ) {
    throw new ApiError({
      status: 409,
      code,
      title: "Resource already exists",
      detail,
    })
  }
  if (
    error instanceof Error &&
    error.message.includes("FOREIGN KEY constraint failed")
  ) {
    throw new ApiError({
      status: 422,
      code: "invalid_relationship",
      title: "Invalid relationship",
      detail: "A referenced catalog resource does not exist.",
    })
  }
  throw error
}

type ProviderRow = {
  id: string
  display_name: string
  aliases_json: string
  contact_json: string
  reference_notes: string | null
  default_currency_code: string | null
  notes: string | null
  archived_at_ms: number | null
  created_at_ms: number
  updated_at_ms: number
  revision: number
}

export type ProviderResource = ReturnType<typeof mapProvider>

type ProviderContact = {
  websiteUrl: string | null
  email: string | null
  phone: string | null
}

type ProviderContactInput = {
  websiteUrl?: string | null | undefined
  email?: string | null | undefined
  phone?: string | null | undefined
}

function completeProviderContact(
  contact?: ProviderContactInput
): ProviderContact {
  return {
    websiteUrl: contact?.websiteUrl ?? null,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
  }
}

function mapProvider(row: ProviderRow) {
  return {
    kind: "provider" as const,
    id: row.id,
    revision: row.revision,
    displayName: row.display_name,
    aliases: parseJson<string[]>(row.aliases_json),
    contact: completeProviderContact(
      parseJson<ProviderContactInput>(row.contact_json)
    ),
    referenceNotes: row.reference_notes,
    defaultCurrencyCode: row.default_currency_code,
    notes: row.notes,
    archivedAt:
      row.archived_at_ms == null ? null : isoInstant(row.archived_at_ms),
    createdAt: isoInstant(row.created_at_ms),
    updatedAt: isoInstant(row.updated_at_ms),
  }
}

type CoffeeRow = {
  id: string
  serial_number: number | null
  display_name: string
  country_code: string | null
  region: string | null
  farm_producer: string | null
  station_cooperative: string | null
  process: string | null
  varieties_json: string
  altitude_min_m: number | null
  altitude_max_m: number | null
  harvest_label: string | null
  notes: string | null
  archived_at_ms: number | null
  created_at_ms: number
  updated_at_ms: number
  revision: number
  lot_count?: number
  roast_count?: number
}

export type CoffeeResource = ReturnType<typeof mapCoffee>

function mapCoffee(row: CoffeeRow) {
  return {
    kind: "coffee" as const,
    id: row.id,
    serialNumber: row.serial_number,
    revision: row.revision,
    displayName: row.display_name,
    countryCode: row.country_code,
    region: row.region,
    farmProducer: row.farm_producer,
    stationCooperative: row.station_cooperative,
    process: row.process,
    varieties: parseJson<string[]>(row.varieties_json),
    altitudeMinMetres: row.altitude_min_m,
    altitudeMaxMetres: row.altitude_max_m,
    harvestLabel: row.harvest_label,
    notes: row.notes,
    archivedAt:
      row.archived_at_ms == null ? null : isoInstant(row.archived_at_ms),
    createdAt: isoInstant(row.created_at_ms),
    updatedAt: isoInstant(row.updated_at_ms),
  }
}

type LotRow = {
  id: string
  purchase_line_id: string
  supplier_code: string | null
  internal_code: string
  received_mass_mg: number
  on_hand_mass_mg: number
  received_at_ms: number
  source_timezone: string
  storage_location: string | null
  storage_notes: string
  state: "active" | "depleted" | "archived"
  archived_at_ms: number | null
  created_at_ms: number
  updated_at_ms: number
  revision: number
  coffee_id: string
  coffee_name: string
  purchase_id: string
  purchase_reference: string | null
  provider_id: string
  provider_name: string
  roast_count: number
  latest_score_basis_points: number | null
}

export type LotResource = ReturnType<typeof mapLot>

function mapLot(row: LotRow) {
  return {
    kind: "lot" as const,
    id: row.id,
    revision: row.revision,
    purchaseLineId: row.purchase_line_id,
    coffeeId: row.coffee_id,
    supplierCode: row.supplier_code,
    internalCode: row.internal_code,
    receivedMassMg: row.received_mass_mg,
    onHandMassMg: row.on_hand_mass_mg,
    balanceMg: row.on_hand_mass_mg,
    receivedAt: isoInstant(row.received_at_ms),
    sourceTimezone: row.source_timezone,
    storageLocation: row.storage_location,
    storageNotes: row.storage_notes,
    state: row.state,
    coffee: { id: row.coffee_id, displayName: row.coffee_name },
    purchase: {
      id: row.purchase_id,
      supplierReference: row.purchase_reference,
    },
    provider: { id: row.provider_id, displayName: row.provider_name },
    summary: {
      roastCount: row.roast_count,
      latestScoreBasisPoints: row.latest_score_basis_points,
    },
    ...(row.archived_at_ms == null
      ? {}
      : { archivedAt: isoInstant(row.archived_at_ms) }),
    createdAt: isoInstant(row.created_at_ms),
    updatedAt: isoInstant(row.updated_at_ms),
  }
}

const lotSelect = `
  SELECT l.*,
         c.id AS coffee_id, c.display_name AS coffee_name,
         p.id AS purchase_id, p.supplier_reference AS purchase_reference,
         v.id AS provider_id, v.display_name AS provider_name,
         (SELECT count(*) FROM roasts r WHERE r.green_lot_id = l.id) AS roast_count,
         (SELECT max(t.score_basis_points)
            FROM roasts r JOIN tastings t ON t.roast_id = r.id
           WHERE r.green_lot_id = l.id) AS latest_score_basis_points
    FROM green_lots l
    JOIN purchase_lines pl ON pl.id = l.purchase_line_id
    JOIN coffee_identities c ON c.id = pl.coffee_id
    JOIN green_purchases p ON p.id = pl.purchase_id
    JOIN providers v ON v.id = p.provider_id
`

export class CatalogRepository {
  constructor(readonly database: CompanionDatabase) {}

  listProviders(options: ListOptions): {
    items: ProviderResource[]
    hasNextPage: boolean
  } {
    const where: string[] = []
    const params: Array<string | number> = []
    if (!options.includeArchived) where.push("archived_at_ms IS NULL")
    if (options.search) {
      where.push("normalized_name LIKE ? ESCAPE '\\'")
      params.push(
        `%${normalizeName(options.search).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
      )
    }
    params.push(options.first + 1, options.offset)
    const rows = this.database
      .query(
        `SELECT * FROM providers ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
              ORDER BY normalized_name, id LIMIT ? OFFSET ?`
      )
      .all(...params) as ProviderRow[]
    return {
      items: rows.slice(0, options.first).map(mapProvider),
      hasNextPage: rows.length > options.first,
    }
  }

  getProvider(id: string): ProviderResource {
    const row = this.database
      .query("SELECT * FROM providers WHERE id = ?")
      .get(id) as ProviderRow | null
    if (!row) throw notFound("provider", id)
    return mapProvider(row)
  }

  createProvider(input: ProviderCreate): ProviderResource {
    const id = newId()
    const now = Date.now()
    try {
      this.database
        .query(
          `INSERT INTO providers
          (id, display_name, normalized_name, aliases_json, contact_json, reference_notes,
           default_currency_code, notes, created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.displayName,
          normalizeName(input.displayName),
          JSON.stringify(input.aliases ?? []),
          JSON.stringify(completeProviderContact(input.contact)),
          input.referenceNotes ?? null,
          input.defaultCurrencyCode ?? null,
          input.notes ?? null,
          now,
          now
        )
    } catch (error) {
      constraint(
        error,
        "provider_name_conflict",
        "An active provider already uses this name."
      )
    }
    return this.getProvider(id)
  }

  updateProvider(
    id: string,
    expectedRevision: number,
    patch: ProviderPatch
  ): ProviderResource {
    const current = this.getProvider(id)
    if (current.revision !== expectedRevision) {
      throw revisionConflict(
        `"revision:${current.revision}"`,
        `"revision:${expectedRevision}"`
      )
    }
    const now = Date.now()
    const contact = patch.contact
      ? completeProviderContact({
          websiteUrl:
            patch.contact.websiteUrl === undefined
              ? current.contact.websiteUrl
              : patch.contact.websiteUrl,
          email:
            patch.contact.email === undefined
              ? current.contact.email
              : patch.contact.email,
          phone:
            patch.contact.phone === undefined
              ? current.contact.phone
              : patch.contact.phone,
        })
      : current.contact
    try {
      withImmediateTransaction(this.database, () => {
        this.database
          .query(
            `UPDATE providers SET display_name = ?, normalized_name = ?, aliases_json = ?, contact_json = ?,
                    reference_notes = ?, default_currency_code = ?, notes = ?, updated_at_ms = ?,
                    revision = revision + 1 WHERE id = ? AND revision = ?`
          )
          .run(
            patch.displayName ?? current.displayName,
            normalizeName(patch.displayName ?? current.displayName),
            JSON.stringify(patch.aliases ?? current.aliases),
            JSON.stringify(contact),
            patch.referenceNotes === undefined
              ? current.referenceNotes
              : patch.referenceNotes,
            patch.defaultCurrencyCode === undefined
              ? current.defaultCurrencyCode
              : patch.defaultCurrencyCode,
            patch.notes === undefined ? current.notes : patch.notes,
            now,
            id,
            expectedRevision
          )
        this.database
          .query(
            "UPDATE roast_library_rows SET provider_name = ? WHERE provider_id = ?"
          )
          .run(patch.displayName ?? current.displayName, id)
        this.refreshFts("provider_id", id)
      })
    } catch (error) {
      constraint(
        error,
        "provider_name_conflict",
        "An active provider already uses this name."
      )
    }
    return this.getProvider(id)
  }

  archiveProvider(id: string, expectedRevision: number): ProviderResource {
    const current = this.getProvider(id)
    if (current.revision !== expectedRevision) {
      throw revisionConflict(
        `"revision:${current.revision}"`,
        `"revision:${expectedRevision}"`
      )
    }
    const now = Date.now()
    this.database
      .query(
        "UPDATE providers SET archived_at_ms = ?, updated_at_ms = ?, revision = revision + 1 WHERE id = ?"
      )
      .run(now, now, id)
    return this.getProvider(id)
  }

  listCoffees(options: ListOptions): {
    items: CoffeeResource[]
    hasNextPage: boolean
  } {
    const where: string[] = []
    const params: Array<string | number> = []
    if (!options.includeArchived) where.push("c.archived_at_ms IS NULL")
    if (options.search) {
      where.push(
        "(c.normalized_name LIKE ? ESCAPE '\\' OR lower(coalesce(c.region,'')) LIKE ? ESCAPE '\\')"
      )
      const pattern = `%${normalizeName(options.search).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
      params.push(pattern, pattern)
    }
    params.push(options.first + 1, options.offset)
    const rows = this.database
      .query(
        `SELECT c.*,
                (SELECT count(*) FROM purchase_lines pl JOIN green_lots l ON l.purchase_line_id = pl.id WHERE pl.coffee_id = c.id) lot_count,
                (SELECT count(*) FROM roasts r WHERE r.coffee_id = c.id) roast_count
              FROM coffee_identities c ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
              ORDER BY c.normalized_name, c.id LIMIT ? OFFSET ?`
      )
      .all(...params) as CoffeeRow[]
    return {
      items: rows.slice(0, options.first).map(mapCoffee),
      hasNextPage: rows.length > options.first,
    }
  }

  getCoffee(id: string): CoffeeResource {
    const row = this.database
      .query(
        `SELECT c.*,
                (SELECT count(*) FROM purchase_lines pl JOIN green_lots l ON l.purchase_line_id = pl.id WHERE pl.coffee_id = c.id) lot_count,
                (SELECT count(*) FROM roasts r WHERE r.coffee_id = c.id) roast_count
              FROM coffee_identities c WHERE c.id = ?`
      )
      .get(id) as CoffeeRow | null
    if (!row) throw notFound("coffee", id)
    return mapCoffee(row)
  }

  createCoffee(input: CoffeeCreate): CoffeeResource {
    const id = newId()
    const now = Date.now()
    withImmediateTransaction(this.database, () => {
      const serial = this.database
        .query(
          "SELECT coalesce(max(serial_number), 0) + 1 AS value FROM coffee_identities"
        )
        .get() as { value: number }
      this.database
        .query(
          `INSERT INTO coffee_identities
          (id, serial_number, display_name, normalized_name, country_code, region, farm_producer, station_cooperative,
           process, varieties_json, altitude_min_m, altitude_max_m, harvest_label, notes, created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          serial.value,
          input.displayName,
          normalizeName(input.displayName),
          input.countryCode ?? null,
          input.region ?? null,
          input.farmProducer ?? null,
          input.stationCooperative ?? null,
          input.process ?? null,
          JSON.stringify(input.varieties ?? []),
          input.altitudeMinMetres ?? null,
          input.altitudeMaxMetres ?? null,
          input.harvestLabel ?? null,
          input.notes ?? null,
          now,
          now
        )
    })
    return this.getCoffee(id)
  }

  updateCoffee(
    id: string,
    expectedRevision: number,
    patch: CoffeePatch
  ): CoffeeResource {
    const current = this.getCoffee(id)
    if (current.revision !== expectedRevision) {
      throw revisionConflict(
        `"revision:${current.revision}"`,
        `"revision:${expectedRevision}"`
      )
    }
    const merged = {
      displayName: patch.displayName ?? current.displayName,
      countryCode:
        patch.countryCode === undefined
          ? current.countryCode
          : patch.countryCode,
      region: patch.region === undefined ? current.region : patch.region,
      farmProducer:
        patch.farmProducer === undefined
          ? current.farmProducer
          : patch.farmProducer,
      stationCooperative:
        patch.stationCooperative === undefined
          ? current.stationCooperative
          : patch.stationCooperative,
      process: patch.process === undefined ? current.process : patch.process,
      varieties: patch.varieties ?? current.varieties,
      altitudeMinMetres:
        patch.altitudeMinMetres === undefined
          ? current.altitudeMinMetres
          : patch.altitudeMinMetres,
      altitudeMaxMetres:
        patch.altitudeMaxMetres === undefined
          ? current.altitudeMaxMetres
          : patch.altitudeMaxMetres,
      harvestLabel:
        patch.harvestLabel === undefined
          ? current.harvestLabel
          : patch.harvestLabel,
      notes: patch.notes === undefined ? current.notes : patch.notes,
    }
    if (
      merged.altitudeMinMetres != null &&
      merged.altitudeMaxMetres != null &&
      merged.altitudeMaxMetres < merged.altitudeMinMetres
    ) {
      throw new ApiError({
        status: 422,
        code: "validation_failed",
        title: "Validation failed",
        detail: "The altitude range is invalid.",
        fieldErrors: [
          {
            path: "/altitudeMaxMetres",
            code: "custom",
            message: "Must be greater than or equal to altitudeMinMetres",
          },
        ],
      })
    }
    const now = Date.now()
    withImmediateTransaction(this.database, () => {
      this.database
        .query(
          `UPDATE coffee_identities SET display_name=?, normalized_name=?, country_code=?, region=?,
          farm_producer=?, station_cooperative=?, process=?, varieties_json=?, altitude_min_m=?, altitude_max_m=?,
          harvest_label=?, notes=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?`
        )
        .run(
          merged.displayName,
          normalizeName(merged.displayName),
          merged.countryCode,
          merged.region,
          merged.farmProducer,
          merged.stationCooperative,
          merged.process,
          JSON.stringify(merged.varieties),
          merged.altitudeMinMetres,
          merged.altitudeMaxMetres,
          merged.harvestLabel,
          merged.notes,
          now,
          id,
          expectedRevision
        )
      this.database
        .query(
          `UPDATE roast_library_rows SET coffee_name=?, country_code=?, region=?, farm_producer=?, process=?, varieties_json=?
                WHERE coffee_id=?`
        )
        .run(
          merged.displayName,
          merged.countryCode,
          merged.region,
          merged.farmProducer,
          merged.process,
          JSON.stringify(merged.varieties),
          id
        )
      this.refreshFts("coffee_id", id)
    })
    return this.getCoffee(id)
  }

  archiveCoffee(id: string, expectedRevision: number): CoffeeResource {
    const current = this.getCoffee(id)
    if (current.revision !== expectedRevision) {
      throw revisionConflict(
        `"revision:${current.revision}"`,
        `"revision:${expectedRevision}"`
      )
    }
    const now = Date.now()
    this.database
      .query(
        "UPDATE coffee_identities SET archived_at_ms=?, updated_at_ms=?, revision=revision+1 WHERE id=?"
      )
      .run(now, now, id)
    return this.getCoffee(id)
  }

  listLots(options: ListOptions): {
    items: LotResource[]
    hasNextPage: boolean
  } {
    const where: string[] = []
    const params: Array<string | number> = []
    if (!options.includeArchived) where.push("l.archived_at_ms IS NULL")
    if (options.search) {
      where.push(
        "(lower(l.internal_code) LIKE ? ESCAPE '\\' OR lower(c.display_name) LIKE ? ESCAPE '\\' OR lower(v.display_name) LIKE ? ESCAPE '\\')"
      )
      const pattern = `%${normalizeName(options.search).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
      params.push(pattern, pattern, pattern)
    }
    params.push(options.first + 1, options.offset)
    const rows = this.database
      .query(
        `${lotSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
              ORDER BY l.received_at_ms DESC, l.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params) as LotRow[]
    return {
      items: rows.slice(0, options.first).map(mapLot),
      hasNextPage: rows.length > options.first,
    }
  }

  getLot(id: string): LotResource {
    const row = this.database
      .query(`${lotSelect} WHERE l.id = ?`)
      .get(id) as LotRow | null
    if (!row) throw notFound("lot", id)
    return mapLot(row)
  }

  createLot(input: LotCreate): LotResource {
    const id = newId()
    const now = Date.now()
    try {
      withImmediateTransaction(this.database, () => {
        const balanceMg = input.onHandMassMg ?? input.receivedMassMg
        this.database
          .query(
            `INSERT INTO green_lots
            (id, purchase_line_id, supplier_code, internal_code, received_mass_mg, on_hand_mass_mg,
             received_at_ms, source_timezone, storage_location, storage_notes, state, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            input.purchaseLineId,
            input.supplierCode ?? null,
            input.internalCode,
            input.receivedMassMg,
            balanceMg,
            Date.parse(input.receivedAt),
            input.sourceTimezone,
            input.storageLocation ?? null,
            input.storageNotes ?? "",
            input.state ?? "active",
            now,
            now
          )
        this.database
          .query(
            `INSERT INTO inventory_transactions
            (id, lot_id, transaction_kind, delta_mg, occurred_at_ms, reason, created_at_ms)
            VALUES (?, ?, 'receipt', ?, ?, 'Initial lot receipt', ?)`
          )
          .run(
            newId(),
            id,
            input.receivedMassMg,
            Date.parse(input.receivedAt),
            now
          )
        if (balanceMg !== input.receivedMassMg) {
          this.database
            .query(
              `INSERT INTO inventory_transactions
              (id, lot_id, transaction_kind, delta_mg, occurred_at_ms, reason, created_at_ms)
              VALUES (?, ?, 'adjustment', ?, ?, 'Opening balance reconciliation', ?)`
            )
            .run(newId(), id, balanceMg - input.receivedMassMg, now, now)
        }
      })
    } catch (error) {
      constraint(
        error,
        "lot_code_conflict",
        "A lot already uses this internal code."
      )
    }
    return this.getLot(id)
  }

  updateLot(
    id: string,
    expectedRevision: number,
    patch: LotPatch
  ): LotResource {
    const current = this.getLot(id)
    if (current.revision !== expectedRevision) {
      throw revisionConflict(
        `"revision:${current.revision}"`,
        `"revision:${expectedRevision}"`
      )
    }
    const merged = {
      supplierCode:
        patch.supplierCode === undefined
          ? current.supplierCode
          : patch.supplierCode,
      internalCode: patch.internalCode ?? current.internalCode,
      storageLocation:
        patch.storageLocation === undefined
          ? current.storageLocation
          : patch.storageLocation,
      storageNotes: patch.storageNotes ?? current.storageNotes,
      state: patch.state ?? current.state,
    }
    const now = Date.now()
    try {
      withImmediateTransaction(this.database, () => {
        this.database
          .query(
            `UPDATE green_lots SET supplier_code=?, internal_code=?, storage_location=?, storage_notes=?, state=?,
                    archived_at_ms=?, updated_at_ms=?, revision=revision+1 WHERE id=? AND revision=?`
          )
          .run(
            merged.supplierCode,
            merged.internalCode,
            merged.storageLocation,
            merged.storageNotes,
            merged.state,
            merged.state === "archived" ? now : null,
            now,
            id,
            expectedRevision
          )
        this.database
          .query(
            "UPDATE roast_library_rows SET lot_code=? WHERE green_lot_id=?"
          )
          .run(merged.internalCode, id)
      })
    } catch (error) {
      constraint(
        error,
        "lot_code_conflict",
        "A lot already uses this internal code."
      )
    }
    return this.getLot(id)
  }

  private refreshFts(
    scopeColumn: "provider_id" | "coffee_id",
    id: string
  ): void {
    this.database
      .query(
        `DELETE FROM roast_library_fts
               WHERE roast_id IN (SELECT roast_id FROM roast_library_rows WHERE ${scopeColumn} = ?)`
      )
      .run(id)
    this.database
      .query(
        `INSERT INTO roast_library_fts
        (roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion)
        SELECT roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion
          FROM roast_library_rows WHERE ${scopeColumn} = ?`
      )
      .run(id)
  }
}
