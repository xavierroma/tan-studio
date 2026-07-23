import type { ColumnDef } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"

import {
  DataTable,
  DataTableSortHeader,
  type DataTableViewState,
} from "@/components/data-table"
import { EntityImage } from "@/components/entity-image"
import { getPantry } from "@/lib/api"

type PantryItem = Awaited<ReturnType<typeof getPantry>>["items"][number]

export type PantryTableSearch = DataTableViewState & {
  q: string | undefined
  rest: string | undefined
}

function grams(value?: number | null) {
  return value == null ? "—" : `${(value / 1_000).toLocaleString()} g`
}

function restLabel(state: string) {
  if (state === "pastPeak") return "Past peak"
  if (state === "unknown") return "Date required"
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function restVariant(state: string) {
  if (state === "peak") return "success" as const
  if (state === "resting") return "info" as const
  if (state === "unknown") return "secondary" as const
  return "warning" as const
}

const columns: ColumnDef<PantryItem>[] = [
  {
    id: "image",
    header: "Image",
    cell: ({ row }) => (
      <EntityImage
        attachmentId={row.original.roast.profileImageAttachmentId}
        entityType="roast"
        alt=""
      />
    ),
    enableHiding: false,
    enableSorting: false,
    meta: { label: "Image", mobile: "image" },
  },
  {
    id: "id",
    accessorFn: (item) => item.roast.id,
    header: ({ column }) => (
      <DataTableSortHeader
        label="Roast"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <Link
        to="/roasts/$roastId"
        params={{ roastId: String(row.original.roast.id) }}
        className="font-semibold underline-offset-4 hover:underline"
      >
        #{row.original.roast.id}
      </Link>
    ),
    enableHiding: false,
    meta: { label: "Roast", mobile: "primary" },
  },
  {
    id: "coffee",
    accessorFn: (item) => item.roast.coffee?.name ?? "",
    header: ({ column }) => (
      <DataTableSortHeader
        label="Coffee"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => row.original.roast.coffee?.name ?? "Unassigned coffee",
    meta: { label: "Coffee", mobile: "detail" },
  },
  {
    id: "rest",
    accessorFn: (item) => item.rest.ageDays ?? -1,
    header: ({ column }) => (
      <DataTableSortHeader
        label="Rest"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Badge variant={restVariant(row.original.rest.state)}>
          {restLabel(row.original.rest.state)}
        </Badge>
        {row.original.rest.ageDays == null ? null : (
          <span className="text-muted-foreground text-xs">
            day {row.original.rest.ageDays}
          </span>
        )}
      </div>
    ),
    meta: { label: "Rest", mobile: "detail" },
  },
  {
    id: "remaining",
    accessorFn: (item) => item.estimatedRemainingMassMg ?? -1,
    header: ({ column }) => (
      <DataTableSortHeader
        label="Estimated left"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => grams(row.original.estimatedRemainingMassMg),
    meta: { label: "Estimated left", mobile: "detail" },
  },
  {
    id: "latestNote",
    accessorFn: (item) => item.latestTasting ?? "",
    header: "Latest note",
    cell: ({ row }) => (
      <span className="text-muted-foreground line-clamp-2 max-w-lg text-sm">
        {row.original.latestTasting ?? "No tasting yet"}
      </span>
    ),
    meta: { label: "Latest note", mobile: "detail" },
  },
]

const restItems = [
  { value: "all", label: "Every rest state" },
  { value: "resting", label: "Resting" },
  { value: "peak", label: "At peak" },
  { value: "pastPeak", label: "Past peak" },
  { value: "unknown", label: "Date required" },
]

export function PantryDataTable({
  data,
  search,
  updateSearch,
}: {
  data: PantryItem[]
  search: PantryTableSearch
  updateSearch: (patch: Partial<PantryTableSearch>) => void
}) {
  const needle = search.q?.trim().toLocaleLowerCase()
  const filtered = data.filter((item) => {
    if (search.rest && item.rest.state !== search.rest) return false
    if (!needle) return true
    return [
      String(item.roast.id),
      item.roast.coffee?.name,
      item.roast.profile?.name,
      item.latestTasting,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(needle))
  })

  return (
    <DataTable
      preferenceKey="pantry"
      columns={columns}
      data={filtered}
      state={search}
      updateState={updateSearch}
      defaultSorting={[{ id: "id", desc: true }]}
      noun="pantry roast"
      getRowId={(item) => String(item.roast.id)}
      search={{
        id: "pantry-search",
        label: "Search pantry",
        placeholder: "Roast #, coffee, profile, tasting note…",
        value: search.q,
        onChange: (q) => updateSearch({ q }),
      }}
      filters={
        <Select
          items={restItems}
          value={search.rest ?? "all"}
          onValueChange={(value) =>
            updateSearch({
              rest: value === "all" ? undefined : (value ?? undefined),
            })
          }
        >
          <SelectTrigger
            aria-label="Filter by rest state"
            className="w-full lg:w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {restItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
    />
  )
}
