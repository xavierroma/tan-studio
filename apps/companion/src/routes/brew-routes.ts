import type { Hono } from "hono"

import type { CompanionEnv } from "../api/env"
import { parseJson, setResourceHeaders } from "../api/http"
import { revisionConflict, validationError } from "../api/problem"
import { brewCreateSchema, preferencesPatchSchema } from "../api/schemas"
import type { BrewRepository } from "../repositories/brew-repository"

export function registerBrewRoutes(
  app: Hono<CompanionEnv>,
  repository: BrewRepository
): void {
  app.get("/api/v1/preferences", (c) => {
    const resource = repository.getPreferences()
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })

  app.patch("/api/v1/preferences", async (c) => {
    const resource = repository.updatePreferences(
      expectedRevision(c.req.header("if-match")),
      await parseJson(c, preferencesPatchSchema)
    )
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })

  app.get("/api/v1/brews", (c) => {
    const raw = c.req.query("roastNumber")
    const parsed = raw === undefined ? undefined : Number(raw)
    if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed < 1)) {
      throw validationError({
        issues: [
          {
            path: ["roastNumber"],
            code: "custom",
            message: "Must be a positive integer",
          },
        ],
      } as never)
    }
    return c.json({ items: repository.list(parsed) })
  })

  app.post("/api/v1/brews", async (c) => {
    const resource = repository.create(await parseJson(c, brewCreateSchema))
    c.header("Location", `/api/v1/brews/${resource.serialNumber}`)
    setResourceHeaders(c, resource.revision)
    return c.json(resource, 201)
  })

  app.get("/api/v1/brews/:reference", (c) => {
    const resource = repository.get(c.req.param("reference"))
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })
}

function expectedRevision(ifMatch: string | undefined): number {
  const match = ifMatch ? /^"revision:(\d+)"$/u.exec(ifMatch) : null
  if (!match?.[1]) throw revisionConflict("a current revision ETag", ifMatch)
  return Number(match[1])
}
