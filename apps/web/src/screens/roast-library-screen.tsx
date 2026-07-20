import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { buttonVariants } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tan-studio/ui/components/table"
import { Tabs, TabsList, TabsTrigger } from "@tan-studio/ui/components/tabs"
import { ArchiveIcon, FlameIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
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
  view: "pantry" | undefined
}

function grams(value?: number | null) {
  return value == null ? "—" : `${(value / 1_000).toLocaleString()} g`
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
        description="Every batch, its profile, coffee, brews, and observations in one place."
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

      <div className="flex flex-col gap-5 px-5 py-6 sm:px-7">
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
            }}
            updateSearch={updateSearch}
          />
        ) : null}

        {pantryView && pantryItems.length > 0 ? (
          <div className="bg-card overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roast</TableHead>
                  <TableHead>Coffee</TableHead>
                  <TableHead>Rest</TableHead>
                  <TableHead>Estimated left</TableHead>
                  <TableHead>Latest note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pantryItems.map((item) => (
                  <TableRow key={item.roast.id}>
                    <TableCell>
                      <Link
                        to="/roasts/$roastId"
                        params={{ roastId: String(item.roast.id) }}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        #{item.roast.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {item.roast.coffee?.name ?? "Unassigned coffee"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.rest.state === "peak"
                            ? "success"
                            : item.rest.state === "resting"
                              ? "info"
                              : "warning"
                        }
                      >
                        {item.rest.state === "pastPeak"
                          ? "past peak"
                          : item.rest.state}
                      </Badge>
                      <span className="text-muted-foreground ml-2 text-xs">
                        day {item.rest.ageDays}
                      </span>
                    </TableCell>
                    <TableCell>
                      {grams(item.estimatedRemainingMassMg)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate">
                      {item.latestTasting ?? "No tasting yet"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
