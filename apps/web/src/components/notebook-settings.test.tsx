import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  updateSettings: vi.fn(async () => ({})),
  updateUiPreferences: vi.fn(async () => {
    throw new Error("Preferences could not be saved")
  }),
}))
vi.mock("@/lib/api", () => ({
  queryKeys: {
    settings: () => ["settings"],
    uiPreferences: () => ["ui-preferences"],
  },
  getSettings: async () => ({
    defaultLabelWidthMicrometers: 50_000,
    defaultLabelHeightMicrometers: 30_000,
    greenDustThresholdMg: 30_000,
    revision: 4,
  }),
  getUiPreferences: async () => ({
    defaultTableDensity: "compact",
    revision: 2,
  }),
  updateSettings: api.updateSettings,
  updateUiPreferences: api.updateUiPreferences,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { NotebookSettings } from "./notebook-settings"

afterEach(cleanup)

it("refreshes coffee classification even when the preferences save fails", async () => {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, "invalidateQueries")
  render(
    <QueryClientProvider client={client}>
      <NotebookSettings />
    </QueryClientProvider>
  )
  const dust = await screen.findByLabelText("Green dust below · g")
  fireEvent.change(dust, { target: { value: "45" } })
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))

  await waitFor(() => expect(api.updateUiPreferences).toHaveBeenCalled())
  expect(api.updateSettings).toHaveBeenCalledWith(
    4,
    expect.objectContaining({ greenDustThresholdMg: 45_000 })
  )
  await waitFor(() => {
    const keys = invalidate.mock.calls.map(
      ([filters]) => filters?.queryKey?.[0]
    )
    expect(keys).toEqual(
      expect.arrayContaining(["coffees", "coffee", "roast-context"])
    )
  })
})
