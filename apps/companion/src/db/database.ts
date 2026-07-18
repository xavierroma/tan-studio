import { Database } from "bun:sqlite"

export type CompanionDatabase = Database

export function openDatabase(filename: string): CompanionDatabase {
  const database = new Database(filename, { create: true, strict: true })

  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA busy_timeout = 5000")
  database.exec("PRAGMA synchronous = NORMAL")
  database.exec("PRAGMA temp_store = MEMORY")
  database.exec("PRAGMA trusted_schema = OFF")

  if (filename !== ":memory:") {
    const mode = database.query("PRAGMA journal_mode = WAL").get() as Record<
      string,
      string
    > | null
    if (!mode || Object.values(mode)[0]?.toLowerCase() !== "wal") {
      database.close()
      throw new Error("SQLite WAL mode is required")
    }
  }

  return database
}

export function withImmediateTransaction<T>(
  database: CompanionDatabase,
  operation: () => T
): T {
  database.exec("BEGIN IMMEDIATE")
  try {
    const result = operation()
    database.exec("COMMIT")
    return result
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}
