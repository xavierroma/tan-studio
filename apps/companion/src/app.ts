import { Hono } from "hono"
import { QueryRoastLibrary } from "@tan-studio/application"
import type { CompanionDatabase } from "./db/database"
import type { CompanionEnv } from "./api/env"
import { ApiError, apiErrorHandler, apiNotFoundHandler } from "./api/problem"
import { securityMiddleware, type SecurityOptions } from "./api/security"
import { CatalogRepository } from "./repositories/catalog-repository"
import { BrewRepository } from "./repositories/brew-repository"
import { RoastRepository } from "./repositories/roast-repository"
import { LabelRepository } from "./repositories/label-repository"
import { CursorService } from "./services/cursor"
import { RoastLibraryQueryService } from "./services/roast-library-query"
import { registerCatalogRoutes } from "./routes/catalog-routes"
import { registerBrewRoutes } from "./routes/brew-routes"
import { registerRoastRoutes } from "./routes/roast-routes"
import { registerLabelRoutes } from "./routes/label-routes"
import type { DeviceManagerPort } from "./device/device-manager"

export type CompanionAppOptions = {
  database: CompanionDatabase
  security: SecurityOptions
  sessionId?: string
  appVersion?: string
  deviceManager?: DeviceManagerPort
}

export function createCompanionApp(options: CompanionAppOptions) {
  const app = new Hono<CompanionEnv>()
  const sessionId = options.sessionId ?? Bun.randomUUIDv7()
  const cursors = new CursorService(sessionId, options.security.launchToken)
  const catalogRepository = new CatalogRepository(options.database)
  const brewRepository = new BrewRepository(options.database)
  const roastRepository = new RoastRepository(options.database)
  const labelRepository = new LabelRepository(options.database)
  const roastLibraryAdapter = new RoastLibraryQueryService(
    options.database,
    cursors
  )
  const roastLibrary = new QueryRoastLibrary(roastLibraryAdapter)
  const deviceSnapshot = () =>
    options.deviceManager?.snapshot() ?? {
      state: "unavailable" as const,
      reason: "not_implemented",
      connection: "disconnected" as const,
      model: null,
      firmware: null,
      protocol: null,
      packetLimitBytes: null,
      busy: null,
      profileCount: null,
      logCount: null,
      syncState: "idle" as const,
      importedLogCount: 0,
      updatedLogCount: 0,
      importWarningCount: 0,
      quarantinedLogCount: 0,
      lastSyncedAt: null,
      readOnly: true as const,
    }

  app.use("*", async (c, next) => {
    const supplied = c.req.header("x-correlation-id")
    const correlationId =
      supplied &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        supplied
      )
        ? supplied
        : Bun.randomUUIDv7()
    c.set("correlationId", correlationId)
    c.header("X-Correlation-Id", correlationId)
    c.header("Cache-Control", "no-store")
    c.header("X-Content-Type-Options", "nosniff")
    await next()
  })

  app.use("/api/v1/*", securityMiddleware(options.security))
  app.options("/api/v1/*", (c) => c.body(null, 204))

  app.get("/api/v1/system/bootstrap", (c) => {
    const metadata = options.database
      .query(
        "SELECT schema_version, projection_version FROM app_metadata WHERE id = 1"
      )
      .get() as { schema_version: number; projection_version: number }
    const integrity = options.database
      .query("PRAGMA quick_check")
      .get() as Record<string, string>
    const databaseHealthy = Object.values(integrity)[0] === "ok"
    const usb = deviceSnapshot()

    return c.json({
      apiVersion: "v1",
      applicationVersion: options.appVersion ?? "0.1.0",
      schemaVersion: metadata.schema_version,
      projectionVersion: metadata.projection_version,
      sessionId,
      serverTime: new Date().toISOString(),
      recoveryState: "ready",
      userUnits: { temperature: "celsius", mass: "grams" },
      features: {
        catalog: true,
        roastLibrary: true,
        roastDetail: true,
        seriesJson: true,
        deviceConnection: options.deviceManager !== undefined,
        profileEditing: false,
        printing: false,
        aiProposals: false,
        remoteMonitoring: false,
      },
      adapters: {
        database: { state: databaseHealthy ? "ready" : "failed" },
        usb,
        printing: { state: "unavailable", reason: "not_implemented" },
      },
    })
  })

  app.get("/api/v1/device", (c) => c.json(deviceSnapshot()))

  app.post("/api/v1/device/refresh", async (c) => {
    if (!options.deviceManager) {
      return c.json(
        {
          type: "about:blank",
          title: "Device adapter unavailable",
          status: 501,
          detail: "The USB device adapter is not installed.",
          code: "device_adapter_unavailable",
          correlationId: c.get("correlationId"),
          retryable: false,
        },
        501
      )
    }
    await options.deviceManager.refresh()
    return c.json(options.deviceManager.snapshot())
  })

  app.post("/api/v1/device/synchronize", async (c) => {
    if (!options.deviceManager) {
      return c.json(
        {
          type: "about:blank",
          title: "Device adapter unavailable",
          status: 501,
          detail: "The USB device adapter is not installed.",
          code: "device_adapter_unavailable",
          correlationId: c.get("correlationId"),
          retryable: false,
        },
        501
      )
    }
    try {
      await options.deviceManager.synchronize()
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "device_busy" ||
          error.message === "sassi_outcome_103")
      ) {
        throw new ApiError({
          status: 423,
          code: "device_busy",
          title: "Roaster filesystem busy",
          detail:
            "The Nano is connected but has temporarily locked its filesystem. Synchronization will resume when it reports not busy.",
          retryable: true,
        })
      }
      throw error
    }
    return c.json(options.deviceManager.snapshot())
  })

  registerCatalogRoutes(app, catalogRepository, cursors)
  registerBrewRoutes(app, brewRepository)
  registerLabelRoutes(app, labelRepository)
  registerRoastRoutes(app, roastRepository, roastLibrary)

  app.onError(apiErrorHandler)
  app.notFound(apiNotFoundHandler)
  return app
}
