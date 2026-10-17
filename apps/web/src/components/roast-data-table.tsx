import { ResourceLink } from "@/components/notebook"
import { latestTasting, roastNotes } from "@/lib/notebook"
import { useNotebookHistory } from "@/lib/notebook-queries"
import { Badge } from "@tan-studio/ui/components/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import type { ColumnDef } from "@tanstack/react-table"

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
  archived: boolean | undefined
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

const archiveItems = [
  { value: "active", label: "Active roasts" },
  { value: "archived", label: "Archived roasts" },
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
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableSortHeader
        label="Roast"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <div className="notebook-row-image">
        <EntityImage
          attachmentId={row.original.profileImageAttachmentId}
          entityType="roast"
        />
        <div>
          <ResourceLink type="roast" id={row.original.id}>
            #{row.original.id}
          </ResourceLink>
          <small>{date(row.original.roastedAt)}</small>
        </div>
      </div>
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
      row.original.coffee ? (
        <ResourceLink type="coffee" id={row.original.coffee.id}>
          {row.original.coffee.name}
        </ResourceLink>
      ) : (
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
    cell: ({ row }) => (
      <div>
        {row.original.profile ? (
          <ResourceLink type="profile" id={row.original.profile.id}>
            {row.original.profile.name}
          </ResourceLink>
        ) : (
          "—"
        )}
        <small>
          Level{" "}
          {row.original.levelThousandths == null
            ? "—"
            : row.original.levelThousandths / 1000}
        </small>
      </div>
    ),
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
        label="Batch"
        sorted={column.getIsSorted()}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      />
    ),
    cell: ({ row }) => (
      <div>
        {grams(row.original.greenInputMassMg)} →{" "}
        {grams(row.original.roastedYieldMassMg)}
        <small>
          {row.original.greenInputMassMg &&
          row.original.roastedYieldMassMg != null
            ? `${(100 * (1 - row.original.roastedYieldMassMg / row.original.greenInputMassMg)).toFixed(1)}% loss`
            : "Yield —"}
        </small>
      </div>
    ),
    meta: { label: "Batch", mobile: "detail" },
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
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={statusVariant(row.original.status)}>
          {row.original.status}
        </Badge>
        {row.original.archivedAt ? (
          <Badge variant="secondary">Archived</Badge>
        ) : null}
      </div>
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
  const history = useNotebookHistory()
  const relationalColumns: ColumnDef<RoastSummary>[] = [
    ...columns,
    {
      id: "notes",
      header: "Roast note",
      enableSorting: false,
      meta: { label: "Roast note", mobile: "detail" },
      cell: ({ row }) => {
        const notes = roastNotes(history.notes, row.original.id)
        return notes.length
          ? notes.map((n) => (
              <p className="notebook-excerpt" key={n.id}>
                {n.body}
              </p>
            ))
          : "No note."
      },
    },
    {
      id: "tasting",
      header: "Brews & tasting",
      enableSorting: false,
      meta: { label: "Brews & tasting", mobile: "detail" },
      cell: ({ row }) => {
        const brews = history.brews.filter((b) => b.roastId === row.original.id)
        return brews.length
          ? brews.map((b) => (
              <div className="notebook-brew-excerpt" key={b.id}>
                <ResourceLink type="brew" id={b.id}>
                  #{b.id} · {b.method}
                </ResourceLink>
                <p className="notebook-excerpt">
                  {latestTasting(b)?.body ?? "No tasting note."}
                </p>
              </div>
            ))
          : "No brews."
      },
    },
  ]

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
      columns={relationalColumns}
      defaultHidden={["roastedAt", "level", "activity", "status"]}
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
            items={archiveItems}
            value={search.archived ? "archived" : "active"}
            onValueChange={(value) =>
              updateSearch({ archived: value === "archived" || undefined })
            }
          >
            <SelectTrigger
              aria-label="Filter archived roasts"
              className="w-full lg:w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {archiveItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
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
