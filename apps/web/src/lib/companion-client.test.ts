import { afterEach, describe, expect, test, vi } from "vitest"

type Bootstrap = NonNullable<Window["__TAN_STUDIO_BOOTSTRAP__"]>

/** The client reads its bootstrap once at import, so each case needs a fresh module. */
async function loadClient(bootstrap: Bootstrap) {
  vi.resetModules()
  window.__TAN_STUDIO_BOOTSTRAP__ = bootstrap
  return import("@/lib/companion-client")
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  delete (window as Partial<Window>).__TAN_STUDIO_BOOTSTRAP__
  vi.unstubAllGlobals()
})

describe("hosted bootstrap", () => {
  test("sends the session cookie instead of a bearer token", async () => {
    const client = await loadClient({
      apiOrigin: "https://studio.tan.coffee",
      token: null,
      clientId: "tan-studio-hosted-v1",
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ items: [] }))
    vi.stubGlobal("fetch", fetchMock)

    expect(client.usesOperatorSession).toBe(true)
    expect(() => client.requireCompanion()).not.toThrow()

    await client.companionClient.GET("/api/v1/profiles")

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get("Authorization")).toBeNull()
    expect(request.headers.get("X-Tan-Studio-Client")).toBe(
      "tan-studio-hosted-v1"
    )
    expect(request.credentials).toBe("same-origin")
  })

  test("reports the operator as signed out on 401 rather than throwing", async () => {
    const client = await loadClient({
      apiOrigin: "https://studio.tan.coffee",
      token: null,
      clientId: "tan-studio-hosted-v1",
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ code: "unauthenticated" }, 401))
    )

    await expect(client.fetchOperatorSignedIn()).resolves.toBe(false)
  })

  test("reports the operator as signed in when the notebook answers", async () => {
    const client = await loadClient({
      apiOrigin: "https://studio.tan.coffee",
      token: null,
      clientId: "tan-studio-hosted-v1",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response({ apiVersion: "v1" }))
    )

    await expect(client.fetchOperatorSignedIn()).resolves.toBe(true)
  })
})

describe("LAN bootstrap", () => {
  test("keeps the launch token bearer path intact", async () => {
    const client = await loadClient({
      apiOrigin: "http://tan-studio.local",
      token: "a".repeat(64),
      clientId: "tan-studio-lan-v1",
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ items: [] }))
    vi.stubGlobal("fetch", fetchMock)

    expect(client.usesOperatorSession).toBe(false)

    await client.companionClient.GET("/api/v1/profiles")

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.headers.get("Authorization")).toBe(
      `Bearer ${"a".repeat(64)}`
    )
    expect(request.headers.get("X-Tan-Studio-Client")).toBe("tan-studio-lan-v1")
  })
})
