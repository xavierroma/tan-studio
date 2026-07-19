import { openDatabase } from "../../src/db/database"
import { migrate } from "../../src/db/migrate"

const databasePath = Bun.argv[2]
if (!databasePath) throw new Error("Expected a database path argument")

const database = openDatabase(databasePath)
await migrate(database)
const migration = database
  .query(
    "SELECT version, name, sql_sha256 AS sqlSha256 FROM schema_migrations WHERE version = 3"
  )
  .get()
database.close()

process.stdout.write(JSON.stringify(migration))
