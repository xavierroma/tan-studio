import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { buttonVariants } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@tan-studio/ui/components/tabs"
import { ArchiveIcon, FlameIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PantryDataTable } from "@/components/pantry-data-table"
import { RoastDataTable } from "@/components/roast-data-table"
import {
  getPantry,
  listCoffees,
  listProfiles,
  listRoasts,
  queryKeys,
} from "@/lib/api"

type RoastSearch = {
  q: string | undefined
  status: string | undefined
  profileId: number | undefined
  coffeeId: number | undefined
  sort: string | undefined
  hidden: string | undefined
  density: "expanded" | undefined
  rest: string | undefined
  view: "pantry" | undefined
}

export function RoastLibraryScreen() {
  const search = useSearch({ from: "/roasts" })
  const navigate = useNavigate({ from: "/roasts" })
  const pantryView = search.view === "pantry"
  const roasts = useQuery({
    queryKey: queryKeys.roasts({
      q: search.q,
      status: search.status,
      profileId: search.profileId,
      coffeeId: search.coffeeId,
    }),
    queryFn: ({ signal }) =>
      listRoasts(
        {
          q: search.q,
          status: search.status,
          profileId: search.profileId,
          coffeeId: search.coffeeId,
        },
        signal
      ),
    enabled: !pantryView,
  })
  const pantry = useQuery({
    queryKey: queryKeys.pantry(),
    queryFn: ({ signal }) => getPantry(signal),
    enabled: pantryView,
  })
  const profiles = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(undefined, signal),
    enabled: !pantryView,
  })
  const coffees = useQuery({
    queryKey: queryKeys.coffees(),
    queryFn: ({ signal }) => listCoffees(undefined, signal),
    enabled: !pantryView,
  })
  const error = roasts.error ?? pantry.error ?? profiles.error ?? coffees.error
  if (error) throw error

  const roastItems = roasts.data ?? []
  const pantryItems = pantry.data?.items ?? []

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
          <Link
            to="/roast"
            search={{ profileId: undefined, coffeeId: undefined }}
            className={buttonVariants()}
          >
            <PlusIcon data-icon="inline-start" />
            Prepare a roast
          </Link>
        }
      />

      <div className="flex flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        <Tabs
          value={pantryView ? "pantry" : "history"}
          onValueChange={(value) =>
            updateSearch({ view: value === "pantry" ? "pantry" : undefined })
          }
        >
          <TabsList variant="line">
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="pantry">Pantry</TabsTrigger>
          </TabsList>
        </Tabs>

        {(
          pantryView
            ? pantry.isPending
            : roasts.isPending || profiles.isPending || coffees.isPending
        ) ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : null}

        {!pantryView && !roasts.isPending && roastItems.length === 0 ? (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlameIcon />
              </EmptyMedia>
              <EmptyTitle>No roasts found</EmptyTitle>
              <EmptyDescription>
                Prepare a roast or synchronize the connected Nano.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {pantryView && !pantry.isPending && pantryItems.length === 0 ? (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ArchiveIcon />
              </EmptyMedia>
              <EmptyTitle>Your pantry is empty</EmptyTitle>
              <EmptyDescription>
                Completed roasts with estimated coffee remaining appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {!pantryView && roastItems.length > 0 ? (
          <RoastDataTable
            data={roastItems}
            profiles={profiles.data ?? []}
            coffees={coffees.data ?? []}
            search={{
              q: search.q,
              status: search.status,
              profileId: search.profileId,
              coffeeId: search.coffeeId,
              sort: search.sort,
              hidden: search.hidden,
              density: search.density,
            }}
            updateSearch={updateSearch}
          />
        ) : null}

        {pantryView && pantryItems.length > 0 ? (
          <PantryDataTable
            data={pantryItems}
            search={{
              q: search.q,
              rest: search.rest,
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
