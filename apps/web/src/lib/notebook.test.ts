import { describe, expect, it } from "vitest"
import type { Brew, Note, RoastSummary } from "@/lib/api"
import {
  brewsForCoffee,
  latestTasting,
  roastNotes,
  workingCoffees,
} from "./notebook"
const note = (
  id: number,
  kind: string,
  links: Note["links"],
  createdAt = "2026-10-12T12:00:00Z"
): Note => ({
  id,
  kind,
  body: `Note ${id}`,
  links,
  createdAt,
  updatedAt: createdAt,
  source: "user",
  attributes: {},
  revision: 1,
})
const roast = (
  id: number,
  coffeeId: number,
  archived = false
): RoastSummary => ({
  id,
  coffee: { id: coffeeId, name: `Coffee ${coffeeId}` },
  status: "completed",
  result: "success",
  roastedAtSource: "user",
  brewCount: 0,
  noteCount: 0,
  labelCount: 0,
  revision: 1,
  archivedAt: archived ? "2026-10-13T00:00:00Z" : null,
})
const brew = (
  id: number,
  roastId: number,
  brewedAt: string,
  notes: Note[] = []
): Brew => ({
  id,
  roastId,
  brewedAt,
  notes,
  sourceTimezone: "UTC",
  method: "V60",
  grinder: "",
  grinderSetting: "",
  kettle: "",
  water: "",
  coffeeMassMg: 15000,
  waterMassMg: 250000,
  recipe: {},
  createdAt: brewedAt,
  updatedAt: brewedAt,
  revision: 1,
})
describe("notebook relationships", () => {
  it("includes archived coffee roasts and sorts their brews without joining unrelated coffee", () => {
    const roasts = [roast(2, 1, true), roast(3, 2), roast(4, 1)],
      brews = [
        brew(8, 2, "2026-10-13T12:00:00Z"),
        brew(9, 3, "2026-10-15T12:00:00Z"),
        brew(10, 4, "2026-10-14T12:00:00Z"),
      ]
    expect(brewsForCoffee(brews, roasts, 1).map((b) => b.id)).toEqual([10, 8])
    expect(brews.map((b) => b.id)).toEqual([8, 9, 10])
  })
  it("keeps notes linked to a brew out of roast observations", () => {
    const notes = [
      note(1, "observation", [{ resourceType: "roast", resourceId: 4 }]),
      note(2, "tasting", [
        { resourceType: "roast", resourceId: 4 },
        { resourceType: "brew", resourceId: 8 },
      ]),
      note(3, "observation", [{ resourceType: "coffee", resourceId: 4 }]),
    ]
    expect(roastNotes(notes, 4).map((n) => n.id)).toEqual([1])
  })
  it("uses the newest tasting note rather than a newer observation", () => {
    const b = brew(1, 4, "2026-10-14T12:00:00Z", [
      note(1, "tasting", [], "2026-10-12T12:00:00Z"),
      note(2, "tasting", [], "2026-10-13T12:00:00Z"),
      note(3, "observation", [], "2026-10-14T12:00:00Z"),
    ])
    expect(latestTasting(b)?.id).toBe(2)
  })
  it("lists coffees with green left, newest added first, by default", () => {
    const coffee = (
      id: number,
      createdAt: string,
      remainingMassMg: number
    ) => ({
      id,
      createdAt,
      remainingMassMg,
    })
    const coffees = [
      coffee(1, "2026-08-01T00:00:00Z", 250_000),
      coffee(2, "2026-10-01T00:00:00Z", 0),
      coffee(3, "2026-09-01T00:00:00Z", 1_500),
    ]
    expect(workingCoffees(coffees).map((c) => c.id)).toEqual([3, 1])
    expect(workingCoffees(coffees, "empty").map((c) => c.id)).toEqual([2])
    expect(workingCoffees(coffees, "all").map((c) => c.id)).toEqual([2, 3, 1])
    expect(coffees.map((c) => c.id)).toEqual([1, 2, 3])
  })
})
