import { StrictMode, type ReactNode } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { EntityImage } from "./entity-image"
vi.mock("@/lib/api", () => ({
  getAttachmentContent: vi.fn(
    async () => new Blob(["fixture image"], { type: "image/png" })
  ),
}))
vi.mock("@tan-studio/ui/components/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
  AvatarFallback: () => null,
}))
afterEach(() => vi.unstubAllGlobals())
it("keeps a valid object URL through Strict Mode effect replay and releases it on unmount", async () => {
  let index = 0
  const revoked = new Set<string>()
  const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:fixture-${++index}`),
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.add(url)
    })
  const view = render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <EntityImage attachmentId={1} entityType="coffee" alt="Coffee photo" />
      </QueryClientProvider>
    </StrictMode>
  )
  const img = await screen.findByRole("img", { name: "Coffee photo" })
  await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:fixture-/))
  const current = img.getAttribute("src")!
  expect(revoked.has(current)).toBe(false)
  view.unmount()
  expect(revoked.has(current)).toBe(true)
  create.mockRestore()
  revoke.mockRestore()
})
