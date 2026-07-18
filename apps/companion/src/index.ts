import { createCompanionApp } from "./app"
import { openDatabase } from "./db/database"
import { migrate } from "./db/migrate"
import { seedDatabase } from "./db/seed"

const development = process.env.TAN_STUDIO_DEV === "1"
const launchToken = process.env.TAN_STUDIO_LAUNCH_TOKEN
if (!launchToken && !development) {
  throw new Error("TAN_STUDIO_LAUNCH_TOKEN is required")
}

const database = openDatabase(
  process.env.TAN_STUDIO_DATABASE_PATH ?? "tan-studio.sqlite"
)
await migrate(database)
if (process.env.TAN_STUDIO_SEED_DEMO === "1") seedDatabase(database)

const allowedHosts: string[] = []
const security = {
  launchToken: launchToken ?? "tan-studio-development-only",
  allowedOrigins: [
    process.env.TAN_STUDIO_ALLOWED_ORIGIN ??
      (development ? "http://127.0.0.1:1420" : "tauri://localhost"),
  ],
  allowedHosts,
  development,
}
const app = createCompanionApp({ database, security })
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.TAN_STUDIO_PORT ?? 0),
  fetch: app.fetch,
})
allowedHosts.push(`127.0.0.1:${server.port}`)

process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, host: "127.0.0.1", port: server.port, apiBasePath: "/api/v1" })}\n`
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop(true)
    database.close()
    process.exit(0)
  })
}
