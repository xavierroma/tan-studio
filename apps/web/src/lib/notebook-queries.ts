import { useQuery } from "@tanstack/react-query"
import { listBrews, listNotes, listRoasts, queryKeys } from "@/lib/api"

/** Shared resource lists avoid a request per roast when showing the notebook's relationships. */
export function useNotebookHistory() {
  const active = useQuery({
    queryKey: queryKeys.roasts(),
    queryFn: ({ signal }) => listRoasts({}, signal),
  })
  const archived = useQuery({
    queryKey: queryKeys.roasts({ archived: true }),
    queryFn: ({ signal }) => listRoasts({ archived: true }, signal),
  })
  const brews = useQuery({
    queryKey: queryKeys.brews(),
    queryFn: ({ signal }) => listBrews(undefined, signal),
  })
  const notes = useQuery({
    queryKey: queryKeys.notes(),
    queryFn: ({ signal }) => listNotes(undefined, undefined, signal),
  })
  const error = active.error ?? archived.error ?? brews.error ?? notes.error
  if (error) throw error
  return {
    roasts: [
      ...new Map(
        [...(active.data ?? []), ...(archived.data ?? [])].map((r) => [r.id, r])
      ).values(),
    ].toSorted(
      (a, b) =>
        (b.roastedAt ?? "").localeCompare(a.roastedAt ?? "") || b.id - a.id
    ),
    brews: brews.data ?? [],
    notes: notes.data ?? [],
    isPending:
      active.isPending ||
      archived.isPending ||
      brews.isPending ||
      notes.isPending,
  }
}
