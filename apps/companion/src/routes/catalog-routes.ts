import type { Context, Hono } from "hono"
import type { CompanionEnv } from "../api/env"
import { parseJson, setResourceHeaders } from "../api/http"
import { revisionConflict, validationError } from "../api/problem"
import {
  coffeeCreateSchema,
  coffeePatchSchema,
  collectionQuerySchema,
  lotCreateSchema,
  lotPatchSchema,
  providerCreateSchema,
  providerPatchSchema,
} from "../api/schemas"
import type { CatalogRepository } from "../repositories/catalog-repository"
import type { CursorService } from "../services/cursor"

function parseCollectionQuery(c: Context<CompanionEnv>) {
  const result = collectionQuerySchema.safeParse(c.req.query())
  if (!result.success) throw validationError(result.error)
  return result.data
}

function expectedRevision(ifMatch: string | undefined): number {
  if (!ifMatch) throw revisionConflict("a current revision ETag", undefined)
  const match = /^"revision:(\d+)"$/.exec(ifMatch)
  if (!match) {
    throw revisionConflict('an ETag such as "revision:1"', ifMatch)
  }
  return Number(match[1])
}

function page<T>(
  cursors: CursorService,
  scope: string,
  query: {
    first: number
    after?: string | undefined
    search?: string | undefined
    includeArchived: boolean
  },
  load: (offset: number) => { items: T[]; hasNextPage: boolean }
) {
  const identity = {
    first: query.first,
    search: query.search ?? null,
    includeArchived: query.includeArchived,
  }
  const hash = cursors.queryHash(identity)
  const offset = cursors.read(query.after, scope, hash)
  const result = load(offset)
  return {
    items: result.items,
    pageInfo: {
      hasNextPage: result.hasNextPage,
      ...(result.hasNextPage
        ? { endCursor: cursors.issue(scope, hash, offset + query.first) }
        : {}),
    },
  }
}

export function registerCatalogRoutes(
  app: Hono<CompanionEnv>,
  repository: CatalogRepository,
  cursors: CursorService
): void {
  app.get("/api/v1/providers", (c) => {
    const query = parseCollectionQuery(c)
    return c.json(
      page(cursors, "providers", query, (offset) =>
        repository.listProviders({
          first: query.first,
          offset,
          includeArchived: query.includeArchived,
          ...(query.search ? { search: query.search } : {}),
        })
      )
    )
  })

  app.post("/api/v1/providers", async (c) => {
    const resource = repository.createProvider(
      await parseJson(c, providerCreateSchema)
    )
    c.header("Location", `/api/v1/providers/${resource.id}`)
    setResourceHeaders(c, resource.revision)
    return c.json(
      {
        resource,
        affected: [
          { kind: "provider", id: resource.id, revision: resource.revision },
        ],
      },
      201
    )
  })

  app.get("/api/v1/providers/:id", (c) => {
    const resource = repository.getProvider(c.req.param("id"))
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })

  app.patch("/api/v1/providers/:id", async (c) => {
    const resource = repository.updateProvider(
      c.req.param("id"),
      expectedRevision(c.req.header("if-match")),
      await parseJson(c, providerPatchSchema)
    )
    setResourceHeaders(c, resource.revision)
    return c.json({
      resource,
      affected: [
        { kind: "provider", id: resource.id, revision: resource.revision },
      ],
    })
  })

  app.delete("/api/v1/providers/:id", (c) => {
    const resource = repository.archiveProvider(
      c.req.param("id"),
      expectedRevision(c.req.header("if-match"))
    )
    setResourceHeaders(c, resource.revision)
    return c.json({
      resource,
      affected: [
        { kind: "provider", id: resource.id, revision: resource.revision },
      ],
    })
  })

  app.get("/api/v1/coffees", (c) => {
    const query = parseCollectionQuery(c)
    return c.json(
      page(cursors, "coffees", query, (offset) =>
        repository.listCoffees({
          first: query.first,
          offset,
          includeArchived: query.includeArchived,
          ...(query.search ? { search: query.search } : {}),
        })
      )
    )
  })

  app.post("/api/v1/coffees", async (c) => {
    const resource = repository.createCoffee(
      await parseJson(c, coffeeCreateSchema)
    )
    c.header("Location", `/api/v1/coffees/${resource.id}`)
    setResourceHeaders(c, resource.revision)
    return c.json(
      {
        resource,
        affected: [
          { kind: "coffee", id: resource.id, revision: resource.revision },
        ],
      },
      201
    )
  })

  app.get("/api/v1/coffees/:id", (c) => {
    const resource = repository.getCoffee(c.req.param("id"))
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })

  app.patch("/api/v1/coffees/:id", async (c) => {
    const resource = repository.updateCoffee(
      c.req.param("id"),
      expectedRevision(c.req.header("if-match")),
      await parseJson(c, coffeePatchSchema)
    )
    setResourceHeaders(c, resource.revision)
    return c.json({
      resource,
      affected: [
        { kind: "coffee", id: resource.id, revision: resource.revision },
      ],
    })
  })

  app.delete("/api/v1/coffees/:id", (c) => {
    const resource = repository.archiveCoffee(
      c.req.param("id"),
      expectedRevision(c.req.header("if-match"))
    )
    setResourceHeaders(c, resource.revision)
    return c.json({
      resource,
      affected: [
        { kind: "coffee", id: resource.id, revision: resource.revision },
      ],
    })
  })

  app.get("/api/v1/lots", (c) => {
    const query = parseCollectionQuery(c)
    return c.json(
      page(cursors, "lots", query, (offset) =>
        repository.listLots({
          first: query.first,
          offset,
          includeArchived: query.includeArchived,
          ...(query.search ? { search: query.search } : {}),
        })
      )
    )
  })

  app.post("/api/v1/lots", async (c) => {
    const resource = repository.createLot(await parseJson(c, lotCreateSchema))
    c.header("Location", `/api/v1/lots/${resource.id}`)
    setResourceHeaders(c, resource.revision)
    return c.json(
      {
        resource,
        affected: [
          { kind: "lot", id: resource.id, revision: resource.revision },
        ],
      },
      201
    )
  })

  app.get("/api/v1/lots/:id", (c) => {
    const resource = repository.getLot(c.req.param("id"))
    setResourceHeaders(c, resource.revision)
    return c.json(resource)
  })

  app.patch("/api/v1/lots/:id", async (c) => {
    const resource = repository.updateLot(
      c.req.param("id"),
      expectedRevision(c.req.header("if-match")),
      await parseJson(c, lotPatchSchema)
    )
    setResourceHeaders(c, resource.revision)
    return c.json({
      resource,
      affected: [{ kind: "lot", id: resource.id, revision: resource.revision }],
    })
  })
}
