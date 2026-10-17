import { ResourceLink } from "@/components/notebook"
import { latestTasting } from "@/lib/notebook"
import { useNotebookHistory } from "@/lib/notebook-queries"
import { Button } from "@tan-studio/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import type { ColumnDef } from "@tanstack/react-table"
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
  const history = useNotebookHistory()
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
      history.roasts.find((r) => r.id === brew.roastId)?.coffee?.name ?? "",
      ...brew.notes.map((note) => note.body),
    ].some((value) => String(value).toLocaleLowerCase().includes(needle))
  })
  const columns: ColumnDef<Brew>[] = [
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
        <div className="notebook-row-image">
          <EntityImage
            attachmentId={row.original.profileImageAttachmentId}
            entityType="brew"
          />
          <div>
            <ResourceLink type="brew" id={row.original.id}>
              #{row.original.id} · {row.original.method}
            </ResourceLink>
            <small>{date(row.original.brewedAt)}</small>
            <Button
              className="notebook-link text-xs"
              type="button"
              onClick={() => onAttach(row.original)}
            >
              Add files
            </Button>
          </div>
        </div>
      ),
      enableHiding: false,
      meta: { label: "Brew", mobile: "primary" },
    },
    {
      accessorKey: "roastId",
      header: ({ column }) => (
        <DataTableSortHeader
          label="Coffee · roast"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <div>
          {(() => {
            const r = history.roasts.find((r) => r.id === row.original.roastId)
            return r?.coffee ? (
              <>
                <ResourceLink type="coffee" id={r.coffee.id}>
                  {r.coffee.name}
                </ResourceLink>
                <br />
              </>
            ) : null
          })()}
          <ResourceLink type="roast" id={row.original.roastId}>
            #{row.original.roastId}
          </ResourceLink>
        </div>
      ),
      meta: { label: "Coffee · roast", mobile: "detail" },
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
      cell: ({ row }) => (
        <div>
          {row.original.coffeeMassMg / 1000} g /{" "}
          {row.original.waterMassMg / 1000} g water
          <small>
            {row.original.waterTemperatureMilliC == null
              ? "Temperature —"
              : `${row.original.waterTemperatureMilliC / 1000}°C`}{" "}
            · {row.original.grinderSetting}
          </small>
        </div>
      ),
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
    {
      id: "tasting",
      header: "Tasting notes",
      enableSorting: false,
      meta: { label: "Tasting notes", mobile: "detail" },
      cell: ({ row }) => (
        <p className="notebook-excerpt">
          {latestTasting(row.original)?.body ?? "No tasting note."}
        </p>
      ),
    },
    {
      id: "score",
      accessorFn: (b) => latestTasting(b)?.ratingBasisPoints ?? -1,
      header: "Score",
      meta: { label: "Score", mobile: "detail" },
      cell: ({ row }) => {
        const score = latestTasting(row.original)?.ratingBasisPoints
        return score == null ? "—" : `${score / 100} / 100`
      },
    },
  ]

  return (
    <DataTable
      preferenceKey="brews"
      columns={columns}
      defaultHidden={["brewedAt", "media"]}
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
