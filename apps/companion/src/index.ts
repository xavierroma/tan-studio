import { createCompanionApp } from "./app"
import { openDatabase } from "./db/database"
import { migrate } from "./db/migrate"
import { seedDatabase } from "./db/seed"
import {
  NanoDeviceManager,
  type DeviceManagerPort,
} from "./device/device-manager"
import { RustSerialTransport } from "./device/rust-serial-transport"
import { KlogImporter } from "./import/klog-importer"

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

let deviceManager: DeviceManagerPort
try {
  const manager = new NanoDeviceManager(
    new RustSerialTransport(),
    new KlogImporter(database)
  )
  await manager.start()
  deviceManager = manager
} catch {
  deviceManager = {
    snapshot: () => ({
      state: "failed",
      reason: "serial_bridge_unavailable",
      connection: "disconnected",
      model: null,
      firmware: null,
      protocol: null,
      packetLimitBytes: null,
      busy: null,
      profileCount: null,
      logCount: null,
      syncState: "failed",
      importedLogCount: 0,
      updatedLogCount: 0,
      importWarningCount: 0,
      quarantinedLogCount: 0,
      lastSyncedAt: null,
      readOnly: true,
    }),
    refresh: async () => {},
    synchronize: async () => {},
    stop: async () => {},
  }
}

const app = createCompanionApp({ database, security, deviceManager })
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.TAN_STUDIO_PORT ?? 0),
  fetch: app.fetch,
})
allowedHosts.push(`127.0.0.1:${server.port}`)

process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, host: "127.0.0.1", port: server.port, apiBasePath: "/api/v1" })}\n`
)

let shuttingDown = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    server.stop(true)
    void deviceManager.stop().finally(() => {
      database.close()
      process.exit(0)
    })
  })
}
