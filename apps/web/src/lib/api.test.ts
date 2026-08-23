import { afterEach, describe, expect, test, vi } from "vitest"

import {
  getBrew,
  getCoffee,
  getUiPreferences,
  listRoasts,
  setEntityProfileImage,
  updateRoast,
  updateBrew,
  updateUiPreferences,
} from "@/lib/api"

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
      listRoasts({
        q: "washed",
        status: "completed",
        profileId: 4,
        archived: true,
      })
    ).resolves.toEqual([])

    const request = fetchMock.mock.calls[0]?.[0] as Request
    const url = new URL(request.url)
    expect(url.pathname).toBe("/api/v1/roasts")
    expect(url.searchParams.get("q")).toBe("washed")
    expect(url.searchParams.get("status")).toBe("completed")
    expect(url.searchParams.get("profileId")).toBe("4")
    expect(url.searchParams.get("archived")).toBe("true")
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

  test("loads a single coffee through the generated path contract", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ id: 12, name: "Buku Abel" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getCoffee(12)).resolves.toMatchObject({
      id: 12,
      name: "Buku Abel",
    })

    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(new URL(request.url).pathname).toBe("/api/v1/coffees/12")
  })

  test("loads and revision-updates a brew through the generated contract", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: 8, roastId: 14, revision: 2 }))
      .mockResolvedValueOnce(
        response({ id: 8, roastId: 14, method: "V60 pulse", revision: 3 })
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getBrew(8)).resolves.toMatchObject({ id: 8, roastId: 14 })
    await updateBrew(8, 2, {
      method: "V60 pulse",
      coffeeMassMg: 15_500,
      brewedAt: "2026-07-24T15:15:00Z",
    })

    const getRequest = fetchMock.mock.calls[0]?.[0] as Request
    expect(new URL(getRequest.url).pathname).toBe("/api/v1/brews/8")
    const patchRequest = fetchMock.mock.calls[1]?.[0] as Request
    expect(patchRequest.method).toBe("PATCH")
    expect(patchRequest.headers.get("If-Match")).toBe('"revision:2"')
    await expect(patchRequest.clone().json()).resolves.toEqual({
      method: "V60 pulse",
      coffeeMassMg: 15_500,
      brewedAt: "2026-07-24T15:15:00Z",
    })
  })

  test("uses the generated preference and profile-image contracts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          defaultTableDensity: "expanded",
          tablePreferences: {},
          revision: 2,
        })
      )
      .mockResolvedValueOnce(
        response({
          defaultTableDensity: "expanded",
          tablePreferences: { coffees: { hidden: ["harvest"] } },
          revision: 3,
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    const preferences = await getUiPreferences()
    await updateUiPreferences(preferences.revision, {
      tablePreferences: { coffees: { hidden: ["harvest"] } },
    })
    await setEntityProfileImage("coffee", 7, 11)

    const patch = fetchMock.mock.calls[1]?.[0] as Request
    expect(patch.headers.get("If-Match")).toBe('"revision:2"')
    const image = fetchMock.mock.calls[2]?.[0] as Request
    expect(new URL(image.url).pathname).toBe(
      "/api/v1/entity-profile-images/coffee/7"
    )
    await expect(image.clone().json()).resolves.toEqual({ attachmentId: 11 })
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
