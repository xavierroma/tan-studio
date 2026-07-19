import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createHeadlessHandler } from "../src/headless-app"

let webRoot: string

beforeAll(async () => {
  webRoot = await mkdtemp(join(tmpdir(), "tan-studio-headless-"))
  await mkdir(join(webRoot, "assets"))
  await writeFile(
    join(webRoot, "index.html"),
    '<!doctype html><html><head><title>Tan Studio</title></head><body><div id="root"></div></body></html>'
  )
  await writeFile(join(webRoot, "assets", "app.js"), "export default 1")
})

afterAll(async () => {
  await rm(webRoot, { recursive: true })
})

describe("headless same-origin handler", () => {
  const token = "a".repeat(43)
  const api = {
    fetch: (request: Request) =>
      Response.json({ forwarded: new URL(request.url).pathname }),
  }

  test("injects an in-memory bootstrap into SPA responses", async () => {
    const handler = createHeadlessHandler({
      api,
      webRoot,
      token,
      allowedHosts: ["tan-studio.local"],
      applicationVersion: "test-version",
      health: () => ({ database: "ready", device: "disconnected" }),
    })
    const response = await handler(
      new Request("http://tan-studio.local/roasts/19")
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    )
    expect(html).toContain("__TAN_STUDIO_BOOTSTRAP__")
    expect(html).toContain(`token:${JSON.stringify(token)}`)
    expect(html).toContain("apiOrigin:window.location.origin")
  })

  test("serves immutable assets and forwards API requests", async () => {
    const handler = createHeadlessHandler({
      api,
      webRoot,
      token,
      allowedHosts: ["tan-studio.local"],
      applicationVersion: "test-version",
      health: () => ({}),
    })
    const asset = await handler(
      new Request("http://tan-studio.local/assets/app.js")
    )
    const apiResponse = await handler(
      new Request("http://tan-studio.local/api/v1/system/bootstrap")
    )

    expect(await asset.text()).toBe("export default 1")
    expect(asset.headers.get("cache-control")).toContain("immutable")
    expect(await apiResponse.json()).toEqual({
      forwarded: "/api/v1/system/bootstrap",
    })
  })

  test("exposes bounded health without accepting hostile hosts", async () => {
    const handler = createHeadlessHandler({
      api,
      webRoot,
      token,
      allowedHosts: ["tan-studio.local"],
      applicationVersion: "test-version",
      health: () => ({ database: "ready", device: "disconnected" }),
    })
    const health = await handler(new Request("http://tan-studio.local/healthz"))
    const hostile = await handler(
      new Request("http://attacker.invalid/healthz")
    )

    expect(await health.json()).toEqual({
      status: "ok",
      applicationVersion: "test-version",
      database: "ready",
      device: "disconnected",
    })
    expect(hostile.status).toBe(403)
  })

  test("does not serve missing assets or encoded path separators", async () => {
    const handler = createHeadlessHandler({
      api,
      webRoot,
      token,
      allowedHosts: ["tan-studio.local"],
      applicationVersion: "test-version",
      health: () => ({}),
    })

    expect(
      (await handler(new Request("http://tan-studio.local/assets/missing.js")))
        .status
    ).toBe(404)
    expect(
      (
        await handler(
          new Request("http://tan-studio.local/assets%5cmissing.js")
        )
      ).status
    ).toBe(404)
  })
})
