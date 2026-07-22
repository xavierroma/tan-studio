import { expect, test, type Page } from "@playwright/test"

function captureBrowserProblems(page: Page) {
  const problems: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
  return problems
}

test("roast library keeps filters and sorting in the URL", async ({ page }) => {
  const problems = captureBrowserProblems(page)
  await page.goto("/roasts")

  await expect(page).toHaveTitle(/Tan Studio/u)
  await expect(page.getByRole("heading", { name: "Roasts" })).toBeVisible()
  await expect(page.getByRole("table")).toBeVisible()

  const search = page.getByPlaceholder("Roast #, profile, coffee, provider…")
  await search.fill("Washed")
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("Washed")
  await page.reload()
  await expect(search).toHaveValue("Washed")

  await search.fill("")
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false)
  await expect(page.getByText(/^\d+ roasts?$/u)).toBeVisible()
  const roastSort = page
    .getByRole("columnheader")
    .getByRole("button", { name: "Roast" })
  await roastSort.focus()
  await page.keyboard.press("Enter")
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBe("id.asc")

  await page.getByRole("button", { name: "Expanded rows" }).click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("density"))
    .toBe("expanded")
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Expanded rows" })
  ).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("tab", { name: "Pantry" }).click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("view"))
    .toBe("pantry")
  await expect(
    page.getByPlaceholder("Roast #, coffee, profile, tasting note…")
  ).toBeVisible()
  await expect(page.getByLabel("Filter by rest state")).toBeVisible()

  await page.getByRole("link", { name: "Coffees" }).click()
  await expect(page).toHaveURL(/\/coffees(?:\?|$)/u)
  await expect(page.getByRole("heading", { name: "Coffees" })).toBeVisible()
  expect(problems).toEqual([])
})

test("profile and roast pickers show human labels", async ({ page }) => {
  const problems = captureBrowserProblems(page)
  await page.goto("/profiles")

  const profilePicker = page.getByLabel("Inspect profile")
  await expect(profilePicker).toHaveText(/#\d+ · .+/u)
  await profilePicker.click()
  await expect(page.getByRole("option").first()).toHaveText(/#\d+ · .+/u)
  await page.keyboard.press("Escape")

  await page.goto("/roast")
  await expect(
    page.getByRole("heading", { name: "Prepare a roast" })
  ).toBeVisible()
  const roastProfile = page.getByRole("combobox", { name: "Profile" })
  await roastProfile.click()
  await expect(page.getByRole("option").first()).toHaveText(/#\d+ · .+/u)
  expect(problems).toEqual([])
})

test("Tan Bridge setup exposes a selectable Wi-Fi picker", async ({ page }) => {
  const problems = captureBrowserProblems(page)
  await page.addInitScript(() => {
    if (typeof crypto.randomUUID !== "function") {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => "019f0000-0000-7000-8000-000000000001",
      })
    }
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let responseController: ReadableStreamDefaultController<Uint8Array>
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        responseController = controller
      },
    })
    const writable = new WritableStream<Uint8Array>({
      write(bytes) {
        const request = JSON.parse(decoder.decode(bytes)) as {
          requestId: string
          type: string
        }
        const result =
          request.type === "setup.scanWifi"
            ? {
                scanId: "0123456789abcdef",
                networks: [
                  {
                    networkId: "1111111111111111",
                    ssid: "Workshop fallback",
                    authMode: "wpa2-personal",
                    channel: 6,
                    rssi: -70,
                  },
                  {
                    networkId: "2222222222222222",
                    ssid: "hongkong",
                    authMode: "wpa2-personal",
                    channel: 1,
                    rssi: -51,
                  },
                ],
              }
            : {
                protocolVersion: 1,
                bridgeId: "abcdefghijklmnopqrstuvwxyz",
                firmware: {
                  version: "0.2.7-local",
                  build: "local-lan-v8-heap-tunnel",
                },
                lifecycle: "operational",
                wifi: { state: "online" },
                backend: { state: "online", host: "xrc.local", port: 8081 },
                claim: { state: "claimed" },
                diagnostics: {
                  bootCount: 1,
                  brownoutCount: 0,
                  watchdogCount: 0,
                  lastResetReason: "powerOn",
                  previousResetReason: "unknown",
                  interruptWatchdogCount: 0,
                  taskWatchdogCount: 0,
                  otherWatchdogCount: 0,
                  watchdogUsbStage: "boot",
                  watchdogNetworkStage: "notStarted",
                  persisted: true,
                  networkStartDelayMs: 2_500,
                  wifiMaxTxPowerQuarterDbm: 44,
                },
              }
        responseController.enqueue(
          encoder.encode(
            `${JSON.stringify({ schemaVersion: 1, requestId: request.requestId, result })}\n`
          )
        )
      },
    })
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => ({
          readable,
          writable,
          open: async () => undefined,
          close: async () => undefined,
          setSignals: async () => undefined,
        }),
      },
    })
  })
  await page.goto("/devices")

  await expect(
    page.getByRole("heading", { name: "Nano", exact: true })
  ).toBeVisible()
  const anotherBridge = page.getByText("Set up another bridge", { exact: true })
  if (await anotherBridge.isVisible()) await anotherBridge.click()
  await page.getByRole("button", { name: "Connect Atom" }).click()
  await expect(
    page.getByRole("heading", { name: "Atom connected" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Scan Wi-Fi" }).click()
  await expect(page.getByText("2 found")).toBeVisible()

  const networkPicker = page.getByLabel("Network")
  await expect(networkPicker).toContainText("Workshop fallback")
  await networkPicker.click()
  await page.getByRole("option", { name: /hongkong/u }).click()
  await expect(networkPicker).toContainText("hongkong")
  await expect(page.getByLabel("Wi-Fi password")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Connect bridge" })
  ).toBeDisabled()
  expect(problems).toEqual([])
})

test("coffee and brew tables keep their view state in the URL", async ({
  page,
}) => {
  const problems = captureBrowserProblems(page)
  await page.goto("/coffees")
  await expect(page.getByRole("table")).toBeVisible()
  await page.getByRole("button", { name: "Expanded rows" }).click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("density"))
    .toBe("expanded")
  await page
    .getByRole("columnheader")
    .getByRole("button", { name: "Provider" })
    .click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBe("provider.asc")
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Expanded rows" })
  ).toHaveAttribute("aria-pressed", "true")

  await page.goto("/brews")
  await expect(page.getByText("Brew history", { exact: true })).toBeVisible()
  await expect(
    page.getByPlaceholder("Brew #, roast #, method, grinder, note…")
  ).toBeVisible()
  await page.getByRole("button", { name: "Expanded rows" }).click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("density"))
    .toBe("expanded")
  expect(problems).toEqual([])
})

test("mobile roast preparation and data views fit without horizontal overflow", async ({
  page,
}) => {
  const problems = captureBrowserProblems(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/roast")
  await expect(
    page.getByRole("heading", { name: "Prepare a roast" })
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Profile", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Green coffee", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Create roast record" })
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true)

  await page.goto("/roasts")
  await expect(page.getByRole("article").first()).toBeVisible()
  await expect(page.getByRole("table")).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true)
  expect(problems).toEqual([])
})

test("an imported real roast keeps both chart panels visible while inspecting it", async ({
  page,
}) => {
  const problems = captureBrowserProblems(page)
  await page.goto("/roasts/14")
  await expect(page.getByRole("heading", { name: "Roast #14" })).toBeVisible()
  await expect(
    page.getByText("Date unavailable", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("date required", { exact: true })).toBeVisible()

  const chart = page.locator("canvas").first()
  await expect(chart).toBeVisible()
  const bounds = await chart.boundingBox()
  expect(bounds?.height ?? 0).toBeGreaterThan(650)
  await chart.screenshot({ path: "/tmp/tan-studio-roast-14-chart.png" })
  await chart.hover({
    position: {
      x: Math.round((bounds?.width ?? 700) * 0.55),
      y: Math.round((bounds?.height ?? 680) * 0.7),
    },
  })
  await page.waitForTimeout(250)
  await expect(chart).toBeVisible()
  await chart.screenshot({ path: "/tmp/tan-studio-roast-14-chart-hover.png" })

  await expect(page.getByText(/first crack/u).first()).toBeVisible()
  expect(problems).toEqual([])
})
