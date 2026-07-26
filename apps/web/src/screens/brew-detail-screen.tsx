import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@tan-studio/ui/components/field"
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tan-studio/ui/components/sheet"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { ArrowLeftIcon, PencilIcon, SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { AttachmentPanel } from "@/components/attachment-panel"
import { EntityImage } from "@/components/entity-image"
import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import {
  createNote,
  getBrew,
  listRoasts,
  queryKeys,
  updateBrew,
  type BrewPatch,
} from "@/lib/api"

function localDateTime(value: string) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function grams(value: number) {
  return `${(value / 1_000).toLocaleString()} g`
}

function technique(recipe: unknown) {
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return ""
  const value = (recipe as Record<string, unknown>).technique
  return typeof value === "string" ? value : ""
}

function recipeWithTechnique(recipe: unknown, value: string) {
  const base =
    recipe && typeof recipe === "object" && !Array.isArray(recipe)
      ? (recipe as Record<string, unknown>)
      : {}
  return { ...base, technique: value }
}

export function BrewDetailScreen() {
  const params = useParams({ from: "/brews/$brewId" })
  const brewId = Number(params.brewId)
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [noteBody, setNoteBody] = useState("")
  const brew = useQuery({
    queryKey: queryKeys.brew(brewId),
    queryFn: ({ signal }) => getBrew(brewId, signal),
  })
  const roasts = useQuery({
    queryKey: queryKeys.roasts(),
    queryFn: ({ signal }) => listRoasts({}, signal),
  })
  const edit = useMutation({
    mutationFn: (input: BrewPatch) =>
      updateBrew(brewId, brew.data!.revision, input),
    onSuccess: (updated) => {
      toast.success(`Brew #${updated.id} updated`)
      setEditOpen(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.brew(brewId) })
      void queryClient.invalidateQueries({ queryKey: ["brews"] })
      void queryClient.invalidateQueries({ queryKey: ["roast"] })
      void queryClient.invalidateQueries({ queryKey: ["roast-context"] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.pantry() })
    },
    onError: (error) => toast.error(error.message),
  })
  const addNote = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      toast.success("Note saved")
      setNoteBody("")
      void queryClient.invalidateQueries({ queryKey: queryKeys.brew(brewId) })
      void queryClient.invalidateQueries({ queryKey: ["brews"] })
    },
    onError: (error) => toast.error(error.message),
  })

  if (brew.error) throw brew.error
  if (roasts.error) throw roasts.error
  if (brew.isPending || !brew.data) {
    return (
      <div className="p-3 sm:p-7">
        <Skeleton className="h-[38rem] rounded-xl" />
      </div>
    )
  }

  const item = brew.data
  const roast = roasts.data?.find((candidate) => candidate.id === item.roastId)
  const roastItems =
    roasts.data?.map((candidate) => ({
      value: String(candidate.id),
      label: `#${candidate.id} · ${candidate.coffee?.name ?? "Unassigned coffee"} · ${candidate.profile?.name ?? "No profile"}`,
    })) ?? []

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const brewedAt = String(form.get("brewedAt") ?? "")
    const temperature = String(form.get("temperature") ?? "").trim()
    edit.mutate({
      roastId: Number(form.get("roastId")),
      brewedAt: new Date(brewedAt).toISOString(),
      sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      method: String(form.get("method") ?? "").trim(),
      grinder: String(form.get("grinder") ?? "").trim(),
      grinderSetting: String(form.get("grinderSetting") ?? "").trim(),
      kettle: String(form.get("kettle") ?? "").trim(),
      water: String(form.get("water") ?? "").trim(),
      coffeeMassMg: Math.round(Number(form.get("coffeeMass")) * 1_000),
      waterMassMg: Math.round(Number(form.get("waterMass")) * 1_000),
      waterTemperatureMilliC:
        temperature === "" ? null : Math.round(Number(temperature) * 1_000),
      recipe: recipeWithTechnique(
        item.recipe,
        String(form.get("technique") ?? "").trim()
      ),
    })
  }

  const submitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = noteBody.trim()
    if (!body) return
    const score = String(form.get("score") ?? "").trim()
    addNote.mutate({
      kind: "tasting",
      body,
      ratingBasisPoints: score === "" ? null : Math.round(Number(score) * 100),
      source: "user",
      attributes: {},
      links: [
        { resourceType: "brew", resourceId: item.id },
        { resourceType: "roast", resourceId: item.roastId },
      ],
    })
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat(undefined, {
          dateStyle: "long",
          timeStyle: "short",
        }).format(new Date(item.brewedAt))}
        title={`Brew #${item.id}`}
        description={`${item.method} · Roast #${item.roastId}`}
        actions={
          <>
            <Link
              to="/brews"
              search={{
                roastId: undefined,
                brewId: undefined,
                tab: undefined,
                q: undefined,
                method: undefined,
                sort: undefined,
                hidden: undefined,
                density: undefined,
              }}
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Brews
            </Link>
            <Sheet open={editOpen} onOpenChange={setEditOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline">
                    <PencilIcon data-icon="inline-start" />
                    Edit
                  </Button>
                }
              />
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Edit brew #{item.id}</SheetTitle>
                </SheetHeader>
                <form
                  key={item.revision}
                  id="edit-brew-form"
                  onSubmit={submitEdit}
                  className="px-4"
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="brewedAt">Brewed at</FieldLabel>
                      <Input
                        id="brewedAt"
                        name="brewedAt"
                        type="datetime-local"
                        defaultValue={localDateTime(item.brewedAt)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="brew-roast">Roast</FieldLabel>
                      <Select
                        items={roastItems}
                        name="roastId"
                        defaultValue={String(item.roastId)}
                        required
                      >
                        <SelectTrigger id="brew-roast" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {roastItems.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="method">Method</FieldLabel>
                        <Input
                          id="method"
                          name="method"
                          defaultValue={item.method}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="temperature">
                          Water · °C
                        </FieldLabel>
                        <Input
                          id="temperature"
                          name="temperature"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          defaultValue={
                            item.waterTemperatureMilliC == null
                              ? ""
                              : item.waterTemperatureMilliC / 1_000
                          }
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="coffeeMass">Coffee · g</FieldLabel>
                        <Input
                          id="coffeeMass"
                          name="coffeeMass"
                          type="number"
                          min="0.1"
                          step="0.1"
                          defaultValue={item.coffeeMassMg / 1_000}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="waterMass">Water · g</FieldLabel>
                        <Input
                          id="waterMass"
                          name="waterMass"
                          type="number"
                          min="0.1"
                          step="0.1"
                          defaultValue={item.waterMassMg / 1_000}
                          required
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="grinder">Grinder</FieldLabel>
                        <Input
                          id="grinder"
                          name="grinder"
                          defaultValue={item.grinder}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="grinderSetting">
                          Setting
                        </FieldLabel>
                        <Input
                          id="grinderSetting"
                          name="grinderSetting"
                          defaultValue={item.grinderSetting}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="kettle">Kettle</FieldLabel>
                        <Input
                          id="kettle"
                          name="kettle"
                          defaultValue={item.kettle}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="water">Water</FieldLabel>
                        <Input
                          id="water"
                          name="water"
                          defaultValue={item.water}
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="technique">Technique</FieldLabel>
                      <Input
                        id="technique"
                        name="technique"
                        defaultValue={technique(item.recipe)}
                      />
                    </Field>
                  </FieldGroup>
                </form>
                <SheetFooter>
                  <Button
                    type="submit"
                    form="edit-brew-form"
                    disabled={edit.isPending}
                  >
                    <SaveIcon data-icon="inline-start" />
                    Save brew
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </>
        }
      />

      <div className="grid gap-6 px-3 py-4 sm:px-7 sm:py-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="min-w-0 space-y-6">
          <section className="bg-card flex items-center gap-5 rounded-xl border p-5">
            <EntityImage
              attachmentId={item.profileImageAttachmentId}
              entityType="brew"
              alt={`Brew #${item.id}`}
              className="size-28 rounded-xl sm:size-36"
            />
            <div className="min-w-0">
              <p className="text-muted-foreground text-sm">Brew #{item.id}</p>
              <h2 className="mt-1 text-xl font-semibold">{item.method}</h2>
              <Link
                to="/roasts/$roastId"
                params={{ roastId: String(item.roastId) }}
                className="text-muted-foreground mt-2 inline-block underline-offset-4 hover:underline"
              >
                Roast #{item.roastId}
                {roast?.coffee?.name ? ` · ${roast.coffee.name}` : ""}
              </Link>
            </div>
          </section>

          <section
            className="bg-card grid grid-cols-2 gap-5 rounded-xl border p-5 sm:grid-cols-3"
            aria-label="Brew summary"
          >
            <Metric label="Coffee" value={grams(item.coffeeMassMg)} />
            <Metric label="Water" value={grams(item.waterMassMg)} />
            <Metric
              label="Ratio"
              value={`1:${(item.waterMassMg / item.coffeeMassMg).toFixed(1)}`}
            />
            <Metric
              label="Temperature"
              value={
                item.waterTemperatureMilliC == null
                  ? "—"
                  : `${item.waterTemperatureMilliC / 1_000}°C`
              }
            />
            <Metric label="Grinder" value={item.grinder || "—"} />
            <Metric label="Setting" value={item.grinderSetting || "—"} />
          </section>

          {technique(item.recipe) ? (
            <section className="bg-card rounded-xl border p-5">
              <h2 className="font-semibold">Technique</h2>
              <p className="mt-3 text-sm whitespace-pre-wrap">
                {technique(item.recipe)}
              </p>
            </section>
          ) : null}

          <AttachmentPanel
            resourceType="brew"
            resourceId={item.id}
            title="Brew media"
            description="Photos and files from this brew."
          />
        </main>

        <aside className="min-w-0">
          <section className="bg-card rounded-xl border p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Tasting notes</h2>
              <Badge variant="secondary">{item.notes.length}</Badge>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {item.notes.map((note) => (
                <article key={note.id}>
                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                  {note.ratingBasisPoints != null ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Score {(note.ratingBasisPoints / 100).toFixed(2)}
                    </p>
                  ) : null}
                  <Separator className="mt-4" />
                </article>
              ))}
            </div>
            <form onSubmit={submitNote} className="mt-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="brew-note">Add tasting note</FieldLabel>
                  <Textarea
                    id="brew-note"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="score">Score / 100</FieldLabel>
                  <Input
                    id="score"
                    name="score"
                    type="number"
                    min="0"
                    max="100"
                    step="0.25"
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={addNote.isPending || !noteBody.trim()}
                >
                  <SaveIcon data-icon="inline-start" />
                  Save note
                </Button>
              </FieldGroup>
            </form>
          </section>
        </aside>
      </div>
    </div>
  )
}
