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
  await expect(
    page.getByText(/roasts · sorted and filtered state/u)
  ).toBeVisible()

  const search = page.getByPlaceholder("Roast #, profile, coffee, provider…")
  await search.fill("Washed")
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("Washed")
  await page.reload()
  await expect(search).toHaveValue("Washed")

  await search.fill("")
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false)
  await expect(
    page.getByText(/roasts · sorted and filtered state/u)
  ).toBeVisible()
  const roastSort = page
    .getByRole("columnheader")
    .getByRole("button", { name: "Roast" })
  await roastSort.focus()
  await page.keyboard.press("Enter")
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBe("id.asc")

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
                firmware: { version: "0.2.2-local", build: "local-lan-v3" },
                lifecycle: "operational",
                wifi: { state: "online" },
                backend: { state: "online", host: "xrc.local", port: 8081 },
                claim: { state: "claimed" },
                diagnostics: {
                  bootCount: 1,
                  brownoutCount: 0,
                  watchdogCount: 0,
                  lastResetReason: "powerOn",
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

  await expect(page.getByRole("heading", { name: "Nano" })).toBeVisible()
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
