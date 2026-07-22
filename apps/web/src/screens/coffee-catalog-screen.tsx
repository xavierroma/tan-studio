import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { Separator } from "@tan-studio/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tan-studio/ui/components/sheet"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { BeanIcon, PlusIcon, SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { AttachmentPanel } from "@/components/attachment-panel"
import { DataTable, DataTableSortHeader } from "@/components/data-table"
import {
  createCoffee,
  createNote,
  listCoffees,
  listNotes,
  queryKeys,
  updateCoffee,
  type Coffee,
  type CoffeeCreate,
} from "@/lib/api"

function grams(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000) : 0
}
function dateInput(value?: string | null) {
  return value ? value.slice(0, 10) : ""
}
function instant(value: FormDataEntryValue | null) {
  const text = String(value ?? "")
  return text ? new Date(`${text}T12:00:00`).toISOString() : null
}

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

function coffeeBody(form: FormData): CoffeeCreate {
  return {
    name: String(form.get("name") ?? "").trim(),
    provider: String(form.get("provider") ?? "").trim(),
    providerUrl: String(form.get("providerUrl") ?? "").trim(),
    providerProductId: "",
    purchaseReference: String(form.get("purchaseReference") ?? "").trim(),
    purchasedAt: instant(form.get("purchasedAt")),
    priceMinor: null,
    currencyCode: null,
    purchasedMassMg: grams(form.get("purchasedMass")),
    remainingMassMg: grams(form.get("remainingMass")),
    country: String(form.get("country") ?? "").trim(),
    region: String(form.get("region") ?? "").trim(),
    farm: String(form.get("farm") ?? "").trim(),
    producer: String(form.get("producer") ?? "").trim(),
    washingStation: "",
    process: String(form.get("process") ?? "").trim(),
    variety: String(form.get("variety") ?? "").trim(),
    altitudeMinM: null,
    altitudeMaxM: null,
    harvest: String(form.get("harvest") ?? "").trim(),
    storageLocation: String(form.get("storageLocation") ?? "").trim(),
    metadata: {},
  }
}

function CoffeeFields({ coffee }: { coffee?: Coffee }) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="coffee-name">Coffee name</FieldLabel>
        <Input
          id="coffee-name"
          name="name"
          required
          defaultValue={coffee?.name}
          placeholder="Ethiopia Hamasho"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="provider">Provider</FieldLabel>
          <Input
            id="provider"
            name="provider"
            defaultValue={coffee?.provider}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="provider-url">Provider URL</FieldLabel>
          <Input
            id="provider-url"
            name="providerUrl"
            type="url"
            defaultValue={coffee?.providerUrl}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="purchase-reference">
            Purchase reference
          </FieldLabel>
          <Input
            id="purchase-reference"
            name="purchaseReference"
            defaultValue={coffee?.purchaseReference}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="purchased-at">Purchased</FieldLabel>
          <Input
            id="purchased-at"
            name="purchasedAt"
            type="date"
            defaultValue={dateInput(coffee?.purchasedAt)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="purchased-mass">Purchased · g</FieldLabel>
          <Input
            id="purchased-mass"
            name="purchasedMass"
            type="number"
            min="0"
            step="1"
            defaultValue={(coffee?.purchasedMassMg ?? 0) / 1_000}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="remaining-mass">Green remaining · g</FieldLabel>
          <Input
            id="remaining-mass"
            name="remainingMass"
            type="number"
            min="0"
            step="1"
            defaultValue={(coffee?.remainingMassMg ?? 0) / 1_000}
          />
          <FieldDescription>Update when inventory changes.</FieldDescription>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="country">Country</FieldLabel>
          <Input id="country" name="country" defaultValue={coffee?.country} />
        </Field>
        <Field>
          <FieldLabel htmlFor="region">Region</FieldLabel>
          <Input id="region" name="region" defaultValue={coffee?.region} />
        </Field>
        <Field>
          <FieldLabel htmlFor="farm">Farm</FieldLabel>
          <Input id="farm" name="farm" defaultValue={coffee?.farm} />
        </Field>
        <Field>
          <FieldLabel htmlFor="producer">Producer</FieldLabel>
          <Input
            id="producer"
            name="producer"
            defaultValue={coffee?.producer}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="process">Process</FieldLabel>
          <Input id="process" name="process" defaultValue={coffee?.process} />
        </Field>
        <Field>
          <FieldLabel htmlFor="variety">Variety</FieldLabel>
          <Input id="variety" name="variety" defaultValue={coffee?.variety} />
        </Field>
        <Field>
          <FieldLabel htmlFor="harvest">Harvest</FieldLabel>
          <Input id="harvest" name="harvest" defaultValue={coffee?.harvest} />
        </Field>
        <Field>
          <FieldLabel htmlFor="storage">Storage</FieldLabel>
          <Input
            id="storage"
            name="storageLocation"
            defaultValue={coffee?.storageLocation}
          />
        </Field>
      </div>
    </FieldGroup>
  )
}

export function CoffeeCatalogScreen() {
  const search = useSearch({ from: "/coffees" })
  const navigate = useNavigate({ from: "/coffees" })
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [noteBody, setNoteBody] = useState("")
  const coffees = useQuery({
    queryKey: queryKeys.coffees(search.q),
    queryFn: ({ signal }) => listCoffees(search.q, signal),
  })
  const selected = coffees.data?.find((coffee) => coffee.id === search.coffeeId)
  const updateSearch = (patch: Partial<typeof search>, replace = true) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace,
    })
  const notes = useQuery({
    queryKey: queryKeys.notes("coffee", selected?.id),
    queryFn: ({ signal }) => listNotes("coffee", selected!.id, signal),
    enabled: selected != null,
  })
  const createMutation = useMutation({
    mutationFn: createCoffee,
    onSuccess: (coffee) => {
      toast.success(`Coffee #${coffee.id} saved`)
      setCreateOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["coffees"] })
      updateSearch({ coffeeId: coffee.id }, false)
    },
    onError: (error) => toast.error(error.message),
  })
  const editMutation = useMutation({
    mutationFn: (body: CoffeeCreate) =>
      updateCoffee(selected!.id, selected!.revision, body),
    onSuccess: () => {
      toast.success("Coffee updated")
      void queryClient.invalidateQueries({ queryKey: ["coffees"] })
    },
    onError: (error) => toast.error(error.message),
  })
  const noteMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      toast.success("Note saved")
      setNoteBody("")
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notes("coffee", selected?.id),
      })
    },
    onError: (error) => toast.error(error.message),
  })
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
        <button
          type="button"
          className="text-left font-medium underline-offset-4 hover:underline"
          onClick={() => updateSearch({ coffeeId: row.original.id }, false)}
        >
          #{row.original.id} · {row.original.name}
        </button>
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
          <Sheet open={createOpen} onOpenChange={setCreateOpen}>
            <SheetTrigger
              render={
                <Button>
                  <PlusIcon data-icon="inline-start" />
                  Add coffee
                </Button>
              }
            />
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Add green coffee</SheetTitle>
                <SheetDescription>
                  Record only what you know now; every field can be completed
                  later.
                </SheetDescription>
              </SheetHeader>
              <form
                id="new-coffee-form"
                className="px-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  createMutation.mutate(
                    coffeeBody(new FormData(event.currentTarget))
                  )
                }}
              >
                <CoffeeFields />
              </form>
              <SheetFooter>
                <Button
                  type="submit"
                  form="new-coffee-form"
                  disabled={createMutation.isPending}
                >
                  <SaveIcon data-icon="inline-start" />
                  Save coffee
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
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
          </Empty>
        )}
      </div>

      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) updateSearch({ coffeeId: undefined })
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {selected ? `#${selected.id} · ${selected.name}` : "Coffee"}
            </SheetTitle>
            <SheetDescription>
              Edit its catalog and inventory details, or add observations below.
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <>
              <form
                id="edit-coffee-form"
                className="px-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  editMutation.mutate(
                    coffeeBody(new FormData(event.currentTarget))
                  )
                }}
              >
                <CoffeeFields
                  key={`${selected.id}-${selected.revision}`}
                  coffee={selected}
                />
              </form>
              <div className="flex flex-col gap-4 px-4">
                <Separator />
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Notes</h3>
                  <Link
                    to="/roasts"
                    search={{
                      coffeeId: selected.id,
                      profileId: undefined,
                      q: undefined,
                      status: undefined,
                      sort: undefined,
                      hidden: undefined,
                      density: undefined,
                      rest: undefined,
                      view: undefined,
                    }}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    {selected.roastCount} roasts
                  </Link>
                </div>
                {notes.data?.map((note) => (
                  <p key={note.id} className="text-sm whitespace-pre-wrap">
                    {note.body}
                  </p>
                ))}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const body = noteBody.trim()
                    if (body)
                      noteMutation.mutate({
                        kind: "observation",
                        body,
                        source: "user",
                        attributes: {},
                        links: [
                          { resourceType: "coffee", resourceId: selected.id },
                        ],
                      })
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="coffee-note">Add note</FieldLabel>
                      <Textarea
                        id="coffee-note"
                        name="note"
                        value={noteBody}
                        onChange={(event) => setNoteBody(event.target.value)}
                        placeholder="What should you remember about this coffee?"
                      />
                    </Field>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={noteMutation.isPending}
                    >
                      Save note
                    </Button>
                  </FieldGroup>
                </form>
                <Separator />
                <AttachmentPanel
                  resourceType="coffee"
                  resourceId={selected.id}
                  title="Documents & media"
                  compact
                />
              </div>
              <SheetFooter>
                <Button
                  type="submit"
                  form="edit-coffee-form"
                  disabled={editMutation.isPending}
                >
                  <SaveIcon data-icon="inline-start" />
                  Save changes
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
