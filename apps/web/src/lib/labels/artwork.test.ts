import { describe, expect, it } from "vitest"
import { buildLabel, LABEL_RED, type LabelCopy } from "./artwork"
const source: LabelCopy = {
  roastId: 128,
  coffee: "Keramo",
  country: "Ethiopia",
  region: "Sidama",
  altitude: "1,900–2,200 m",
  variety: "74158",
  process: "Washed",
  profile: "Classic washed",
  level: "2.4",
  tasting: "Bergamot · peach · honey",
  grams: "85.6",
  date: "12 Oct 2026",
}
describe("B21 Pro approved artwork", () => {
  it("renders complete 50 × 80 mm outlined copy in red and black without a QR", () => {
    const a = buildLabel(source)
    expect(a.warnings).toEqual([])
    expect(a.svg).toContain('width="50mm" height="80mm"')
    expect(a.svg).toContain(`fill="${LABEL_RED}"`)
    expect(a.svg).toContain('fill="#000"')
    // Only the two inks; white stock is never printed as a background.
    expect(new Set(a.svg.match(/#[0-9a-fA-F]{3,6}\b/g))).toEqual(
      new Set(["#000", LABEL_RED])
    )
    expect(a.svg).not.toContain("<rect")
    // The original plant, as one black and one red-tagged ink layer.
    expect(a.svg).toContain('data-ink="black"')
    expect(a.svg).toContain('data-ink="red"')
    expect(a.svg).not.toContain("<text")
    expect(a.svg).not.toContain("fictional")
    expect(a.shown).toEqual(
      expect.arrayContaining([
        "variety",
        "process",
        "profile",
        "level",
        "tasting",
        "total",
        "roast-number",
        "date",
      ])
    )
    expect(a.shown).not.toContain("qr")
  })
  it("requires the details companion for the 50 × 30 mm format", () => {
    const front = buildLabel(source, "estate", 50, 30, "front", "white"),
      back = buildLabel(source, "estate", 50, 30, "details", "white")
    expect(front.small).toBe(true)
    expect(front.svg).not.toContain(LABEL_RED)
    // Single-ink stock: the logo's red layer is printed black.
    expect(front.svg).not.toContain('data-ink="red"')
    expect(back.shown).toEqual(
      expect.arrayContaining([
        "variety",
        "process",
        "altitude",
        "profile",
        "level",
        "tasting",
        "date",
      ])
    )
  })
  it("reports overflow and unsupported characters instead of silently dropping label data", () => {
    expect(
      buildLabel({
        ...source,
        tasting: "A very long tasting note ".repeat(20),
      }).warnings.some((x) => x.startsWith("tasting:"))
    ).toBe(true)
    expect(() => buildLabel({ ...source, coffee: "☕" })).toThrow(
      /cannot outline/
    )
    expect(() => buildLabel(source, "estate", 40, 30)).toThrow(/48 × 30/)
  })
  it("omits unrecorded rows instead of printing placeholders", () => {
    const a = buildLabel({ ...source, variety: "—", altitude: "" })
    expect(a.warnings).toEqual([])
    expect(a.shown).not.toContain("variety")
    expect(a.shown).not.toContain("altitude")
    expect(a.shown).toContain("process")
  })
})
