import type { Brew, Note, RoastSummary } from "@/lib/api"

export const pantryListSearch = {
  q: undefined,
  rest: undefined,
  sort: undefined,
  hidden: undefined,
  density: undefined,
}
export const coffeeListSearch = {
  green: undefined,
  q: undefined,
  coffeeId: undefined,
  provider: undefined,
  country: undefined,
  process: undefined,
  sort: undefined,
  hidden: undefined,
  density: undefined,
}
export const roastListSearch = {
  q: undefined,
  status: undefined,
  profileId: undefined,
  coffeeId: undefined,
  archived: undefined,
  sort: undefined,
  hidden: undefined,
  density: undefined,
  rest: undefined,
  view: undefined,
}
export const brewListSearch = {
  roastId: undefined,
  brewId: undefined,
  tab: undefined,
  q: undefined,
  method: undefined,
  sort: undefined,
  hidden: undefined,
  density: undefined,
}
export const dateText = (value?: string | null, time = false) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        ...(time ? { timeStyle: "short" as const } : {}),
      }).format(new Date(value))
    : "Not recorded"
export const massText = (value?: number | null) =>
  value == null
    ? "—"
    : `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} g`
export const levelText = (value?: number | null) =>
  value == null ? "—" : (value / 1000).toFixed(1)
export const linkedNotes = (notes: Note[], type: string, id: number) =>
  notes
    .filter((n) =>
      n.links.some((l) => l.resourceType === type && l.resourceId === id)
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
export const roastNotes = (notes: Note[], id: number) =>
  linkedNotes(notes, "roast", id).filter(
    (n) => !n.links.some((l) => l.resourceType === "brew")
  )
export const latestTasting = (brew: Brew) =>
  brew.notes
    .filter((n) => n.kind === "tasting")
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
export function brewsForCoffee(
  brews: Brew[],
  roasts: RoastSummary[],
  coffeeId: number
) {
  const ids = new Set(
    roasts.filter((r) => r.coffee?.id === coffeeId).map((r) => r.id)
  )
  return brews
    .filter((b) => ids.has(b.roastId))
    .toSorted((a, b) => b.brewedAt.localeCompare(a.brewedAt))
}
export type GreenStock = "all" | "empty" | undefined
/**
 * The working coffee view: lots with green coffee left, newest added first.
 * Used-up lots stay in the notebook and remain reachable with "all" or "empty".
 */
export function workingCoffees<
  T extends { id: number; createdAt: string; remainingMassMg: number },
>(coffees: T[], green: GreenStock = undefined) {
  return coffees
    .filter((c) =>
      green === "all"
        ? true
        : green === "empty"
          ? c.remainingMassMg <= 0
          : c.remainingMassMg > 0
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
}
