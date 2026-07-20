import { describe, expect, test } from "bun:test"

import { OpenApiTanStudioGateway } from "../src/api"
import { TanStudioGatewayError } from "../src/gateway"

const config = {
  baseUrl: "http://tan-studio.test",
  token: "b".repeat(64),
  timeoutMs: 1_000,
}

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
})
