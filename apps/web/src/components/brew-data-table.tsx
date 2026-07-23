import type { ColumnDef } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import { Button } from "@tan-studio/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { PaperclipIcon } from "lucide-react"

import {
  DataTable,
  DataTableSortHeader,
  type DataTableViewState,
} from "@/components/data-table"
import { EntityImage } from "@/components/entity-image"
import type { Brew } from "@/lib/api"

export type BrewTableSearch = DataTableViewState & {
  q: string | undefined
  method: string | undefined
}

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function BrewDataTable({
  data,
  search,
  updateSearch,
  onAttach,
}: {
  data: Brew[]
  search: BrewTableSearch
  updateSearch: (patch: Partial<BrewTableSearch>) => void
  onAttach: (brew: Brew) => void
}) {
  const methods = [
    { value: "all", label: "Every method" },
    ...Array.from(new Set(data.map((brew) => brew.method).filter(Boolean)))
      .toSorted((a, b) => a.localeCompare(b))
      .map((method) => ({ value: method, label: method })),
  ]
  const needle = search.q?.trim().toLocaleLowerCase()
  const filtered = data.filter((brew) => {
    if (search.method && brew.method !== search.method) return false
    if (!needle) return true
    return [
      brew.id,
      brew.roastId,
      brew.method,
      brew.grinder,
      ...brew.notes.map((note) => note.body),
    ].some((value) => String(value).toLocaleLowerCase().includes(needle))
  })
  const columns: ColumnDef<Brew>[] = [
    {
      id: "image",
      header: "Image",
      cell: ({ row }) => (
        <EntityImage
          attachmentId={row.original.profileImageAttachmentId}
          entityType="brew"
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
          label="Brew"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <span className="font-medium">#{row.original.id}</span>
      ),
      enableHiding: false,
      meta: { label: "Brew", mobile: "primary" },
    },
    {
      accessorKey: "roastId",
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
          params={{ roastId: String(row.original.roastId) }}
          className="underline-offset-4 hover:underline"
        >
          #{row.original.roastId}
        </Link>
      ),
      meta: { label: "Roast", mobile: "detail" },
    },
    {
      id: "recipe",
      accessorFn: (brew) => brew.coffeeMassMg,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Recipe"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        `${row.original.coffeeMassMg / 1_000} g · ${row.original.waterMassMg / 1_000} g · ${row.original.method}`,
      meta: { label: "Recipe", mobile: "detail" },
    },
    {
      accessorKey: "brewedAt",
      header: ({ column }) => (
        <DataTableSortHeader
          label="When"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{date(row.original.brewedAt)}</span>
      ),
      meta: { label: "When", mobile: "detail" },
    },
    {
      id: "media",
      header: "Media",
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onAttach(row.original)}
        >
          <PaperclipIcon data-icon="inline-start" />
          Attach
        </Button>
      ),
      enableSorting: false,
      meta: { label: "Media", mobile: "detail" },
    },
  ]

  return (
    <DataTable
      preferenceKey="brews"
      columns={columns}
      data={filtered}
      state={search}
      updateState={updateSearch}
      defaultSorting={[{ id: "brewedAt", desc: true }]}
      noun="brew"
      getRowId={(brew) => String(brew.id)}
      search={{
        id: "brew-search",
        label: "Search brews",
        placeholder: "Brew #, roast #, method, grinder, note…",
        value: search.q,
        onChange: (q) => updateSearch({ q }),
      }}
      filters={
        <Select
          items={methods}
          value={search.method ?? "all"}
          onValueChange={(value) =>
            updateSearch({
              method: value === "all" ? undefined : (value ?? undefined),
            })
          }
        >
          <SelectTrigger
            aria-label="Filter by brew method"
            className="w-full lg:w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {methods.map((method) => (
                <SelectItem key={method.value} value={method.value}>
                  {method.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
    />
  )
}
