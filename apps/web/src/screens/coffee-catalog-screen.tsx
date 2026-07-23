import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { BeanIcon, PlusIcon } from "lucide-react"
import { useEffect } from "react"

import { DataTable, DataTableSortHeader } from "@/components/data-table"
import { PageHeader } from "@/components/page-header"
import { listCoffees, queryKeys, type Coffee } from "@/lib/api"

function selectItems(values: Array<string | null | undefined>, all: string) {
  return [
    { value: "all", label: all },
    ...Array.from(
      new Set(values.filter((value): value is string => Boolean(value)))
    )
      .toSorted((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ]
}

export function CoffeeCatalogScreen() {
  const search = useSearch({ from: "/coffees" })
  const navigate = useNavigate({ from: "/coffees" })
  const coffees = useQuery({
    queryKey: queryKeys.coffees(search.q),
    queryFn: ({ signal }) => listCoffees(search.q, signal),
  })
  const updateSearch = (patch: Partial<typeof search>, replace = true) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace,
    })

  useEffect(() => {
    if (!search.coffeeId) return
    void navigate({
      to: "/coffees/$coffeeId",
      params: { coffeeId: String(search.coffeeId) },
      replace: true,
    })
  }, [navigate, search.coffeeId])

  if (coffees.error) throw coffees.error

  const providerItems = selectItems(
    coffees.data?.map((coffee) => coffee.provider) ?? [],
    "Every provider"
  )
  const countryItems = selectItems(
    coffees.data?.map((coffee) => coffee.country) ?? [],
    "Every country"
  )
  const processItems = selectItems(
    coffees.data?.map((coffee) => coffee.process) ?? [],
    "Every process"
  )
  const filtered =
    coffees.data?.filter(
      (coffee) =>
        (!search.provider || coffee.provider === search.provider) &&
        (!search.country || coffee.country === search.country) &&
        (!search.process || coffee.process === search.process)
    ) ?? []
  const columns: ColumnDef<Coffee>[] = [
    {
      id: "id",
      accessorFn: (coffee) => coffee.id,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Coffee"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <Link
          to="/coffees/$coffeeId"
          params={{ coffeeId: String(row.original.id) }}
          className="font-medium underline-offset-4 hover:underline"
        >
          #{row.original.id} · {row.original.name}
        </Link>
      ),
      enableHiding: false,
      meta: { label: "Coffee", mobile: "primary" },
    },
    {
      accessorKey: "provider",
      header: ({ column }) => (
        <DataTableSortHeader
          label="Provider"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => row.original.provider || "—",
      meta: { label: "Provider", mobile: "detail" },
    },
    {
      id: "origin",
      accessorFn: (coffee) =>
        [coffee.country, coffee.region, coffee.farm]
          .filter(Boolean)
          .join(" · "),
      header: ({ column }) => (
        <DataTableSortHeader
          label="Origin"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        [row.original.country, row.original.region, row.original.farm]
          .filter(Boolean)
          .join(" · ") || "—",
      meta: { label: "Origin", mobile: "detail" },
    },
    {
      accessorKey: "process",
      header: ({ column }) => (
        <DataTableSortHeader
          label="Process"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => row.original.process || "—",
      meta: { label: "Process", mobile: "detail" },
    },
    {
      id: "remaining",
      accessorFn: (coffee) => coffee.remainingMassMg,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Green remaining"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        `${(row.original.remainingMassMg / 1_000).toLocaleString()} g`,
      meta: { label: "Green remaining", mobile: "detail" },
    },
    {
      accessorKey: "roastCount",
      header: ({ column }) => (
        <DataTableSortHeader
          label="Roasts"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <Badge variant="secondary">{row.original.roastCount}</Badge>
      ),
      meta: { label: "Roasts", mobile: "detail" },
    },
  ]

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Coffees"
        actions={
          <Link to="/coffees/new" className={buttonVariants()}>
            <PlusIcon data-icon="inline-start" />
            Add coffee
          </Link>
        }
      />
      <div className="flex flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        {coffees.data?.length ? (
          <DataTable
            columns={columns}
            data={filtered}
            state={search}
            updateState={updateSearch}
            defaultSorting={[{ id: "id", desc: false }]}
            noun="coffee"
            getRowId={(coffee) => String(coffee.id)}
            search={{
              id: "coffee-search",
              label: "Search coffees",
              placeholder: "Coffee, provider, country, farm, process…",
              value: search.q,
              onChange: (q) => updateSearch({ q, coffeeId: undefined }),
            }}
            filters={
              <>
                {[
                  [
                    "provider",
                    "Filter by provider",
                    providerItems,
                    search.provider,
                  ],
                  [
                    "country",
                    "Filter by country",
                    countryItems,
                    search.country,
                  ],
                  [
                    "process",
                    "Filter by process",
                    processItems,
                    search.process,
                  ],
                ].map(([key, label, items, value]) => (
                  <Select
                    key={key as string}
                    items={items as { value: string; label: string }[]}
                    value={(value as string | undefined) ?? "all"}
                    onValueChange={(next) =>
                      updateSearch({
                        [key as string]: next === "all" ? undefined : next,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={label as string}
                      className="w-full lg:w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(items as { value: string; label: string }[]).map(
                          (item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          )
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ))}
              </>
            }
          />
        ) : (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BeanIcon />
              </EmptyMedia>
              <EmptyTitle>No coffees yet</EmptyTitle>
              <EmptyDescription>
                Add the green coffee you plan to roast.
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link to="/coffees/new" />}>
              <PlusIcon data-icon="inline-start" />
              Add coffee
            </Button>
          </Empty>
        )}
      </div>
    </div>
  )
}
