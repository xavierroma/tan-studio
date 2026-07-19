import type { Hono } from "hono"
import {
  RoastLibraryQuerySchema,
  RoastLibraryResultSchema,
} from "@tan-studio/api-contract"
import type { QueryRoastLibrary } from "@tan-studio/application"
import type { CompanionEnv } from "../api/env"
import { parseJson, setResourceHeaders } from "../api/http"
import { revisionConflict, validationError } from "../api/problem"
import {
  roastCoffeePatchSchema,
  roastLibraryQuerySchema,
  seriesQuerySchema,
} from "../api/schemas"
import type { RoastRepository } from "../repositories/roast-repository"

export function registerRoastRoutes(
  app: Hono<CompanionEnv>,
  repository: RoastRepository,
  library: QueryRoastLibrary
): void {
  app.post("/api/v1/roast-library/query", async (c) => {
    const query = await parseJson(c, roastLibraryQuerySchema)
    const contractQuery = RoastLibraryQuerySchema.safeParse(query)
    if (!contractQuery.success) throw validationError(contractQuery.error)
    const result = await library.execute(contractQuery.data)
    return c.json(RoastLibraryResultSchema.parse(result))
  })

  app.get("/api/v1/roasts/:id", (c) => {
    const resource = repository.getDetail(c.req.param("id"))
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })

  app.patch("/api/v1/roasts/:id/coffee", async (c) => {
    const ifMatch = c.req.header("if-match")
    const match = ifMatch ? /^"revision:(\d+)"$/.exec(ifMatch) : null
    if (!match) {
      throw revisionConflict('an ETag such as "revision:1"', ifMatch)
    }
    const input = await parseJson(c, roastCoffeePatchSchema)
    const resource = repository.assignCoffee(
      c.req.param("id"),
      Number(match[1]),
      input.coffeeNumber
    )
    setResourceHeaders(c, resource.revision)
    return c.json({ resource })
  })

  app.get("/api/v1/roasts/:id/series", (c) => {
    const result = seriesQuerySchema.safeParse(c.req.query())
    if (!result.success) throw validationError(result.error)
    return c.json(
      repository.getSeries(c.req.param("id"), {
        streamVersion: result.data.streamVersion,
        fromElapsedMs: result.data.fromElapsedMs,
        toElapsedMs: result.data.toElapsedMs,
        maxPoints: result.data.maxPoints,
        ...(result.data.throughSampleSeq === undefined
          ? {}
          : { throughSampleSeq: result.data.throughSampleSeq }),
        ...(result.data.channels === undefined
          ? {}
          : { channels: result.data.channels }),
      })
    )
  })
}
