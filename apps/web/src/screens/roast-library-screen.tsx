import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { Checkbox } from "@tan-studio/ui/components/checkbox"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { toast } from "sonner"
import {
  ArrowUpDownIcon,
  Columns3Icon,
  DownloadIcon,
  GitCompareArrowsIcon,
  ListFilterIcon,
  SearchIcon,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { PageHeader } from "@/components/page-header"
import { StatusChip } from "@/components/status-chip"
import { listRoasts, queryKeys } from "@/lib/api"
import { formatRoastDate, formatScore } from "@/lib/format"
import { useWorkspaceStore } from "@/stores/workspace-store"
import type { RoastSummary } from "@/types"

const columnHelper = createColumnHelper<RoastSummary>()

function escapeCsv(value: string | number | null) {
  const text = value == null ? "" : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function exportRoasts(roasts: RoastSummary[]) {
  const rows = [
    [
      "Date",
      "Coffee",
      "Provider",
      "Country",
      "Region",
      "Farm",
      "Process",
      "Profile",
      "Score",
      "Notes",
    ],
    ...roasts.map((roast) => [
      roast.roastedAt,
      roast.coffeeName,
      roast.providerName,
      roast.country,
      roast.region,
      roast.farm,
      roast.process,
      `${roast.profileName} r${roast.profileRevision}`,
      roast.score,
      roast.tastingNotes,
    ]),
  ]
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n")
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `tan-studio-roasts-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
  toast.success(`Exported ${roasts.length} roasts`)
}

export function RoastLibraryScreen() {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.roasts(),
    queryFn: ({ signal }) => listRoasts(signal),
  })
  const search = useSearch({ strict: false }) as {
    q?: string
    process?: string
    status?: string
  }
  const navigate = useNavigate()
  const [group, setGroup] = useState("lot")
  const selectedRoastIds = useWorkspaceStore((state) => state.selectedRoastIds)
  const toggleComparison = useWorkspaceStore((state) => state.addToComparison)
  const scrollRef = useRef<HTMLDivElement>(null)

  const roasts = useMemo(() => {
    const query = (search.q ?? "").trim().toLocaleLowerCase()
    return (data?.data ?? []).filter((roast) => {
      const haystack = [
        roast.coffeeName,
        roast.providerName,
        roast.country,
        roast.region,
        roast.farm,
        roast.process,
        roast.profileName,
        roast.tastingNotes,
        ...roast.descriptors,
      ]
        .join(" ")
        .toLocaleLowerCase()
      return (
        (!query || haystack.includes(query)) &&
        (!search.process ||
          search.process === "all" ||
          roast.process.includes(search.process)) &&
        (!search.status ||
          search.status === "all" ||
          roast.status === search.status)
      )
    })
  }, [data?.data, search.process, search.q, search.status])

  const columns = useMemo(
    () => [
      columnHelper.display({ id: "select" }),
      columnHelper.accessor("roastedAt", { header: "Date ↓" }),
      columnHelper.accessor("coffeeName", { header: "Coffee" }),
      columnHelper.accessor("providerName", { header: "Provider" }),
      columnHelper.accessor("region", { header: "Country · region · farm" }),
      columnHelper.accessor("process", { header: "Process" }),
      columnHelper.accessor("profileName", { header: "Profile / rev" }),
      columnHelper.accessor("score", { header: "Score" }),
      columnHelper.accessor("tastingNotes", { header: "Tasting notes" }),
      columnHelper.accessor("status", { header: "Status" }),
    ],
    []
  )

  const table = useReactTable({
    data: roasts,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const tableRows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 8,
  })

  const setSearch = (
    patch: Partial<Record<"q" | "process" | "status", string | undefined>>
  ) => {
    void navigate({
      to: "/roasts",
      search: {
        q: "q" in patch ? patch.q : search.q,
        process: "process" in patch ? patch.process : search.process,
        status: "status" in patch ? patch.status : search.status,
      },
      replace: true,
    })
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Roast notebook"
        description={`${roasts.length.toLocaleString()} roasts · Every batch linked to its green coffee and tasting feedback`}
        actions={
          <>
            <Button variant="outline" onClick={() => exportRoasts(roasts)}>
              <DownloadIcon data-icon="inline-start" />
              Export CSV
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/compare" />}
              disabled={selectedRoastIds.length < 2}
              aria-label={`Compare ${selectedRoastIds.length} selected roasts`}
            >
              <GitCompareArrowsIcon data-icon="inline-start" />
              Compare {selectedRoastIds.length || ""}
            </Button>
          </>
        }
      />

      <section className="px-5 py-5 sm:px-7" aria-label="Roast filters">
        <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1.4fr)_minmax(10rem,0.65fr)_minmax(10rem,0.65fr)_auto]">
          <label className="relative block">
            <span className="sr-only">Search roast notebook</span>
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search.q ?? ""}
              onChange={(event) =>
                setSearch({ q: event.target.value || undefined })
              }
              className="bg-card h-10 pl-9"
              placeholder="Search coffee, provider, farm, tasting note, profile…"
            />
          </label>

          <Select
            value={group}
            onValueChange={(value) => setGroup(value ?? "lot")}
          >
            <SelectTrigger
              className="bg-card h-10 w-full"
              aria-label="Group roasts"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lot">Coffee lot → provider</SelectItem>
              <SelectItem value="coffee">Coffee → date</SelectItem>
              <SelectItem value="provider">Provider → coffee</SelectItem>
              <SelectItem value="none">No grouping</SelectItem>
            </SelectContent>
          </Select>

          <Select value="newest">
            <SelectTrigger
              className="bg-card h-10 w-full"
              aria-label="Sort roasts"
            >
              <ArrowUpDownIcon data-icon="inline-start" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Date · newest</SelectItem>
              <SelectItem value="score">Score · highest</SelectItem>
              <SelectItem value="coffee">Coffee · A–Z</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            className="bg-card h-10"
            onClick={() => toast.info("Column presets are saved per view")}
          >
            <Columns3Icon data-icon="inline-start" />
            Columns 10
          </Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <Select value="90-days">
            <SelectTrigger className="bg-card w-full" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="90-days">Last 90 days</SelectItem>
              <SelectItem value="year">This year</SelectItem>
              <SelectItem value="all">All dates</SelectItem>
            </SelectContent>
          </Select>
          <Select value="all">
            <SelectTrigger
              className="bg-card w-full"
              aria-label="Provider filter"
            >
              <SelectValue>All providers</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              <SelectItem value="Sey Coffee">Sey Coffee</SelectItem>
              <SelectItem value="Osito Coffee">Osito Coffee</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.process ?? "all"}
            onValueChange={(value) =>
              setSearch({
                process: value === "all" ? undefined : (value ?? undefined),
              })
            }
          >
            <SelectTrigger
              className="bg-card w-full"
              aria-label="Process filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any process</SelectItem>
              <SelectItem value="Washed">Washed</SelectItem>
              <SelectItem value="Natural">Natural</SelectItem>
              <SelectItem value="Honey">Honey</SelectItem>
            </SelectContent>
          </Select>
          <Select value="80">
            <SelectTrigger
              className="bg-card w-full"
              aria-label="Tasting score filter"
            >
              <SelectValue>Score 80+</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="80">Score 80+</SelectItem>
              <SelectItem value="85">Score 85+</SelectItem>
              <SelectItem value="none">Any score</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.status ?? "all"}
            onValueChange={(value) =>
              setSearch({
                status: value === "all" ? undefined : (value ?? undefined),
              })
            }
          >
            <SelectTrigger
              className="bg-card w-full"
              aria-label="Roast status filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="tasted">Tasted</SelectItem>
              <SelectItem value="needs-tasting">Taste due</SelectItem>
              <SelectItem value="ready">Plan ready</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => toast.info("Add nested filter")}
          >
            <ListFilterIcon data-icon="inline-start" />
            Filter
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Badge variant="success">Saved view · Roasting notebook</Badge>
          <span className="text-muted-foreground text-xs">
            {group === "none" ? "Ungrouped" : `Grouped by ${group}`} · score
            sorted within each group
          </span>
          <span className="text-muted-foreground ml-auto text-xs">
            {data?.source === "companion"
              ? "Local database"
              : "Sample workspace"}
          </span>
        </div>
      </section>

      <section
        className="bg-card mx-5 mb-8 overflow-hidden rounded-xl border sm:mx-7"
        aria-label="Roast database"
      >
        <div className="overflow-x-auto">
          <div
            className="min-w-[1240px]"
            role="table"
            aria-rowcount={tableRows.length}
          >
            <div
              role="row"
              className="bg-muted text-muted-foreground grid h-10 grid-cols-[36px_118px_minmax(180px,1.25fr)_130px_minmax(180px,1.3fr)_110px_140px_95px_minmax(190px,1.35fr)_110px] items-center gap-3 border-b px-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase"
            >
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <div key={header.id} role="columnheader">
                  {typeof header.column.columnDef.header === "string"
                    ? header.column.columnDef.header
                    : ""}
                </div>
              ))}
            </div>

            <div
              ref={scrollRef}
              className="max-h-[calc(100vh-25rem)] min-h-[26rem] overflow-auto"
            >
              {isPending ? (
                <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
                  Loading roast notebook…
                </div>
              ) : tableRows.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                  <p className="font-medium">No roasts match this view</p>
                  <p className="text-muted-foreground text-sm">
                    Clear a filter or search for a different coffee.
                  </p>
                </div>
              ) : (
                <div
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = tableRows[virtualRow.index]!
                    const roast = row.original
                    const roastDate = formatRoastDate(roast.roastedAt)
                    const selected = selectedRoastIds.includes(roast.id)
                    return (
                      <div
                        key={row.id}
                        role="row"
                        aria-selected={selected}
                        className="hover:bg-secondary/45 aria-selected:bg-accent/30 absolute top-0 left-0 grid w-full grid-cols-[36px_118px_minmax(180px,1.25fr)_130px_minmax(180px,1.3fr)_110px_140px_95px_minmax(190px,1.35fr)_110px] items-center gap-3 border-b px-3 text-sm transition-colors"
                        style={{
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div role="cell">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleComparison(roast.id)}
                            aria-label={`Select ${roast.coffeeName} roasted ${roastDate.date} for comparison`}
                          />
                        </div>
                        <div
                          role="cell"
                          className="font-mono text-xs tabular-nums"
                        >
                          <p className="font-medium">{roastDate.date}</p>
                          <p className="text-muted-foreground">
                            {roastDate.time}
                          </p>
                        </div>
                        <div role="cell" className="min-w-0">
                          <Link
                            to="/roasts/$roastId"
                            params={{ roastId: roast.id }}
                            className="hover:text-primary block truncate font-semibold hover:underline hover:underline-offset-4"
                          >
                            {roast.coffeeName}
                          </Link>
                          <p className="text-muted-foreground truncate text-xs">
                            Lot {roast.lotCode}
                          </p>
                        </div>
                        <div role="cell" className="truncate text-xs">
                          {roast.providerName}
                        </div>
                        <div role="cell" className="min-w-0 text-xs">
                          <p className="truncate font-medium">
                            {roast.country} · {roast.region}
                          </p>
                          <p className="text-muted-foreground truncate">
                            {roast.farm}
                          </p>
                        </div>
                        <div role="cell" className="truncate text-xs">
                          {roast.process}
                        </div>
                        <div role="cell" className="min-w-0 text-xs">
                          <p className="truncate">{roast.profileName}</p>
                          <p className="text-muted-foreground">
                            Revision {roast.profileRevision}
                          </p>
                        </div>
                        <div
                          role="cell"
                          className="font-mono text-lg font-semibold tabular-nums"
                        >
                          {formatScore(roast.score)}
                        </div>
                        <div
                          role="cell"
                          className="text-muted-foreground line-clamp-2 text-xs"
                        >
                          {roast.tastingNotes || "Awaiting tasting notes"}
                        </div>
                        <div role="cell">
                          <StatusChip status={roast.status} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
