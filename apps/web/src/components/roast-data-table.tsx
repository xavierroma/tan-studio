import { Link } from "@tanstack/react-router"
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tan-studio/ui/components/dropdown-menu"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tan-studio/ui/components/table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react"
import { useMemo } from "react"

import type { Coffee, ProfileSummary, RoastSummary } from "@/lib/api"

export type RoastTableSearch = {
  q: string | undefined
  status: string | undefined
  profileId: number | undefined
  coffeeId: number | undefined
  sort: string | undefined
  hidden: string | undefined
}

type RoastDataTableProps = {
  data: RoastSummary[]
  profiles: ProfileSummary[]
  coffees: Coffee[]
  search: RoastTableSearch
  updateSearch: (patch: Partial<RoastTableSearch>) => void
}

const statusItems = [
  { value: "all", label: "Every status" },
  { value: "completed", label: "Completed" },
  { value: "interrupted", label: "Interrupted" },
  { value: "planned", label: "Planned" },
]

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

function sortState(value?: string): SortingState {
  const [id, direction] = value?.split(".") ?? []
  if (!id || (direction !== "asc" && direction !== "desc")) {
    return [{ id: "id", desc: true }]
  }
  return [{ id, desc: direction === "desc" }]
}

function sortValue(value: SortingState) {
  const first = value[0]
  if (!first || (first.id === "id" && first.desc)) return undefined
  return `${first.id}.${first.desc ? "desc" : "asc"}`
}

function hiddenState(value?: string): VisibilityState {
  return Object.fromEntries(
    (value?.split(",") ?? []).filter(Boolean).map((id) => [id, false])
  )
}

function hiddenValue(value: VisibilityState) {
  const hidden = Object.entries(value)
    .filter(([, visible]) => visible === false)
    .map(([id]) => id)
    .toSorted()
  return hidden.length ? hidden.join(",") : undefined
}

function SortHeader({
  label,
  sorted,
  onClick,
}: {
  label: string
  sorted: false | "asc" | "desc"
  onClick: () => void
}) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      {label}
      {sorted === "asc" ? (
        <ArrowUpIcon data-icon="inline-end" />
      ) : sorted === "desc" ? (
        <ArrowDownIcon data-icon="inline-end" />
      ) : (
        <ArrowUpDownIcon data-icon="inline-end" />
      )}
    </Button>
  )
}

const columns: ColumnDef<RoastSummary>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <SortHeader
        label="Roast"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <Link
        to="/roasts/$roastId"
        params={{ roastId: String(row.original.id) }}
        className="font-semibold underline-offset-4 hover:underline"
      >
        #{row.original.id}
      </Link>
    ),
    enableHiding: false,
  },
  {
    id: "roastedAt",
    accessorFn: (roast) =>
      roast.roastedAt ? new Date(roast.roastedAt).getTime() : 0,
    header: ({ column }) => (
      <SortHeader
        label="Date"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{date(row.original.roastedAt)}</span>
    ),
  },
  {
    id: "coffee",
    accessorFn: (roast) => roast.coffee?.name ?? "",
    header: ({ column }) => (
      <SortHeader
        label="Coffee"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) =>
      row.original.coffee?.name ?? (
        <span className="text-muted-foreground">Unassigned</span>
      ),
  },
  {
    id: "profile",
    accessorFn: (roast) => roast.profile?.name ?? "",
    header: ({ column }) => (
      <SortHeader
        label="Profile"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => row.original.profile?.name ?? "—",
  },
  {
    id: "level",
    accessorFn: (roast) => roast.levelThousandths ?? -1,
    header: ({ column }) => (
      <SortHeader
        label="Level"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) =>
      row.original.levelThousandths == null
        ? "—"
        : (row.original.levelThousandths / 1_000).toFixed(1),
  },
  {
    id: "load",
    accessorFn: (roast) => roast.greenInputMassMg ?? -1,
    header: ({ column }) => (
      <SortHeader
        label="Load"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => grams(row.original.greenInputMassMg),
  },
  {
    id: "activity",
    accessorFn: (roast) => roast.brewCount + roast.noteCount,
    header: "Activity",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.brewCount} brews · {row.original.noteCount} notes
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <SortHeader
        label="Status"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <Badge variant={statusVariant(row.original.status)}>
        {row.original.status}
      </Badge>
    ),
  },
]

export function RoastDataTable({
  data,
  profiles,
  coffees,
  search,
  updateSearch,
}: RoastDataTableProps) {
  const sorting = useMemo(() => sortState(search.sort), [search.sort])
  const columnVisibility = useMemo(
    () => hiddenState(search.hidden),
    [search.hidden]
  )
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      updateSearch({ sort: sortValue(next) })
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater
      updateSearch({ hidden: hiddenValue(next) })
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const profileItems = [
    { value: "all", label: "Every profile" },
    ...profiles.map((profile) => ({
      value: String(profile.id),
      label: `#${profile.id} · ${profile.name}`,
    })),
  ]
  const coffeeItems = [
    { value: "all", label: "Every coffee" },
    ...coffees.map((coffee) => ({
      value: String(coffee.id),
      label: `#${coffee.id} · ${coffee.name}`,
    })),
  ]
  const activeFilters = [
    search.status
      ? {
          key: "status",
          label: `Status: ${search.status}`,
          clear: () => updateSearch({ status: undefined }),
        }
      : null,
    search.profileId
      ? {
          key: "profile",
          label: `Profile: ${profileItems.find((item) => item.value === String(search.profileId))?.label ?? `#${search.profileId}`}`,
          clear: () => updateSearch({ profileId: undefined }),
        }
      : null,
    search.coffeeId
      ? {
          key: "coffee",
          label: `Coffee: ${coffeeItems.find((item) => item.value === String(search.coffeeId))?.label ?? `#${search.coffeeId}`}`,
          clear: () => updateSearch({ coffeeId: undefined }),
        }
      : null,
  ].filter((filter) => filter != null)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
        <Field className="min-w-64 flex-1">
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
        <div className="grid gap-2 sm:grid-cols-3 xl:flex">
          <Select
            items={statusItems}
            value={search.status ?? "all"}
            onValueChange={(value) =>
              updateSearch({
                status: value === "all" ? undefined : (value ?? undefined),
              })
            }
          >
            <SelectTrigger
              aria-label="Filter by roast status"
              className="w-full xl:w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={profileItems}
            value={search.profileId ? String(search.profileId) : "all"}
            onValueChange={(value) =>
              updateSearch({
                profileId: value === "all" ? undefined : Number(value),
              })
            }
          >
            <SelectTrigger
              aria-label="Filter by profile"
              className="w-full xl:w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {profileItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={coffeeItems}
            value={search.coffeeId ? String(search.coffeeId) : "all"}
            onValueChange={(value) =>
              updateSearch({
                coffeeId: value === "all" ? undefined : Number(value),
              })
            }
          >
            <SelectTrigger
              aria-label="Filter by coffee"
              className="w-full xl:w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {coffeeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline">
                <Settings2Icon data-icon="inline-start" />
                Columns
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(Boolean(value))
                  }
                >
                  {column.id === "roastedAt"
                    ? "Date"
                    : column.id.charAt(0).toUpperCase() + column.id.slice(1)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {activeFilters.length ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Active filters"
        >
          {activeFilters.map((filter) => (
            <Badge key={filter.key} variant="secondary">
              {filter.label}
              <button
                type="button"
                aria-label={`Clear ${filter.key} filter`}
                onClick={filter.clear}
              >
                <XIcon />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              updateSearch({
                status: undefined,
                profileId: undefined,
                coffeeId: undefined,
              })
            }
          >
            Clear filters
          </Button>
        </div>
      ) : null}

      <div className="bg-card overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-muted-foreground border-t px-4 py-3 text-xs">
          {table.getRowModel().rows.length.toLocaleString()} roast
          {table.getRowModel().rows.length === 1 ? "" : "s"} · sorted and
          filtered state is stored in this URL
        </div>
      </div>
    </div>
  )
}
