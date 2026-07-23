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
import type { Coffee, ProfileSummary, RoastSummary } from "@/lib/api"

export type RoastTableSearch = DataTableViewState & {
  q: string | undefined
  status: string | undefined
  profileId: number | undefined
  coffeeId: number | undefined
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

const columns: ColumnDef<RoastSummary>[] = [
  {
    id: "image",
    header: "Image",
    cell: ({ row }) => (
      <EntityImage
        attachmentId={row.original.profileImageAttachmentId}
        entityType="roast"
        alt=""
      />
    ),
    enableHiding: false,
    enableSorting: false,
    meta: { label: "Image", mobile: "image" },
  },
  {
    accessorKey: "id",
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
        params={{ roastId: String(row.original.id) }}
        className="font-semibold underline-offset-4 hover:underline"
      >
        #{row.original.id}
      </Link>
    ),
    enableHiding: false,
    meta: { label: "Roast", mobile: "primary" },
  },
  {
    id: "roastedAt",
    accessorFn: (roast) =>
      roast.roastedAt ? new Date(roast.roastedAt).getTime() : 0,
    header: ({ column }) => (
      <DataTableSortHeader
        label="Date"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{date(row.original.roastedAt)}</span>
    ),
    meta: { label: "Date", mobile: "detail" },
  },
  {
    id: "coffee",
    accessorFn: (roast) => roast.coffee?.name ?? "",
    header: ({ column }) => (
      <DataTableSortHeader
        label="Coffee"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) =>
      row.original.coffee?.name ?? (
        <span className="text-muted-foreground">Unassigned</span>
      ),
    meta: { label: "Coffee", mobile: "detail" },
  },
  {
    id: "profile",
    accessorFn: (roast) => roast.profile?.name ?? "",
    header: ({ column }) => (
      <DataTableSortHeader
        label="Profile"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => row.original.profile?.name ?? "—",
    meta: { label: "Profile", mobile: "detail" },
  },
  {
    id: "level",
    accessorFn: (roast) => roast.levelThousandths ?? -1,
    header: ({ column }) => (
      <DataTableSortHeader
        label="Level"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) =>
      row.original.levelThousandths == null
        ? "—"
        : (row.original.levelThousandths / 1_000).toFixed(1),
    meta: { label: "Level", mobile: "detail" },
  },
  {
    id: "load",
    accessorFn: (roast) => roast.greenInputMassMg ?? -1,
    header: ({ column }) => (
      <DataTableSortHeader
        label="Load"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => grams(row.original.greenInputMassMg),
    meta: { label: "Load", mobile: "detail" },
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
    meta: { label: "Activity", mobile: "hidden" },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableSortHeader
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
    meta: { label: "Status", mobile: "detail" },
  },
]

export function RoastDataTable({
  data,
  profiles,
  coffees,
  search,
  updateSearch,
}: RoastDataTableProps) {
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

  return (
    <DataTable
      preferenceKey="roasts"
      columns={columns}
      data={data}
      state={search}
      updateState={updateSearch}
      defaultSorting={[{ id: "id", desc: true }]}
      noun="roast"
      getRowId={(roast) => String(roast.id)}
      search={{
        id: "roast-search",
        label: "Search roasts",
        placeholder: "Roast #, profile, coffee, provider…",
        value: search.q,
        onChange: (q) => updateSearch({ q }),
      }}
      filters={
        <>
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
              className="w-full lg:w-40"
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
              className="w-full lg:w-52"
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
              className="w-full lg:w-52"
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
        </>
      }
    />
  )
}
