import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ hosted: false }))
vi.mock("@/lib/companion-client", () => ({
  get usesOperatorSession() {
    return session.hosted
  },
}))

import { CodexPluginSettings } from "./codex-plugin-settings"

afterEach(() => {
  cleanup()
  session.hosted = false
})

describe("Codex plugin settings", () => {
  it("downloads the packaged plugin without any credential in the link", () => {
    render(<CodexPluginSettings />)
    const download = screen.getByRole("link", { name: "Download plugin" })
    expect(download.getAttribute("href")).toBe(
      "/downloads/tan-studio-codex-plugin.zip"
    )
    expect(download.getAttribute("download")).toBe(
      "tan-studio-codex-plugin.zip"
    )
    expect(
      screen.getByText("codex plugin marketplace add /path/to/extracted-folder")
    ).toBeVisible()
  })

  it("sends a local notebook to hosted Settings for the credential", () => {
    render(<CodexPluginSettings />)
    expect(
      screen
        .getByRole("link", { name: "Settings → Agents" })
        .getAttribute("href")
    ).toBe("https://studio.tan.coffee/settings?section=agents")
    expect(screen.queryByRole("link", { name: "Agent connections" })).toBeNull()
  })

  it("points the hosted notebook at Agent connections on the same page", () => {
    session.hosted = true
    render(<CodexPluginSettings />)
    expect(
      screen
        .getByRole("link", { name: "Agent connections" })
        .getAttribute("href")
    ).toBe("#agent-connections")
  })
})
