import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Roast } from "@/lib/api"
import { getRoast, listCoffees, listProfiles, updateRoast } from "@/lib/api"
import { RoastEditorScreen } from "./roast-editor-screen"

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ roastId: "29" }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getRoast: vi.fn(),
  listCoffees: vi.fn(),
  listProfiles: vi.fn(),
  updateRoast: vi.fn(),
}))

const roast: Roast = {
  id: 29,
  revision: 2,
  status: "completed",
  result: "success",
  endReason: "0:level",
  createdAt: "2026-10-17T18:00:00Z",
  updatedAt: "2026-10-17T18:00:00Z",
  roastedAt: "2026-10-17T18:00:00Z",
  roastedAtSource: "device",
  sourceTimezone: "UTC",
  profile: null,
  coffee: null,
  greenInputMassMg: 123000,
  roastedYieldMassMg: 107000,
  levelThousandths: 800,
  developmentBasisPoints: 2364,
  durationMs: 442652,
  cooldownEndMs: 673891,
  endTemperatureMilliC: 207123,
  events: [
    {
      id: "user-first-crack",
      kind: "first_crack",
      source: "user",
      elapsedMs: 338000,
      temperatureMilliC: null,
    },
  ],
  adjustments: {},
  roasterParameters: {},
  nativeMetadata: {},
  profileSnapshot: {},
  importWarnings: [],
  brewCount: 0,
  noteCount: 1,
  labelCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRoast).mockResolvedValue(roast)
  vi.mocked(listCoffees).mockResolvedValue([])
  vi.mocked(listProfiles).mockResolvedValue([])
  vi.mocked(updateRoast).mockResolvedValue(roast)
})
afterEach(cleanup)

async function editor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RoastEditorScreen />
    </QueryClientProvider>
  )
  await screen.findByLabelText("Development · %")
  return document.querySelector<HTMLFormElement>("#roast-editor-form")!
}

test("imported hundredth-percent and millidegree values pass form validation", async () => {
  const form = await editor()
  expect(form.checkValidity()).toBe(true)
})

test("saving one decimal-comma measurement preserves all unchanged imported values", async () => {
  const form = await editor()
  fireEvent.change(screen.getByLabelText("Roasted yield · g"), {
    target: { value: "106,5" },
  })
  expect(form.checkValidity()).toBe(true)
  fireEvent.submit(form)
  await waitFor(() =>
    expect(updateRoast).toHaveBeenCalledWith(29, 2, {
      roastedYieldMassMg: 106500,
    })
  )
})

test("saving an unrelated field preserves subsecond roast and cooling times", async () => {
  const form = await editor()
  fireEvent.change(screen.getByLabelText("End reason"), {
    target: { value: "manual" },
  })
  fireEvent.submit(form)
  await waitFor(() =>
    expect(updateRoast).toHaveBeenCalledWith(29, 2, { endReason: "manual" })
  )
})

test("yield validation uses the edited green load", async () => {
  const form = await editor()
  fireEvent.change(screen.getByLabelText("Green load · g"), {
    target: { value: "150" },
  })
  fireEvent.change(screen.getByLabelText("Roasted yield · g"), {
    target: { value: "130,25" },
  })
  expect(form.checkValidity()).toBe(true)
  fireEvent.submit(form)
  await waitFor(() =>
    expect(updateRoast).toHaveBeenCalledWith(29, 2, {
      greenInputMassMg: 150000,
      roastedYieldMassMg: 130250,
    })
  )
})

test("mobile inputs offer a decimal key for measurements and a colon for elapsed times", async () => {
  await editor()
  for (const label of [
    "Development · %",
    "Green load · g",
    "Level",
    "Temperature · °C",
    "End temperature · °C",
  ])
    expect(screen.getByLabelText(label)).toHaveAttribute("inputmode", "decimal")
  for (const label of [
    "First crack · m:ss",
    "Roast duration · m:ss",
    "Cooling duration · m:ss",
  ])
    expect(screen.getByLabelText(label)).toHaveAttribute("inputmode", "text")
})

test.each(["abc", "12,3,4", "-1", "124"])(
  "invalid yield %s blocks saving",
  async (value) => {
    const form = await editor()
    fireEvent.change(screen.getByLabelText("Roasted yield · g"), {
      target: { value },
    })
    expect(form.checkValidity()).toBe(false)
    fireEvent.submit(form)
    expect(updateRoast).not.toHaveBeenCalled()
  }
)
