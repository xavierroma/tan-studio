import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PageHeader } from "@/components/page-header"

describe("PageHeader", () => {
  it("exposes the page title and supporting context", () => {
    render(
      <PageHeader
        eyebrow="Coffee lot"
        title="Ethiopia Hamasho"
        description="Every roast and tasting stays connected."
        actions={<button type="button">Plan next roast</button>}
      />
    )

    expect(
      screen.getByRole("heading", { name: "Ethiopia Hamasho" })
    ).toBeVisible()
    expect(
      screen.getByText("Every roast and tasting stays connected.")
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Plan next roast" })
    ).toBeEnabled()
  })
})
