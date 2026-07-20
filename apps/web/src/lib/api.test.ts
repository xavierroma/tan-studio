import { afterEach, describe, expect, test, vi } from "vitest"

import { listRoasts, updateRoast } from "@/lib/api"

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("generated API client integration", () => {
  test("keeps roast filters in the URL query contract", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ items: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      listRoasts({ q: "washed", status: "completed", profileId: 4 })
    ).resolves.toEqual([])

    const request = fetchMock.mock.calls[0]?.[0] as Request
    const url = new URL(request.url)
    expect(url.pathname).toBe("/api/v1/roasts")
    expect(url.searchParams.get("q")).toBe("washed")
    expect(url.searchParams.get("status")).toBe("completed")
    expect(url.searchParams.get("profileId")).toBe("4")
  })

  test("sends optimistic concurrency from the resource revision", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ id: 15, revision: 4 }))
    vi.stubGlobal("fetch", fetchMock)

    await updateRoast(15, 3, { coffeeId: 2 })

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.method).toBe("PATCH")
    expect(request.headers.get("If-Match")).toBe('"revision:3"')
    await expect(request.clone().json()).resolves.toEqual({ coffeeId: 2 })
  })

  test("propagates API problem details instead of inventing demo data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(
            { title: "Database unavailable", detail: "Read failed" },
            500
          )
        )
    )
    await expect(listRoasts()).rejects.toThrow("Read failed")
  })
})
