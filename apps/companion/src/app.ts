import { Hono } from "hono"
import { QueryRoastLibrary } from "@tan-studio/application"
import type { CompanionDatabase } from "./db/database"
import type { CompanionEnv } from "./api/env"
import { apiErrorHandler, apiNotFoundHandler } from "./api/problem"
import { securityMiddleware, type SecurityOptions } from "./api/security"
import { CatalogRepository } from "./repositories/catalog-repository"
import { RoastRepository } from "./repositories/roast-repository"
import { CursorService } from "./services/cursor"
import { RoastLibraryQueryService } from "./services/roast-library-query"
import { registerCatalogRoutes } from "./routes/catalog-routes"
import { registerRoastRoutes } from "./routes/roast-routes"

export type CompanionAppOptions = {
  database: CompanionDatabase
  security: SecurityOptions
  sessionId?: string
  appVersion?: string
}

export function createCompanionApp(options: CompanionAppOptions) {
  const app = new Hono<CompanionEnv>()
  const sessionId = options.sessionId ?? Bun.randomUUIDv7()
  const cursors = new CursorService(sessionId, options.security.launchToken)
  const catalogRepository = new CatalogRepository(options.database)
  const roastRepository = new RoastRepository(options.database)
  const roastLibraryAdapter = new RoastLibraryQueryService(
    options.database,
    cursors
  )
  const roastLibrary = new QueryRoastLibrary(roastLibraryAdapter)

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
        deviceConnection: false,
        profileEditing: false,
        printing: false,
        aiProposals: false,
        remoteMonitoring: false,
      },
      adapters: {
        database: { state: databaseHealthy ? "ready" : "failed" },
        usb: { state: "unavailable", reason: "not_implemented" },
        printing: { state: "unavailable", reason: "not_implemented" },
      },
    })
  })

  registerCatalogRoutes(app, catalogRepository, cursors)
  registerRoastRoutes(app, roastRepository, roastLibrary)

  app.onError(apiErrorHandler)
  app.notFound(apiNotFoundHandler)
  return app
}
