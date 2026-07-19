import type { LabelCreate } from "../api/schemas"
import { isoInstant, newId } from "../api/http"
import { notFound } from "../api/problem"
import type { CompanionDatabase } from "../db/database"
import { withImmediateTransaction } from "../db/database"

type LabelRow = {
  id: string
  serial_number: number
  roast_id: string
  roast_serial_number: number
  qr_payload: string
  copies: number
  artifact_sha256: string | null
  status: string
  created_at_ms: number
}

export class LabelRepository {
  constructor(readonly database: CompanionDatabase) {}

  create(input: LabelCreate) {
    return withImmediateTransaction(this.database, () => {
      const roast = this.database
        .query("SELECT id FROM roasts WHERE serial_number = ?")
        .get(input.roastNumber) as { id: string } | null
      if (!roast) throw notFound("roast", String(input.roastNumber))
      const serial = this.database
        .query(
          "SELECT coalesce(max(serial_number), 0) + 1 AS value FROM label_records"
        )
        .get() as { value: number }
      const id = newId()
      this.database
        .query(
          `INSERT INTO label_records
          (id, serial_number, roast_id, roast_serial_number, qr_payload, copies,
           status, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, 'generated', ?)`
        )
        .run(
          id,
          serial.value,
          roast.id,
          input.roastNumber,
          `tan:roast:${input.roastNumber}`,
          input.copies,
          Date.now()
        )
      return this.get(String(serial.value))
    })
  }

  get(reference: string) {
    const numeric = /^[1-9][0-9]{0,8}$/u.test(reference)
    const row = this.database
      .query(
        `SELECT * FROM label_records WHERE ${numeric ? "serial_number" : "id"} = ?`
      )
      .get(numeric ? Number(reference) : reference) as LabelRow | null
    if (!row) throw notFound("label", reference)
    return mapLabel(row)
  }

  list(roastNumber?: number) {
    const rows = roastNumber
      ? (this.database
          .query(
            "SELECT * FROM label_records WHERE roast_serial_number = ? ORDER BY created_at_ms DESC"
          )
          .all(roastNumber) as LabelRow[])
      : (this.database
          .query(
            "SELECT * FROM label_records ORDER BY created_at_ms DESC LIMIT 500"
          )
          .all() as LabelRow[])
    return rows.map(mapLabel)
  }
}

function mapLabel(row: LabelRow) {
  return {
    kind: "label" as const,
    id: row.id,
    serialNumber: row.serial_number,
    roastId: row.roast_id,
    roastNumber: row.roast_serial_number,
    qrPayload: row.qr_payload,
    copies: row.copies,
    artifactSha256: row.artifact_sha256,
    status: row.status,
    createdAt: isoInstant(row.created_at_ms),
  }
}
