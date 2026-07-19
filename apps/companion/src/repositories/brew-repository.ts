import type { BrewCreate, PreferencesPatch } from "../api/schemas"
import { isoInstant, newId } from "../api/http"
import { notFound, revisionConflict } from "../api/problem"
import type { CompanionDatabase } from "../db/database"
import { withImmediateTransaction } from "../db/database"

type PreferenceRow = {
  default_roaster_name: string
  default_grinder_name: string
  default_grinder_setting: string
  default_kettle_name: string
  default_water_name: string
  default_brew_method: string
  default_coffee_mass_mg: number
  default_water_mass_mg: number
  default_water_temperature_milli_c: number
  updated_at_ms: number
  revision: number
}

type BrewRow = {
  id: string
  serial_number: number
  roast_id: string
  roast_serial_number: number
  coffee_name: string | null
  brewed_at_ms: number
  source_timezone: string
  method: string
  grinder_name: string
  grinder_setting: string
  kettle_name: string
  water_name: string
  coffee_mass_mg: number
  water_mass_mg: number
  water_temperature_milli_c: number | null
  bloom_water_mass_mg: number | null
  bloom_duration_ms: number | null
  brew_duration_ms: number | null
  score_basis_points: number | null
  descriptors_json: string
  tasting_notes: string
  notes: string
  created_at_ms: number
  updated_at_ms: number
  revision: number
}

const brewSelect = `
  SELECT b.*, r.serial_number AS roast_serial_number, c.display_name AS coffee_name
    FROM brews b
    JOIN roasts r ON r.id = b.roast_id
    LEFT JOIN coffee_identities c ON c.id = r.coffee_id
`

export class BrewRepository {
  constructor(readonly database: CompanionDatabase) {}

  getPreferences() {
    const row = this.database
      .query("SELECT * FROM user_preferences WHERE id = 1")
      .get() as PreferenceRow
    return mapPreferences(row)
  }

  updatePreferences(expectedRevision: number, patch: PreferencesPatch) {
    const current = this.getPreferences()
    if (current.revision !== expectedRevision) {
      throw revisionConflict(
        `"revision:${current.revision}"`,
        `"revision:${expectedRevision}"`
      )
    }
    this.database
      .query(
        `UPDATE user_preferences
            SET default_roaster_name = ?, default_grinder_name = ?,
                default_grinder_setting = ?, default_kettle_name = ?, default_water_name = ?,
                default_brew_method = ?, default_coffee_mass_mg = ?, default_water_mass_mg = ?,
                default_water_temperature_milli_c = ?, updated_at_ms = ?, revision = revision + 1
          WHERE id = 1 AND revision = ?`
      )
      .run(
        patch.defaultRoasterName ?? current.defaultRoasterName,
        patch.defaultGrinderName ?? current.defaultGrinderName,
        patch.defaultGrinderSetting ?? current.defaultGrinderSetting,
        patch.defaultKettleName ?? current.defaultKettleName,
        patch.defaultWaterName ?? current.defaultWaterName,
        patch.defaultBrewMethod ?? current.defaultBrewMethod,
        patch.defaultCoffeeMassMg ?? current.defaultCoffeeMassMg,
        patch.defaultWaterMassMg ?? current.defaultWaterMassMg,
        patch.defaultWaterTemperatureMilliC ??
          current.defaultWaterTemperatureMilliC,
        Date.now(),
        expectedRevision
      )
    return this.getPreferences()
  }

  create(input: BrewCreate) {
    return withImmediateTransaction(this.database, () => {
      const roast = this.database
        .query("SELECT id FROM roasts WHERE serial_number = ?")
        .get(input.roastNumber) as { id: string } | null
      if (!roast) throw notFound("roast", String(input.roastNumber))
      const defaults = this.getPreferences()
      const serial = this.database
        .query("SELECT coalesce(max(serial_number), 0) + 1 AS value FROM brews")
        .get() as { value: number }
      const id = newId()
      const now = Date.now()
      this.database
        .query(
          `INSERT INTO brews
          (id, serial_number, roast_id, brewed_at_ms, source_timezone, method,
           grinder_name, grinder_setting, kettle_name, water_name, coffee_mass_mg,
           water_mass_mg, water_temperature_milli_c, bloom_water_mass_mg,
           bloom_duration_ms, brew_duration_ms, score_basis_points, descriptors_json,
           tasting_notes, notes, created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          serial.value,
          roast.id,
          input.brewedAt ? Date.parse(input.brewedAt) : now,
          input.sourceTimezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          input.method ?? defaults.defaultBrewMethod,
          input.grinderName ?? defaults.defaultGrinderName,
          input.grinderSetting ?? defaults.defaultGrinderSetting,
          input.kettleName ?? defaults.defaultKettleName,
          input.waterName ?? defaults.defaultWaterName,
          input.coffeeMassMg ?? defaults.defaultCoffeeMassMg,
          input.waterMassMg ?? defaults.defaultWaterMassMg,
          input.waterTemperatureMilliC === undefined
            ? defaults.defaultWaterTemperatureMilliC
            : input.waterTemperatureMilliC,
          input.bloomWaterMassMg ?? null,
          input.bloomDurationMs ?? null,
          input.brewDurationMs ?? null,
          input.scoreBasisPoints ?? null,
          JSON.stringify(input.descriptors ?? []),
          input.tastingNotes ?? "",
          input.notes ?? "",
          now,
          now
        )
      return this.get(String(serial.value))
    })
  }

  get(reference: string) {
    const row = this.database
      .query(
        `${brewSelect} WHERE ${/^[1-9][0-9]{0,8}$/u.test(reference) ? "b.serial_number" : "b.id"} = ?`
      )
      .get(
        /^[1-9][0-9]{0,8}$/u.test(reference) ? Number(reference) : reference
      ) as BrewRow | null
    if (!row) throw notFound("brew", reference)
    return mapBrew(row)
  }

  list(roastNumber?: number) {
    const rows = roastNumber
      ? (this.database
          .query(
            `${brewSelect} WHERE r.serial_number = ? ORDER BY b.brewed_at_ms DESC, b.serial_number DESC`
          )
          .all(roastNumber) as BrewRow[])
      : (this.database
          .query(
            `${brewSelect} ORDER BY b.brewed_at_ms DESC, b.serial_number DESC LIMIT 500`
          )
          .all() as BrewRow[])
    return rows.map(mapBrew)
  }
}

function mapPreferences(row: PreferenceRow) {
  return {
    kind: "preferences" as const,
    revision: row.revision,
    defaultRoasterName: row.default_roaster_name,
    defaultGrinderName: row.default_grinder_name,
    defaultGrinderSetting: row.default_grinder_setting,
    defaultKettleName: row.default_kettle_name,
    defaultWaterName: row.default_water_name,
    defaultBrewMethod: row.default_brew_method,
    defaultCoffeeMassMg: row.default_coffee_mass_mg,
    defaultWaterMassMg: row.default_water_mass_mg,
    defaultWaterTemperatureMilliC: row.default_water_temperature_milli_c,
    updatedAt: isoInstant(row.updated_at_ms),
  }
}

function mapBrew(row: BrewRow) {
  return {
    kind: "brew" as const,
    id: row.id,
    serialNumber: row.serial_number,
    revision: row.revision,
    roast: {
      id: row.roast_id,
      serialNumber: row.roast_serial_number,
      coffeeName: row.coffee_name,
    },
    brewedAt: isoInstant(row.brewed_at_ms),
    sourceTimezone: row.source_timezone,
    method: row.method,
    grinderName: row.grinder_name,
    grinderSetting: row.grinder_setting,
    kettleName: row.kettle_name,
    waterName: row.water_name,
    coffeeMassMg: row.coffee_mass_mg,
    waterMassMg: row.water_mass_mg,
    ratio: row.water_mass_mg / row.coffee_mass_mg,
    waterTemperatureMilliC: row.water_temperature_milli_c,
    bloomWaterMassMg: row.bloom_water_mass_mg,
    bloomDurationMs: row.bloom_duration_ms,
    brewDurationMs: row.brew_duration_ms,
    scoreBasisPoints: row.score_basis_points,
    descriptors: JSON.parse(row.descriptors_json) as string[],
    tastingNotes: row.tasting_notes,
    notes: row.notes,
    createdAt: isoInstant(row.created_at_ms),
    updatedAt: isoInstant(row.updated_at_ms),
  }
}
