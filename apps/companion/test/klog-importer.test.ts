import { beforeEach, describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"

import { openDatabase } from "../src/db/database"
import { migrate } from "../src/db/migrate"
import {
  KlogImporter,
  KlogImportRejectedError,
} from "../src/import/klog-importer"

let database: Database

beforeEach(async () => {
  database = openDatabase(":memory:")
  await migrate(database)
})

describe("Kaffelogic log import", () => {
  test("retains original bytes and projects every native telemetry channel", () => {
    const importer = new KlogImporter(database)
    const bytes = fixture("2.00000", "521.216")
    const result = importer.import({
      bytes,
      devicePath: "kaffelogic/roast-logs/log0013.klog",
      filename: "log0013.klog",
      sourceModifiedAt: "202607186184617",
    })

    expect(result).toMatchObject({
      serialNumber: 1,
      nativeLogNumber: 13,
      imported: true,
      updated: false,
      sampleCount: 2,
      warningCount: 0,
    })
    const roast = database
      .query(
        `SELECT serial_number, native_log_number, roasted_at_ms, level_thousandths,
                green_input_mass_mg, roast_duration_ms, cooldown_end_ms, result, status
           FROM roasts WHERE id = ?`
      )
      .get(result.roastId)
    expect(roast).toEqual({
      serial_number: 1,
      native_log_number: 13,
      roasted_at_ms: Date.UTC(2026, 6, 18, 18, 46, 17),
      level_thousandths: 2_000,
      green_input_mass_mg: 50_000,
      roast_duration_ms: 521_216,
      cooldown_end_ms: 522_000,
      result: "success",
      status: "completed",
    })
    const source = database
      .query("SELECT original_bytes, byte_length FROM native_files")
      .get() as { original_bytes: Uint8Array; byte_length: number }
    expect(source.byte_length).toBe(bytes.length)
    expect(Array.from(source.original_bytes)).toEqual(Array.from(bytes))

    const stream = database
      .query(
        "SELECT stream_version, row_count, channel_schema_json FROM roast_sample_streams"
      )
      .get() as {
      stream_version: number
      row_count: number
      channel_schema_json: string
    }
    expect(stream.stream_version).toBe(1)
    expect(stream.row_count).toBe(2)
    expect(JSON.parse(stream.channel_schema_json)).toHaveLength(13)
    expect(JSON.parse(stream.channel_schema_json)[0]).toMatchObject({
      name: "spot_temp",
      offsetMs: -8_500,
      hiddenByDefault: true,
    })
    const point = database
      .query(
        `SELECT temperature_milli_c, spot_temperature_milli_c,
                mean_temperature_milli_c, profile_temperature_milli_c,
                profile_ror_milli_c_per_min, ror_milli_c_per_min,
                desired_ror_milli_c_per_min, power_milli_kw, actual_fan_rpm,
                values_json
           FROM roast_series_points WHERE roast_id = ? AND sample_seq = 0`
      )
      .get(result.roastId)
    expect(point).toMatchObject({
      temperature_milli_c: 216_000,
      spot_temperature_milli_c: 216_100,
      mean_temperature_milli_c: 215_900,
      profile_temperature_milli_c: 218_000,
      profile_ror_milli_c_per_min: 6_600,
      ror_milli_c_per_min: 5_900,
      desired_ror_milli_c_per_min: 6_000,
      power_milli_kw: 710,
      actual_fan_rpm: 13_200,
    })
    expect(
      Object.keys(JSON.parse((point as { values_json: string }).values_json))
    ).toHaveLength(13)
    expect(
      database.query("SELECT event_kind, elapsed_ms FROM roast_events").all()
    ).toEqual([{ event_kind: "roast_end", elapsed_ms: 521_216 }])

    const duplicate = importer.import({
      bytes,
      devicePath: "kaffelogic/roast-logs/log0013.klog",
      filename: "log0013.klog",
      sourceModifiedAt: "202607186184617",
    })
    expect(duplicate).toMatchObject({
      roastId: result.roastId,
      serialNumber: 1,
      imported: false,
      updated: false,
    })
    expect(
      database.query("SELECT count(*) AS count FROM roasts").get()
    ).toEqual({
      count: 1,
    })
  })

  test("updates one logical roast when the same device path changes", () => {
    const importer = new KlogImporter(database)
    const first = importer.import({
      bytes: fixture("2.00000", "521.216"),
      devicePath: "kaffelogic/roast-logs/log0013.klog",
      filename: "log0013.klog",
      sourceModifiedAt: "202607186184617",
    })
    const revised = importer.import({
      bytes: fixture("2.50000", "530.000"),
      devicePath: "kaffelogic/roast-logs/log0013.klog",
      filename: "log0013.klog",
      sourceModifiedAt: "202607186185000",
    })

    expect(revised).toMatchObject({
      roastId: first.roastId,
      serialNumber: 1,
      imported: false,
      updated: true,
    })
    expect(
      database.query("SELECT count(*) AS count FROM native_files").get()
    ).toEqual({
      count: 2,
    })
    expect(
      database
        .query(
          `SELECT r.level_thousandths, r.roast_duration_ms, r.revision,
                  s.stream_version
             FROM roasts r JOIN roast_sample_streams s ON s.roast_id = r.id`
        )
        .get()
    ).toEqual({
      level_thousandths: 2_500,
      roast_duration_ms: 530_000,
      revision: 2,
      stream_version: 2,
    })
  })

  test("quarantines unsafe logs without creating partial roast rows", () => {
    const importer = new KlogImporter(database)
    const bytes = fixture("2.00000", "521.216")
    const text = new TextDecoder().decode(bytes)
    const unsafe = new TextEncoder().encode(
      text.replace("521\t216.1", "521\t1e100")
    )
    const input = {
      bytes: unsafe,
      devicePath: "kaffelogic/roast-logs/log0099.klog",
      filename: "log0099.klog",
      sourceModifiedAt: "202607186184617",
    }

    expect(() => importer.import(input)).toThrow(KlogImportRejectedError)
    expect(() => importer.import(input)).toThrow(KlogImportRejectedError)
    expect(
      database.query("SELECT count(*) AS count FROM roasts").get()
    ).toEqual({ count: 0 })
    expect(
      database.query("SELECT count(*) AS count FROM native_files").get()
    ).toEqual({ count: 0 })
    expect(
      database
        .query(
          `SELECT byte_length, length(original_bytes) AS retained_length,
                  error_code, attempt_count
             FROM native_file_quarantine`
        )
        .get()
    ).toEqual({
      byte_length: unsafe.byteLength,
      retained_length: unsafe.byteLength,
      error_code: "unsafe_semantic_projection",
      attempt_count: 2,
    })
  })

  test("SQLite rejects invalid telemetry even when the importer is bypassed", () => {
    const importer = new KlogImporter(database)
    const result = importer.import({
      bytes: fixture("2.00000", "521.216"),
      devicePath: "kaffelogic/roast-logs/log0013.klog",
      filename: "log0013.klog",
      sourceModifiedAt: "202607186184617",
    })

    expect(() =>
      database
        .query(
          `INSERT INTO roast_series_points
          (roast_id, sample_seq, elapsed_ms, temperature_milli_c, values_json)
          VALUES (?, 99, 999999999999, 200000, '{}')`
        )
        .run(result.roastId)
    ).toThrow("invalid roast series point")
    expect(
      database
        .query(
          "SELECT count(*) AS count FROM roast_series_points WHERE roast_id = ?"
        )
        .get(result.roastId)
    ).toEqual({ count: 2 })
  })

  test("imports a stopped preheat without creating a negative chart event", () => {
    const importer = new KlogImporter(database)
    const bytes = new TextEncoder().encode(
      [
        "log_file_name:kaffelogic/roast-logs/log0009.klog",
        "profile_short_name:Stopped preheat",
        "profile_schema_version:1.8",
        "roast_date:18/07/2026 18:00:00 UTC",
        "",
        "time\t@temp",
        "-5\t40",
        "!roast_end:-12.8161",
        "!roast_end_reason:2",
        "",
      ].join("\n")
    )

    const result = importer.import({
      bytes,
      devicePath: "kaffelogic/roast-logs/log0009.klog",
      filename: "log0009.klog",
      sourceModifiedAt: "202607186180000",
    })

    expect(
      database
        .query(
          "SELECT status, result, roast_duration_ms FROM roasts WHERE id = ?"
        )
        .get(result.roastId)
    ).toEqual({
      status: "interrupted",
      result: "aborted",
      roast_duration_ms: 0,
    })
    expect(
      database.query("SELECT count(*) AS count FROM roast_events").get()
    ).toEqual({ count: 0 })
  })
})

function fixture(level: string, roastEnd: string): Uint8Array {
  return new TextEncoder().encode(
    [
      "log_file_name:kaffelogic/roast-logs/log0013.klog",
      "profile_file_name:1200-1500m Rest v1.0.kpro",
      "profile_short_name:1200-1500m Rest",
      "profile_designer:Kaffelogic Ltd",
      "profile_schema_version:1.4",
      `roasting_level:${level}`,
      "boost_load_size:50.0000",
      "roast_date:18/07/2026 18:37:27 UTC",
      "model:KN1007B/J/TS00000001",
      "firmware_version:7.20.6",
      "roast_profile:0,20,0,0,600,218,0,0",
      "fan_profile:0,14700,0,0,600,13200,0,0",
      "",
      "offsets\t-8.5\t-8.75\t-12\t0\t0\t-19.5\t-8.75\t-8.5\t-8.5\t-8.5\t-8.5\t-8.5\t-8.5",
      "time\t#spot_temp\t#=temp\t=mean_temp\t=profile\tprofile_ROR\t=actual_ROR\t#=desired_ROR\tpower_kW\t#volts-9\t#Kp\t#Ki\t#Kd\t#^actual_fan_RPM",
      "521\t216.1\t216\t215.9\t218\t6.6\t5.9\t6\t0.71\t4.5\t0.7\t0\t3\t13200\t",
      `!roast_end:${roastEnd}`,
      "!roast_end_reason:0.00000",
      "!roast_date:18/07/2026 18:46:17 UTC",
      "522\t120\t121\t200\t218\t6.6\t-1\t6\t0\t4.4\t0.7\t0\t3\t15000\t",
      "",
    ].join("\n")
  )
}
