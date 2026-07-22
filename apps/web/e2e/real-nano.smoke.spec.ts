import { expect, test } from "@playwright/test"

test.skip(
  process.env.TAN_STUDIO_REAL_NANO !== "1",
  "requires the opt-in physical Nano and Tan Bridge fixture"
)

test("real Nano bridge sync is visible through the production LAN UI", async ({
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  await page.goto("/devices")
  await expect(page).toHaveTitle(/Tan Studio/i)
  await expect(page.getByRole("heading", { name: "Nano" })).toBeVisible()
  await expect(page.getByText("Nano connected", { exact: true })).toBeVisible()
  await expect(page.getByText("KN1007B", { exact: true })).toBeVisible()
  await expect(page.getByText("7.20.6", { exact: true })).toBeVisible()
  await expect(page.getByText("Profiles on Nano").locator("..")).toContainText(
    "16"
  )
  await expect(page.getByText("Logs on Nano").locator("..")).toContainText("15")
  await expect(
    page.getByText("Last synchronization").locator("..")
  ).toContainText("ready")

  await page.getByRole("link", { name: "Roasts" }).click()
  await expect(page).toHaveURL(/\/roasts(?:\?.*)?$/)
  await expect(page.getByRole("table")).toBeVisible()
  const firstRoast = page.getByRole("link", { name: /^#\d+$/ }).first()
  const roastReference = await firstRoast.textContent()
  expect(roastReference).toMatch(/^#\d+$/)
  await firstRoast.click()

  await expect(
    page.getByRole("heading", { name: `Roast ${roastReference}` })
  ).toBeVisible()
  await expect(page.getByText("Roast curve", { exact: true })).toBeVisible()
  const sampleBadge = page.getByText(/^\d[\d,]* samples$/)
  await expect(sampleBadge).toBeVisible()
  expect(
    Number((await sampleBadge.textContent())?.replace(/\D/g, ""))
  ).toBeGreaterThan(0)

  const chart = page.locator("canvas").first()
  await expect(chart).toBeVisible()
  const bounds = await chart.boundingBox()
  expect(bounds?.width ?? 0).toBeGreaterThan(500)
  expect(bounds?.height ?? 0).toBeGreaterThan(300)
  await page.screenshot({
    path: "/tmp/tan-studio-real-nano-roast.png",
    fullPage: false,
  })
  await chart.hover({ position: { x: 300, y: 180 } })
  await page.waitForTimeout(250)
  await expect(chart).toBeVisible()
  await page.screenshot({
    path: "/tmp/tan-studio-real-nano-roast-hover.png",
    fullPage: false,
  })

  expect(runtimeErrors).toEqual([])
})
