import type { Hono } from "hono"

import type { CompanionEnv } from "../api/env"
import { parseJson } from "../api/http"
import { labelCreateSchema } from "../api/schemas"
import type { LabelRepository } from "../repositories/label-repository"

export function registerLabelRoutes(
  app: Hono<CompanionEnv>,
  repository: LabelRepository
): void {
  app.get("/api/v1/labels", (c) => {
    const raw = c.req.query("roastNumber")
    const roastNumber =
      raw && /^[1-9][0-9]{0,8}$/u.test(raw) ? Number(raw) : undefined
    return c.json({ items: repository.list(roastNumber) })
  })

  app.post("/api/v1/labels", async (c) => {
    const resource = repository.create(await parseJson(c, labelCreateSchema))
    c.header("Location", `/api/v1/labels/${resource.serialNumber}`)
    return c.json(resource, 201)
  })

  app.get("/api/v1/labels/:reference", (c) =>
    c.json(repository.get(c.req.param("reference")))
  )
}
