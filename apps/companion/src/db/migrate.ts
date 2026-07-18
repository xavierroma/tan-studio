import { CryptoHasher } from "bun"
import initialMigrationSql from "../../migrations/0001_initial.sql" with { type: "text" }
import type { CompanionDatabase } from "./database"
import { openDatabase, withImmediateTransaction } from "./database"

const migrations = [
  {
    version: 1,
    name: "initial",
    sql: initialMigrationSql,
  },
] as const

function sha256(value: string): string {
  return new CryptoHasher("sha256").update(value).digest("hex")
}

export async function migrate(database: CompanionDatabase): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sql_sha256 TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL,
      application_version TEXT NOT NULL
    ) STRICT
  `)

  const readApplied = database.query(
    "SELECT name, sql_sha256 FROM schema_migrations WHERE version = ?"
  )
  const writeApplied = database.query(`
    INSERT INTO schema_migrations(version, name, sql_sha256, applied_at_ms, application_version)
    VALUES (?, ?, ?, ?, ?)
  `)

  for (const migration of migrations) {
    const hash = sha256(migration.sql)
    const applied = readApplied.get(migration.version) as {
      name: string
      sql_sha256: string
    } | null

    if (applied) {
      if (applied.name !== migration.name || applied.sql_sha256 !== hash) {
        throw new Error(`Migration ${migration.version} integrity check failed`)
      }
      continue
    }

    withImmediateTransaction(database, () => {
      database.exec(migration.sql)
      writeApplied.run(
        migration.version,
        migration.name,
        hash,
        Date.now(),
        "0.1.0"
      )
    })
  }
}

if (import.meta.main) {
  const database = openDatabase(
    process.env.TAN_STUDIO_DATABASE_PATH ?? "tan-studio.sqlite"
  )
  await migrate(database)
  database.close()
}
