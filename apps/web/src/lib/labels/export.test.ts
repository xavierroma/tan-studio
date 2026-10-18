import { describe, expect, it } from "vitest"
import { buildLabel, LABEL_RED, type LabelCopy } from "./artwork"
import { proColorPlanes } from "./export"

const source: LabelCopy = {
  roastId: 128,
  coffee: "Fictional Ridge Lot",
  country: "Ethiopia",
  region: "Example Highlands",
  altitude: "1,900–2,150 m",
  variety: "Heirloom",
  process: "Washed",
  profile: "Fictional washed",
  level: "2.4",
  tasting: "Stone fruit, tea-like",
  grams: "85.6",
  date: "12 Oct 2026",
}

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, "image/svg+xml").documentElement

describe("B21 Pro print planes", () => {
  it("keeps black copy off the red plane and red marks off the black plane", () => {
    const planes = proColorPlanes(buildLabel(source).svg)
    const red = parse(planes.red),
      black = parse(planes.black)
    // Red plane: only the roast number and the logo's red layer, drawn black.
    expect(red.querySelector("#roast-number")).not.toBeNull()
    expect(red.querySelector('[data-ink="red"]')).not.toBeNull()
    for (const field of ["coffee", "origin", "process", "date", "total"])
      expect(red.querySelector(`#${field}`)).toBeNull()
    expect(red.querySelector('[data-ink="black"]')).toBeNull()
    expect(planes.red).not.toContain(LABEL_RED)
    // Black plane: everything else, nothing red.
    expect(black.querySelector("#coffee")).not.toBeNull()
    expect(black.querySelector("#roast-number")).toBeNull()
    expect(black.querySelector('[data-ink="red"]')).toBeNull()
  })
  it("prints the logo's red layer black on single-ink stock", () => {
    const front = buildLabel(source, "field", 50, 30, "front", "white")
    const logo = parse(front.svg).querySelectorAll("#tan-logo image")
    expect(logo).toHaveLength(2)
    for (const layer of logo) {
      expect(layer.getAttribute("data-ink")).toBe("black")
    }
    // The red-pixel layer is the one routed through the ink-black filter.
    expect(logo[1]!.getAttribute("filter")).toBe("url(#ink-black)")
    expect(proColorPlanes(front.svg).red).not.toContain("<image")
  })
})
