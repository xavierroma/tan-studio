import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

type Bootstrap = NonNullable<Window["__TAN_STUDIO_BOOTSTRAP__"]>

const HOSTED_BOOTSTRAP: Bootstrap = {
  apiOrigin: "https://studio.tan.coffee",
  token: null,
  clientId: "tan-studio-hosted-v1",
}

/** The client reads its bootstrap once at import, so each case needs a fresh module. */
async function renderControls(bootstrap?: Bootstrap) {
  vi.resetModules()
  if (bootstrap) window.__TAN_STUDIO_BOOTSTRAP__ = bootstrap
  const { SessionControls } = await import("@/components/session-controls")
  render(<SessionControls />)
}

function response(status: number) {
  return new Response(JSON.stringify({ apiVersion: "v1" }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  delete (window as Partial<Window>).__TAN_STUDIO_BOOTSTRAP__
  vi.unstubAllGlobals()
})

describe("SessionControls", () => {
  test("offers Sign in with Google when the operator is not signed in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response(401))
    )

    await renderControls(HOSTED_BOOTSTRAP)

    const signIn = await screen.findByRole("link", {
      name: "Sign in with Google",
    })
    expect(signIn).toHaveAttribute("href", "/auth/google")
    expect(screen.getByText("Signed out")).toBeVisible()
  })

  test("signs out with a POST so no other site can force it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response(200))
    )

    await renderControls(HOSTED_BOOTSTRAP)

    const signOut = await screen.findByRole("button", { name: "Sign out" })
    const form = signOut.closest("form")
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/auth/logout")
    expect(screen.getByText("Signed in")).toBeVisible()
  })

  test("still offers Sign in with Google when the probe fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))
    )

    await renderControls(HOSTED_BOOTSTRAP)

    expect(
      await screen.findByRole("link", { name: "Sign in with Google" })
    ).toBeVisible()
  })

  test("shows the local notebook badge and never probes without a hosted bootstrap", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)

    await renderControls()

    expect(screen.getByText("Local")).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
