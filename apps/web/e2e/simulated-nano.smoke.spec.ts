import { expect, test } from "@playwright/test"

test("simulated Nano sync is visible through the production UI", async ({
  page,
}) => {
  await page.goto("/settings?section=devices")

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await expect(page.getByText("connected", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "KN1007B" })).toBeVisible()
  await page.getByText("Device details", { exact: true }).click()
  await expect(page.getByText("7.11.3", { exact: true })).toBeVisible()
  await expect(page.getByText("Profiles").locator("..")).toContainText("2")
  await expect(page.getByText("Logs").locator("..")).toContainText("3")
  await expect(page.getByText("Imported logs").locator("..")).toContainText("3")
  await expect(page.getByText("Imported profiles").locator("..")).toContainText(
    "2"
  )

  await page.getByRole("link", { name: "Roasts" }).click()
  await expect(page).toHaveURL(/\/roasts$/)
  await expect(
    page.getByRole("link", { name: "#3", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "#2", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "#1", exact: true })
  ).toBeVisible()

  await page.getByRole("link", { name: "#3", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Roast #3" })).toBeVisible()
  await expect(page.getByText("Roast curve", { exact: true })).toBeVisible()
  await expect(page.getByText(/3 samples/)).toBeVisible()
  await expect(page.getByText("roast end · 8:41")).toBeVisible()
})
