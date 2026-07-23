import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tan-studio/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { ArrowLeftIcon, FileIcon, SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { AttachmentPanel } from "@/components/attachment-panel"
import { PageHeader } from "@/components/page-header"
import {
  createCoffee,
  createNote,
  getCoffee,
  listNotes,
  queryKeys,
  updateCoffee,
  uploadAttachment,
  type Coffee,
  type CoffeeCreate,
} from "@/lib/api"

const coffeeListSearch = {
  q: undefined,
  coffeeId: undefined,
  provider: undefined,
  country: undefined,
  process: undefined,
  sort: undefined,
  hidden: undefined,
  density: undefined,
} as const

function grams(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000) : 0
}

function optionalInteger(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function dateInput(value?: string | null) {
  return value ? value.slice(0, 10) : ""
}

function instant(value: FormDataEntryValue | null) {
  const text = String(value ?? "")
  return text ? new Date(`${text}T12:00:00`).toISOString() : null
}

function coffeeBody(form: FormData, coffee?: Coffee): CoffeeCreate {
  return {
    name: String(form.get("name") ?? "").trim(),
    provider: String(form.get("provider") ?? "").trim(),
    providerUrl: String(form.get("providerUrl") ?? "").trim(),
    providerProductId: coffee?.providerProductId ?? "",
    purchaseReference: String(form.get("purchaseReference") ?? "").trim(),
    purchasedAt: instant(form.get("purchasedAt")),
    priceMinor: coffee?.priceMinor ?? null,
    currencyCode: coffee?.currencyCode ?? null,
    purchasedMassMg: grams(form.get("purchasedMass")),
    remainingMassMg: grams(form.get("remainingMass")),
    country: String(form.get("country") ?? "").trim(),
    region: String(form.get("region") ?? "").trim(),
    farm: String(form.get("farm") ?? "").trim(),
    producer: String(form.get("producer") ?? "").trim(),
    washingStation: String(form.get("washingStation") ?? "").trim(),
    process: String(form.get("process") ?? "").trim(),
    variety: String(form.get("variety") ?? "").trim(),
    altitudeMinM: optionalInteger(form.get("altitudeMin")),
    altitudeMaxM: optionalInteger(form.get("altitudeMax")),
    harvest: String(form.get("harvest") ?? "").trim(),
    storageLocation: String(form.get("storageLocation") ?? "").trim(),
    metadata: coffee?.metadata ?? {},
  }
}

function GeneralFields({ coffee }: { coffee?: Coffee | undefined }) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="coffee-name">Coffee name</FieldLabel>
        <Input
          id="coffee-name"
          name="name"
          required
          autoFocus={!coffee}
          defaultValue={coffee?.name}
          placeholder="Ethiopia Hamasho"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="provider">Provider</FieldLabel>
          <Input
            id="provider"
            name="provider"
            defaultValue={coffee?.provider}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="provider-url">Store page</FieldLabel>
          <Input
            id="provider-url"
            name="providerUrl"
            type="url"
            defaultValue={coffee?.providerUrl}
            placeholder="https://…"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
    </FieldGroup>
  )
}

function OriginFields({ coffee }: { coffee?: Coffee | undefined }) {
  return (
    <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-2">
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
        <Field>
          <FieldLabel htmlFor="washing-station">Washing station</FieldLabel>
          <Input
            id="washing-station"
            name="washingStation"
            defaultValue={coffee?.washingStation}
          />
        </Field>
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
          <FieldLabel htmlFor="altitude-min">Altitude from · m</FieldLabel>
          <Input
            id="altitude-min"
            name="altitudeMin"
            type="number"
            min="0"
            step="1"
            defaultValue={coffee?.altitudeMinM ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="altitude-max">Altitude to · m</FieldLabel>
          <Input
            id="altitude-max"
            name="altitudeMax"
            type="number"
            min="0"
            step="1"
            defaultValue={coffee?.altitudeMaxM ?? ""}
          />
        </Field>
      </div>
    </FieldGroup>
  )
}

function InventoryFields({ coffee }: { coffee?: Coffee | undefined }) {
  return (
    <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-3">
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

function NewCoffeeAttachments({
  files,
  onChange,
}: {
  files: File[]
  onChange: (files: File[]) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor="new-coffee-attachments">
        Documents & media
      </FieldLabel>
      <Input
        id="new-coffee-attachments"
        name="attachments"
        type="file"
        multiple
        accept="image/*,video/*,application/pdf,text/plain,text/csv"
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
      />
      <FieldDescription>
        Selected files upload when the coffee is saved.
      </FieldDescription>
      {files.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Selected attachments">
          {files.map((file) => (
            <Badge
              key={`${file.name}-${file.lastModified}`}
              variant="secondary"
            >
              <FileIcon data-icon="inline-start" />
              {file.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </Field>
  )
}

async function attachFiles(coffeeId: number, files: File[]) {
  const results = await Promise.allSettled(
    files.map((file) =>
      uploadAttachment(
        {
          title: file.name,
          sourceUrl: null,
          description: "",
          capturedAt:
            file.lastModified > 0
              ? new Date(file.lastModified).toISOString()
              : null,
          links: [{ resourceType: "coffee", resourceId: coffeeId }],
        },
        file
      )
    )
  )
  return results.filter((result) => result.status === "rejected").length
}

export function CoffeeEditorScreen() {
  const params = useParams({ strict: false }) as { coffeeId?: string }
  const coffeeId = params.coffeeId ? Number(params.coffeeId) : undefined
  const editing = Number.isSafeInteger(coffeeId) && Number(coffeeId) > 0
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [noteBody, setNoteBody] = useState("")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  const coffee = useQuery({
    queryKey: queryKeys.coffee(coffeeId ?? 0),
    queryFn: ({ signal }) => getCoffee(coffeeId!, signal),
    enabled: editing,
  })
  const notes = useQuery({
    queryKey: queryKeys.notes("coffee", coffeeId),
    queryFn: ({ signal }) => listNotes("coffee", coffeeId!, signal),
    enabled: editing,
  })
  const save = useMutation({
    mutationFn: async (body: CoffeeCreate) => {
      if (coffee.data) {
        return {
          coffee: await updateCoffee(
            coffee.data.id,
            coffee.data.revision,
            body
          ),
          attachmentFailures: 0,
        }
      }
      const created = await createCoffee(body)
      return {
        coffee: created,
        attachmentFailures: await attachFiles(created.id, pendingFiles),
      }
    },
    onSuccess: ({ coffee: saved, attachmentFailures }) => {
      queryClient.setQueryData(queryKeys.coffee(saved.id), saved)
      void queryClient.invalidateQueries({ queryKey: ["coffees"] })
      if (attachmentFailures) {
        toast.warning(
          `Coffee saved; ${attachmentFailures} attachment${attachmentFailures === 1 ? "" : "s"} failed`
        )
      } else {
        toast.success(editing ? "Coffee updated" : `Coffee #${saved.id} saved`)
      }
      if (!editing) {
        void navigate({
          to: "/coffees/$coffeeId",
          params: { coffeeId: String(saved.id) },
          replace: true,
        })
      }
    },
    onError: (error) => toast.error(error.message),
  })
  const note = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      toast.success("Note saved")
      setNoteBody("")
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notes("coffee", coffeeId),
      })
    },
    onError: (error) => toast.error(error.message),
  })

  if (coffee.error) throw coffee.error
  if (notes.error) throw notes.error
  if (editing && !coffee.data) return null

  const item = coffee.data
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(coffeeBody(new FormData(event.currentTarget), item))
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        {...(item ? { eyebrow: `Coffee #${item.id}` } : {})}
        title={item?.name ?? "Add coffee"}
        actions={
          <>
            <Link
              to="/coffees"
              search={coffeeListSearch}
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Coffees
            </Link>
            <Button
              type="submit"
              form="coffee-editor-form"
              disabled={save.isPending}
            >
              <SaveIcon data-icon="inline-start" />
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        <form
          id="coffee-editor-form"
          key={item ? `${item.id}-${item.revision}` : "new"}
          onSubmit={submit}
          className="flex flex-col gap-5"
        >
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Coffee</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GeneralFields coffee={item} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Inventory</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InventoryFields coffee={item} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Origin & processing</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OriginFields coffee={item} />
            </CardContent>
          </Card>
          {!item ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Attachments</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <NewCoffeeAttachments
                  files={pendingFiles}
                  onChange={setPendingFiles}
                />
              </CardContent>
            </Card>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              <SaveIcon data-icon="inline-start" />
              {save.isPending ? "Saving…" : "Save coffee"}
            </Button>
          </div>
        </form>

        {item ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Documents & media</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AttachmentPanel
                  resourceType="coffee"
                  resourceId={item.id}
                  compact
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Notes</h2>
                </CardTitle>
                <CardAction>
                  <Link
                    to="/roasts"
                    search={{
                      coffeeId: item.id,
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
                    {item.roastCount} roasts
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {notes.data?.length ? (
                  notes.data.map((entry) => (
                    <p key={entry.id} className="text-sm whitespace-pre-wrap">
                      {entry.body}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">No notes yet.</p>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const body = noteBody.trim()
                    if (!body) return
                    note.mutate({
                      kind: "observation",
                      body,
                      source: "user",
                      attributes: {},
                      links: [{ resourceType: "coffee", resourceId: item.id }],
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
                      />
                    </Field>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={note.isPending}
                    >
                      Save note
                    </Button>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  )
}
