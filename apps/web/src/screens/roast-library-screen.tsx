import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { buttonVariants } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import { Field, FieldLabel } from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
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
import { ArchiveIcon, FlameIcon, PlusIcon, SearchIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { getPantry, listRoasts, queryKeys } from "@/lib/api"

type RoastSearch = {
  q: string | undefined
  status: string | undefined
  profileId: number | undefined
  coffeeId: number | undefined
  view: "pantry" | undefined
}

function date(value?: string | null) {
  if (!value) return "Date unavailable"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function grams(value?: number | null) {
  return value == null ? "—" : `${(value / 1_000).toLocaleString()} g`
}

function statusVariant(status: string) {
  if (status === "completed") return "success" as const
  if (status === "planned") return "info" as const
  if (status === "interrupted") return "warning" as const
  return "secondary" as const
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
  const error = roasts.error ?? pantry.error
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

        {!pantryView ? (
          <div className="flex flex-col gap-3">
            {search.profileId || search.coffeeId ? (
              <Alert>
                <SearchIcon />
                <AlertTitle>Relationship filter</AlertTitle>
                <AlertDescription>
                  Showing roasts linked to{" "}
                  {search.profileId
                    ? `profile #${search.profileId}`
                    : `coffee #${search.coffeeId}`}
                  .{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      updateSearch({
                        profileId: undefined,
                        coffeeId: undefined,
                      })
                    }
                  >
                    Clear filter
                  </button>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[minmax(16rem,1fr)_13rem]">
              <Field>
                <FieldLabel htmlFor="roast-search" className="sr-only">
                  Search roasts
                </FieldLabel>
                <div className="relative">
                  <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    id="roast-search"
                    value={search.q ?? ""}
                    onChange={(event) =>
                      updateSearch({ q: event.target.value || undefined })
                    }
                    className="pl-9"
                    placeholder="Roast #, profile, coffee, provider…"
                  />
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="roast-status" className="sr-only">
                  Roast status
                </FieldLabel>
                <Select
                  value={search.status ?? "all"}
                  onValueChange={(value) =>
                    updateSearch({
                      status:
                        value === "all" ? undefined : (value ?? undefined),
                    })
                  }
                >
                  <SelectTrigger id="roast-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Every status</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="interrupted">Interrupted</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        ) : null}

        {(pantryView ? pantry.isPending : roasts.isPending) ? (
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
          <div className="bg-card overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Roast</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Coffee</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Load</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roastItems.map((roast) => (
                  <TableRow key={roast.id}>
                    <TableCell>
                      <Link
                        to="/roasts/$roastId"
                        params={{ roastId: String(roast.id) }}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        #{roast.id}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {date(roast.roastedAt)}
                    </TableCell>
                    <TableCell>
                      {roast.coffee?.name ?? (
                        <span className="text-muted-foreground">
                          Unassigned
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{roast.profile?.name ?? "—"}</TableCell>
                    <TableCell>
                      {roast.levelThousandths == null
                        ? "—"
                        : (roast.levelThousandths / 1_000).toFixed(1)}
                    </TableCell>
                    <TableCell>{grams(roast.greenInputMassMg)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {roast.brewCount} brews · {roast.noteCount} notes
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(roast.status)}>
                        {roast.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
