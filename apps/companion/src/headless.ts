import { resolve } from "node:path"

import { createCompanionApp } from "./app"
import { openDatabase } from "./db/database"
import { migrate } from "./db/migrate"
import {
  NanoDeviceManager,
  type DeviceManagerPort,
} from "./device/device-manager"
import { RustSerialTransport } from "./device/rust-serial-transport"
import { createHeadlessHandler } from "./headless-app"
import { KlogImporter } from "./import/klog-importer"

const launchToken = requiredEnvironment("TAN_STUDIO_LAN_TOKEN", 32)
const webRoot = resolve(requiredEnvironment("TAN_STUDIO_WEB_ROOT", 1))
const databasePath = resolve(requiredEnvironment("TAN_STUDIO_DATABASE_PATH", 1))
const allowedHosts = commaList("TAN_STUDIO_ALLOWED_HOSTS")
const allowedOrigins = commaList("TAN_STUDIO_ALLOWED_ORIGINS")
const applicationVersion =
  process.env.TAN_STUDIO_VERSION?.trim() || "development"
const bindHost = process.env.TAN_STUDIO_BIND_HOST?.trim() || "127.0.0.1"
const port = boundedPort(process.env.TAN_STUDIO_PORT ?? "8080")

const database = openDatabase(databasePath)
await migrate(database)

let deviceManager: DeviceManagerPort
try {
  const manager = new NanoDeviceManager(
    new RustSerialTransport(),
    new KlogImporter(database)
  )
  await manager.start()
  deviceManager = manager
} catch {
  deviceManager = failedDeviceManager()
}

const api = createCompanionApp({
  database,
  security: {
    launchToken,
    allowedOrigins,
    allowedHosts,
    allowedClientIds: ["tan-studio-lan-v1", "tan-studio-api-v1"],
    allowOriginlessRequests: true,
  },
  appVersion: applicationVersion,
  deviceManager,
})

const fetch = createHeadlessHandler({
  api,
  webRoot,
  token: launchToken,
  allowedHosts,
  applicationVersion,
  health: () => {
    const integrity = database.query("PRAGMA quick_check").get() as Record<
      string,
      string
    >
    return {
      database: Object.values(integrity)[0] === "ok" ? "ready" : "failed",
      device: deviceManager.snapshot().connection,
    }
  },
})

const server = Bun.serve({ hostname: bindHost, port, fetch })
process.stdout.write(
  `${JSON.stringify({ event: "server_started", host: bindHost, port: server.port, version: applicationVersion })}\n`
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

function requiredEnvironment(name: string, minimumLength: number): string {
  const value = process.env[name]?.trim()
  if (!value || value.length < minimumLength || value.length > 4_096) {
    throw new Error(`${name} is missing or invalid`)
  }
  return value
}

function commaList(name: string): string[] {
  const values = requiredEnvironment(name, 1)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  if (values.length === 0 || values.length > 32) {
    throw new Error(`${name} is missing or invalid`)
  }
  return [...new Set(values)]
}

function boundedPort(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("TAN_STUDIO_PORT is invalid")
  }
  return parsed
}

function failedDeviceManager(): DeviceManagerPort {
  return {
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
