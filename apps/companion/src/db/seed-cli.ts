import { openDatabase } from "./database"
import { migrate } from "./migrate"
import { seedDatabase } from "./seed"

const database = openDatabase(
  process.env.TAN_STUDIO_DATABASE_PATH ?? "tan-studio.sqlite"
)
await migrate(database)
seedDatabase(database)
database.close()
