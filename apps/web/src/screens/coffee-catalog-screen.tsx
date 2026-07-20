import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tan-studio/ui/components/table"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { BeanIcon, PlusIcon, SaveIcon, SearchIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { AttachmentPanel } from "@/components/attachment-panel"
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
      void navigate({ search: { q: search.q, coffeeId: coffee.id } })
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

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Coffees"
        description="One flat record per purchased green coffee: provider, origin, process, and remaining inventory."
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
      <div className="flex flex-col gap-5 px-5 py-6 sm:px-7">
        <Field className="max-w-xl">
          <FieldLabel htmlFor="coffee-search" className="sr-only">
            Search coffees
          </FieldLabel>
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="coffee-search"
              className="pl-9"
              value={search.q ?? ""}
              onChange={(event) =>
                void navigate({
                  search: {
                    q: event.target.value || undefined,
                    coffeeId: undefined,
                  },
                  replace: true,
                })
              }
              placeholder="Coffee, provider, country, farm, process…"
            />
          </div>
        </Field>
        {coffees.data?.length ? (
          <div className="bg-card overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Coffee</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead>Green remaining</TableHead>
                  <TableHead>Roasts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coffees.data.map((coffee) => (
                  <TableRow
                    key={coffee.id}
                    onClick={() =>
                      void navigate({
                        search: { q: search.q, coffeeId: coffee.id },
                      })
                    }
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">
                      #{coffee.id} · {coffee.name}
                    </TableCell>
                    <TableCell>{coffee.provider || "—"}</TableCell>
                    <TableCell>
                      {[coffee.country, coffee.region, coffee.farm]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell>{coffee.process || "—"}</TableCell>
                    <TableCell>
                      {(coffee.remainingMassMg / 1_000).toLocaleString()} g
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{coffee.roastCount}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
          if (!open)
            void navigate({ search: { q: search.q, coffeeId: undefined } })
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
