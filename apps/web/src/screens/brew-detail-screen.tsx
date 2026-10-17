import { Button } from "@tan-studio/ui/components/button"
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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tan-studio/ui/components/sheet"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { PencilIcon, SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"

import {
  BrewHistory,
  CollectionLink,
  NotebookBreadcrumbs,
  NotebookSection,
  ResourceLink,
} from "@/components/notebook"
import { NotebookNotes } from "@/components/notebook-notes"
import { dateText, levelText, massText } from "@/lib/notebook"
import { useNotebookHistory } from "@/lib/notebook-queries"

import { AttachmentPanel } from "@/components/attachment-panel"
import { EntityImage } from "@/components/entity-image"
import { PageHeader } from "@/components/page-header"
import {
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
  const history = useNotebookHistory()
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
  const roast = history.roasts.find(
    (candidate) => candidate.id === item.roastId
  )
  const roastItems =
    history.roasts.map((candidate) => ({
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

  return (
    <div className="min-h-screen">
      <NotebookBreadcrumbs
        items={[
          <CollectionLink type="brew" />,
          ...(roast?.coffee
            ? [
                <ResourceLink type="coffee" id={roast.coffee.id}>
                  {roast.coffee.name}
                </ResourceLink>,
              ]
            : []),
          <ResourceLink type="roast" id={item.roastId}>
            Roast #{item.roastId}
          </ResourceLink>,
          `Brew #${item.id}`,
        ]}
      />
      <PageHeader
        title={`Brew #${item.id} / ${item.method}`}
        image={
          <EntityImage
            attachmentId={item.profileImageAttachmentId}
            entityType="brew"
            alt={`Brew #${item.id}`}
          />
        }
        description={dateText(item.brewedAt, true)}
        actions={
          <>
            <Sheet open={editOpen} onOpenChange={setEditOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline">
                    <PencilIcon data-icon="inline-start" />
                    Edit brew
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
      <div className="notebook-lineage">
        <div>
          <small>Coffee</small>
          {roast?.coffee ? (
            <ResourceLink type="coffee" id={roast.coffee.id}>
              {roast.coffee.name}
            </ResourceLink>
          ) : (
            <span>Unassigned</span>
          )}
        </div>
        <div>
          <small>Roast</small>
          <ResourceLink type="roast" id={item.roastId}>
            #{item.roastId}
            {roast?.roastedAt ? ` · ${dateText(roast.roastedAt)}` : ""}
          </ResourceLink>
          <p>
            {roast?.profile?.name ?? "Profile —"} · Level{" "}
            {levelText(roast?.levelThousandths)}
          </p>
        </div>
      </div>
      <dl className="notebook-facts">
        {[
          ["Coffee dose", massText(item.coffeeMassMg)],
          ["Water in", massText(item.waterMassMg)],
          [
            "Input ratio",
            item.coffeeMassMg > 0
              ? `1 : ${(item.waterMassMg / item.coffeeMassMg).toFixed(1)}`
              : "—",
          ],
          [
            "Water temperature",
            item.waterTemperatureMilliC == null
              ? "—"
              : `${item.waterTemperatureMilliC / 1000}°C`,
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="notebook-columns">
        <NotebookNotes
          type="brew"
          id={item.id}
          roastId={item.roastId}
          notes={item.notes}
          title="Tasting & notes"
        />
        <NotebookSection title="Brew recipe">
          <dl className="notebook-details">
            {[
              ["Method", item.method],
              ["Grinder", item.grinder],
              ["Grind setting", item.grinderSetting],
              ["Kettle", item.kettle],
              ["Water", item.water],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v || "—"}</dd>
              </div>
            ))}
          </dl>
          {technique(item.recipe) ? (
            <p className="notebook-recipe">{technique(item.recipe)}</p>
          ) : null}
        </NotebookSection>
      </div>
      <NotebookSection
        title="Other brews from this roast"
        count={
          history.brews.filter(
            (b) => b.roastId === item.roastId && b.id !== item.id
          ).length
        }
      >
        <BrewHistory
          brews={history.brews.filter(
            (b) => b.roastId === item.roastId && b.id !== item.id
          )}
          roasts={history.roasts}
        />
      </NotebookSection>
      <div className="notebook-section">
        <AttachmentPanel
          resourceType="brew"
          resourceId={item.id}
          title="Images & files"
        />
      </div>
    </div>
  )
}
