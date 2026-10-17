import { describe, expect, it } from "vitest"
import { buildLabel, type LabelCopy } from "./artwork"
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
    expect(a.svg).toContain('fill="#a32225"')
    expect(a.svg).toContain('fill="#000"')
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
    expect(front.svg).not.toContain("#a32225")
    expect(back.shown).toContain("variety-process")
    expect(back.shown).toContain("profile")
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
})
