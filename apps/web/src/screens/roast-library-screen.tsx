import { Button } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { FlameIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { RoastDataTable } from "@/components/roast-data-table"
import { listCoffees, listProfiles, listRoasts, queryKeys } from "@/lib/api"

type RoastSearch = {
  q: string | undefined
  status: string | undefined
  profileId: number | undefined
  coffeeId: number | undefined
  archived: boolean | undefined
  sort: string | undefined
  hidden: string | undefined
  density: "compact" | "expanded" | undefined
}

export function RoastLibraryScreen() {
  const search = useSearch({ from: "/roasts" })
  const navigate = useNavigate({ from: "/roasts" })
  const roasts = useQuery({
    queryKey: queryKeys.roasts({
      q: search.q,
      status: search.status,
      profileId: search.profileId,
      coffeeId: search.coffeeId,
      archived: search.archived,
    }),
    queryFn: ({ signal }) =>
      listRoasts(
        {
          q: search.q,
          status: search.status,
          profileId: search.profileId,
          coffeeId: search.coffeeId,
          archived: search.archived,
        },
        signal
      ),
    // Keep the table (and its filters) mounted while a new query loads.
    placeholderData: keepPreviousData,
  })
  const profiles = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(undefined, signal),
  })
  const coffees = useQuery({
    queryKey: queryKeys.coffees(),
    queryFn: ({ signal }) => listCoffees(undefined, signal),
  })
  const error = roasts.error ?? profiles.error ?? coffees.error
  if (error) throw error

  const roastItems = roasts.data ?? []
  const filtered = Boolean(
    search.q ||
    search.status ||
    search.profileId ||
    search.coffeeId ||
    search.archived
  )

  const updateSearch = (patch: Partial<RoastSearch>) => {
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace: true,
    })
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Roasts"
        actions={
          <Button
            nativeButton={false}
            role="link"
            render={
              <Link
                to="/roast"
                search={{ profileId: undefined, coffeeId: undefined }}
              />
            }
          >
            <PlusIcon data-icon="inline-start" />
            Prepare a roast
          </Button>
        }
      />

      <div className="flex flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        {roasts.isPending || profiles.isPending || coffees.isPending ? (
          <Skeleton className="h-72" />
        ) : null}

        {!roasts.isPending && roastItems.length === 0 && !filtered ? (
          <Empty className="notebook-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlameIcon />
              </EmptyMedia>
              <EmptyTitle>No roasts yet</EmptyTitle>
              <EmptyDescription>
                Prepare a roast or synchronize the Nano.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {!roasts.isPending && (roastItems.length > 0 || filtered) ? (
          <RoastDataTable
            data={roastItems}
            profiles={profiles.data ?? []}
            coffees={coffees.data ?? []}
            search={{
              q: search.q,
              status: search.status,
              profileId: search.profileId,
              coffeeId: search.coffeeId,
              archived: search.archived,
              sort: search.sort,
              hidden: search.hidden,
              density: search.density,
            }}
            updateSearch={updateSearch}
          />
        ) : null}
      </div>
    </div>
  )
}
