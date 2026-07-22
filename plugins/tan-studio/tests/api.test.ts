import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenApiTanStudioGateway } from "../src/api"
import { TanStudioGatewayError } from "../src/gateway"

const config = {
  baseUrl: "http://tan-studio.test",
  token: "b".repeat(64),
  timeoutMs: 1_000,
}
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("generated OpenAPI transport", () => {
  test("sends the service token only as a bearer header", async () => {
    let captured: Request | undefined
    const api = new OpenApiTanStudioGateway(config, async (request) => {
      captured = new Request(request)
      return Response.json({ items: [] })
    })

    await api.pantry()

    expect(captured?.url).toBe("http://tan-studio.test/api/v1/pantry")
    expect(captured?.headers.get("authorization")).toBe(
      `Bearer ${config.token}`
    )
    expect(captured?.headers.get("x-tan-studio-client")).toBe(
      "tan-studio-api-v1"
    )
    expect(captured?.url).not.toContain(config.token)
  })

  test("preserves stable problem details for agent recovery", async () => {
    const api = new OpenApiTanStudioGateway(config, async () =>
      Response.json(
        {
          type: "https://tan.studio/problems/not-found",
          title: "Roast not found",
          status: 404,
          detail: "Roast 404 does not exist",
          instance: "/api/v1/roasts/404",
          code: "roast.not_found",
          correlationId: "test-correlation",
          retryable: false,
        },
        { status: 404 }
      )
    )

    const error = await api.roast(404).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TanStudioGatewayError)
    expect(error).toMatchObject({
      code: "roast.not_found",
      correlationId: "test-correlation",
      retryable: false,
      status: 404,
    })
  })

  test("allows a full device reconciliation to outlive the normal request timeout", async () => {
    let synchronizationSignal: AbortSignal | null | undefined
    const api = new OpenApiTanStudioGateway(
      { ...config, timeoutMs: 10 },
      async (_request, init) => {
        synchronizationSignal = init?.signal
        await Bun.sleep(25)
        expect(synchronizationSignal?.aborted).toBe(false)
        return Response.json({ connection: "connected" })
      }
    )

    await api.synchronizeDevice()
    expect(synchronizationSignal).toBeDefined()
  })

  test("creates metadata then streams local attachment bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tan-studio-api-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "provider.pdf")
    await Bun.write(filePath, "provider-pdf-content")
    const requests: Request[] = []
    const api = new OpenApiTanStudioGateway(config, async (request) => {
      const captured = new Request(request)
      requests.push(captured.clone())
      if (captured.method === "POST") {
        const body = (await captured.json()) as Record<string, unknown>
        return Response.json({
          id: 7,
          revision: 1,
          createdAt: "2026-07-20T00:00:00Z",
          updatedAt: "2026-07-20T00:00:00Z",
          byteLength: null,
          sha256: null,
          sourceUrl: null,
          description: "",
          capturedAt: null,
          ...body,
        })
      }
      expect(await captured.text()).toBe("provider-pdf-content")
      return Response.json({
        id: 7,
        title: "Provider print sheet",
        filename: "provider.pdf",
        mediaType: "application/pdf",
        byteLength: 20,
        sha256: "a".repeat(64),
        sourceUrl: null,
        description: "",
        capturedAt: null,
        links: [{ resourceType: "coffee", resourceId: 4 }],
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T00:00:00Z",
        revision: 2,
      })
    })

    const result = await api.attachLocalFile({
      filePath,
      title: "Provider print sheet",
      sourceUrl: "https://example.test/coffee",
      links: [{ resourceType: "coffee", resourceId: 4 }],
    })

    expect(result).toMatchObject({ id: 7, revision: 2 })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.url).toEndWith("/api/v1/attachments")
    expect(requests[1]?.url).toEndWith("/api/v1/attachments/7/content")
    expect(requests[1]?.headers.get("content-type")).toBe(
      "application/octet-stream"
    )
    expect(requests[1]?.headers.get("if-match")).toBe('"revision:1"')
  })
})
