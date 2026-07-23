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
import { BeanIcon, ExternalLinkIcon, PlusIcon } from "lucide-react"
import { useEffect } from "react"

import { DataTable, DataTableSortHeader } from "@/components/data-table"
import { EntityImage } from "@/components/entity-image"
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
      id: "image",
      header: "Image",
      cell: ({ row }) => (
        <EntityImage
          attachmentId={row.original.profileImageAttachmentId}
          entityType="coffee"
          alt=""
        />
      ),
      enableHiding: false,
      enableSorting: false,
      meta: { label: "Image", mobile: "image" },
    },
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
      id: "providerUrl",
      accessorFn: (coffee) => coffee.providerUrl,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Website"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        row.original.providerUrl ? (
          <a
            href={row.original.providerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-52 items-center gap-1 truncate underline-offset-4 hover:underline"
          >
            <span className="truncate">{row.original.providerUrl}</span>
            <ExternalLinkIcon className="size-3 shrink-0" />
          </a>
        ) : (
          "—"
        ),
      meta: { label: "Website", mobile: "detail" },
    },
    ...(
      [
        ["providerProductId", "Product ID"],
        ["purchaseReference", "Purchase reference"],
        ["country", "Country"],
        ["region", "Region"],
        ["farm", "Farm"],
        ["producer", "Producer"],
        ["washingStation", "Washing station"],
      ] as const
    ).map(([key, label]): ColumnDef<Coffee> => ({
      id: key,
      accessorFn: (coffee) => coffee[key],
      header: ({ column }) => (
        <DataTableSortHeader
          label={label}
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => row.original[key] || "—",
      meta: { label, mobile: key === "country" ? "detail" : "hidden" },
    })),
    {
      id: "purchasedAt",
      accessorFn: (coffee) =>
        coffee.purchasedAt ? new Date(coffee.purchasedAt).getTime() : 0,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Purchased"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        row.original.purchasedAt
          ? new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
            }).format(new Date(row.original.purchasedAt))
          : "—",
      meta: { label: "Purchased", mobile: "hidden" },
    },
    {
      id: "price",
      accessorFn: (coffee) => coffee.priceMinor ?? -1,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Price"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        row.original.priceMinor == null
          ? "—"
          : new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: row.original.currencyCode ?? "USD",
            }).format(row.original.priceMinor / 100),
      meta: { label: "Price", mobile: "hidden" },
    },
    {
      accessorKey: "currencyCode",
      header: "Currency",
      cell: ({ row }) => row.original.currencyCode ?? "—",
      meta: { label: "Currency", mobile: "hidden" },
    },
    {
      id: "purchasedMass",
      accessorFn: (coffee) => coffee.purchasedMassMg,
      header: ({ column }) => (
        <DataTableSortHeader
          label="Purchased mass"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) =>
        `${(row.original.purchasedMassMg / 1_000).toLocaleString()} g`,
      meta: { label: "Purchased mass", mobile: "hidden" },
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
    ...(
      [
        ["variety", "Variety"],
        ["harvest", "Harvest"],
        ["storageLocation", "Storage"],
      ] as const
    ).map(([key, label]): ColumnDef<Coffee> => ({
      id: key,
      accessorFn: (coffee) => coffee[key],
      header: ({ column }) => (
        <DataTableSortHeader
          label={label}
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => row.original[key] || "—",
      meta: { label, mobile: key === "variety" ? "detail" : "hidden" },
    })),
    {
      id: "altitudeMin",
      accessorFn: (coffee) => coffee.altitudeMinM ?? -1,
      header: "Altitude min",
      cell: ({ row }) =>
        row.original.altitudeMinM == null
          ? "—"
          : `${row.original.altitudeMinM} m`,
      meta: { label: "Altitude min", mobile: "hidden" },
    },
    {
      id: "altitudeMax",
      accessorFn: (coffee) => coffee.altitudeMaxM ?? -1,
      header: "Altitude max",
      cell: ({ row }) =>
        row.original.altitudeMaxM == null
          ? "—"
          : `${row.original.altitudeMaxM} m`,
      meta: { label: "Altitude max", mobile: "hidden" },
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
    {
      id: "metadata",
      accessorFn: (coffee) => JSON.stringify(coffee.metadata),
      header: "Metadata",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-72 font-mono text-xs">
          {JSON.stringify(row.original.metadata)}
        </span>
      ),
      meta: { label: "Metadata", mobile: "hidden" },
    },
    {
      id: "createdAt",
      accessorFn: (coffee) => new Date(coffee.createdAt).getTime(),
      header: "Created",
      cell: ({ row }) =>
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
          new Date(row.original.createdAt)
        ),
      meta: { label: "Created", mobile: "hidden" },
    },
    {
      id: "updatedAt",
      accessorFn: (coffee) => new Date(coffee.updatedAt).getTime(),
      header: "Updated",
      cell: ({ row }) =>
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
          new Date(row.original.updatedAt)
        ),
      meta: { label: "Updated", mobile: "hidden" },
    },
    {
      accessorKey: "revision",
      header: "Revision",
      meta: { label: "Revision", mobile: "hidden" },
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
            preferenceKey="coffees"
            defaultHidden={[
              "providerProductId",
              "purchaseReference",
              "purchasedAt",
              "price",
              "currencyCode",
              "purchasedMass",
              "region",
              "farm",
              "producer",
              "washingStation",
              "altitudeMin",
              "altitudeMax",
              "harvest",
              "storageLocation",
              "metadata",
              "createdAt",
              "updatedAt",
              "revision",
            ]}
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
