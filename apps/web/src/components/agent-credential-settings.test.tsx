import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, expect, test, vi } from "vitest"
import { AgentCredentialSettings } from "./agent-credential-settings"
import { listAgentCredentials, mintAgentCredential } from "@/lib/api"

vi.mock("@/lib/companion-client", () => ({ usesOperatorSession: true }))
vi.mock("@/lib/api", () => ({
  listAgentCredentials: vi.fn(),
  mintAgentCredential: vi.fn(),
  revokeAgentCredential: vi.fn(),
}))
beforeEach(() => vi.clearAllMocks())
function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AgentCredentialSettings />
    </QueryClientProvider>
  )
}
test("disabled deployment never offers credential creation", async () => {
  vi.mocked(listAgentCredentials).mockResolvedValue({
    enabled: false,
    endpoint: "https://studio.tan.coffee/mcp",
    items: [],
  })
  renderSettings()
  expect(await screen.findByText(/not enabled/)).toBeVisible()
  expect(
    screen.queryByRole("button", { name: "Create agent credential" })
  ).toBeNull()
  expect(mintAgentCredential).not.toHaveBeenCalled()
})
test("creation requires explicit submission, defaults to read only, and dismisses the one-time secret", async () => {
  vi.mocked(listAgentCredentials).mockResolvedValue({
    enabled: true,
    endpoint: "https://studio.tan.coffee/mcp",
    items: [],
  })
  vi.mocked(mintAgentCredential).mockResolvedValue({
    secret: "fixture-one-time-secret",
    credential: {
      id: 1,
      label: "Fixture",
      write: false,
      audience: "https://studio.tan.coffee/mcp",
      createdAtMs: 1,
      expiresAtMs: Date.now() + 60000,
      lastUsedAtMs: null,
      revokedAtMs: null,
      version: 1,
    },
  })
  renderSettings()
  const create = await screen.findByRole("button", {
    name: "Create agent credential",
  })
  expect(mintAgentCredential).not.toHaveBeenCalled()
  expect(screen.getByLabelText("Access")).toHaveValue("read")
  fireEvent.change(screen.getByLabelText("Agent name"), {
    target: { value: "Fixture" },
  })
  fireEvent.click(create)
  await waitFor(() =>
    expect(mintAgentCredential).toHaveBeenCalledWith(
      { label: "Fixture", write: false, expiresInDays: 30 },
      expect.anything()
    )
  )
  expect(await screen.findByText("fixture-one-time-secret")).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Done" }))
  expect(screen.queryByText("fixture-one-time-secret")).toBeNull()
})
