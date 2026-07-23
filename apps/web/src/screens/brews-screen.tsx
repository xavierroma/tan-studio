import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
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
import { Textarea } from "@tan-studio/ui/components/textarea"
import { SaveIcon, SettingsIcon } from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { AttachmentPanel } from "@/components/attachment-panel"
import { BrewDataTable } from "@/components/brew-data-table"
import {
  createBrew,
  getSettings,
  listBrews,
  listRoasts,
  queryKeys,
} from "@/lib/api"

function mg(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 1_000)
}

export function BrewsScreen() {
  const search = useSearch({ from: "/brews" })
  const navigate = useNavigate({ from: "/brews" })
  const queryClient = useQueryClient()
  const updateSearch = (patch: Partial<typeof search>, replace = true) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace,
    })
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => getSettings(signal),
  })
  const roasts = useQuery({
    queryKey: queryKeys.roasts(),
    queryFn: ({ signal }) => listRoasts({}, signal),
  })
  const brews = useQuery({
    queryKey: queryKeys.brews(search.roastId),
    queryFn: ({ signal }) => listBrews(search.roastId, signal),
  })
  const createMutation = useMutation({
    mutationFn: createBrew,
    onSuccess: (brew) => {
      toast.success(`Brew #${brew.id} saved`)
      void queryClient.invalidateQueries({ queryKey: ["brews"] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.pantry() })
    },
    onError: (error) => toast.error(error.message),
  })
  if (settings.error) throw settings.error
  if (brews.error) throw brews.error

  const submitBrew = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    createMutation.mutate({
      roastId: Number(form.get("roastId")),
      brewedAt: null,
      sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      method: String(form.get("method") ?? "V60"),
      grinder: String(form.get("grinder") ?? ""),
      grinderSetting: String(form.get("grinderSetting") ?? ""),
      kettle: String(form.get("kettle") ?? ""),
      water: String(form.get("water") ?? ""),
      coffeeMassMg: mg(form.get("coffeeMass")),
      waterMassMg: mg(form.get("waterMass")),
      waterTemperatureMilliC: mg(form.get("temperature")),
      recipe: { technique: String(form.get("technique") ?? "") },
      note: String(form.get("note") ?? "") || null,
      ratingBasisPoints: form.get("score")
        ? Math.round(Number(form.get("score")) * 100)
        : null,
    })
  }
  const defaults = settings.data
  const roastItems =
    roasts.data?.map((roast) => ({
      value: String(roast.id),
      label: `#${roast.id} · ${roast.coffee?.name ?? "Unassigned coffee"}`,
    })) ?? []
  const selectedBrew = brews.data?.find((brew) => brew.id === search.brewId)
  return (
    <div className="min-h-screen">
      <PageHeader
        title="Brews"
        actions={
          <>
            <Link
              to="/settings"
              search={{ section: undefined }}
              className={buttonVariants({ variant: "outline" })}
            >
              <SettingsIcon data-icon="inline-start" />
              Brew settings
            </Link>
            {search.roastId ? (
              <Link
                to="/roasts/$roastId"
                params={{ roastId: String(search.roastId) }}
                className={buttonVariants({ variant: "outline" })}
              >
                Back to roast #{search.roastId}
              </Link>
            ) : null}
          </>
        }
      />
      <div className="px-3 py-4 sm:px-7 sm:py-6">
        {defaults ? (
          <div className="flex flex-col gap-6">
            <form
              key={`${defaults.revision}-${search.roastId ?? "none"}`}
              onSubmit={submitBrew}
              className="bg-card max-w-4xl rounded-xl border p-4 sm:p-5"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="brew-roast">Roast</FieldLabel>
                  <Select
                    items={roastItems}
                    name="roastId"
                    required
                    value={search.roastId ? String(search.roastId) : undefined}
                    onValueChange={(value) =>
                      value &&
                      updateSearch(
                        {
                          roastId: Number(value),
                          brewId: undefined,
                        },
                        false
                      )
                    }
                  >
                    <SelectTrigger id="brew-roast" className="w-full">
                      <SelectValue placeholder="Choose the roast or scan its label" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {roastItems.map((roast) => (
                          <SelectItem key={roast.value} value={roast.value}>
                            {roast.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="method">Method</FieldLabel>
                    <Input
                      id="method"
                      name="method"
                      defaultValue={defaults.defaultBrewMethod}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="coffee-mass">Coffee · g</FieldLabel>
                    <Input
                      id="coffee-mass"
                      name="coffeeMass"
                      type="number"
                      min="0.1"
                      step="0.1"
                      defaultValue={defaults.defaultCoffeeMassMg / 1_000}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="water-mass">Water · g</FieldLabel>
                    <Input
                      id="water-mass"
                      name="waterMass"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={defaults.defaultWaterMassMg / 1_000}
                      required
                    />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="grinder">Grinder</FieldLabel>
                    <Input
                      id="grinder"
                      name="grinder"
                      defaultValue={defaults.defaultGrinder}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="grind-setting">Setting</FieldLabel>
                    <Input
                      id="grind-setting"
                      name="grinderSetting"
                      defaultValue={defaults.defaultGrinderSetting}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="temperature">Water · °C</FieldLabel>
                    <Input
                      id="temperature"
                      name="temperature"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      defaultValue={
                        defaults.defaultWaterTemperatureMilliC / 1_000
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="kettle">Kettle</FieldLabel>
                    <Input
                      id="kettle"
                      name="kettle"
                      defaultValue={defaults.defaultKettle}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="water">Water</FieldLabel>
                    <Input
                      id="water"
                      name="water"
                      defaultValue={defaults.defaultWater}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="technique">Technique</FieldLabel>
                  <Input
                    id="technique"
                    name="technique"
                    placeholder="Bloom 45 s, then three pulses"
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                  <Field>
                    <FieldLabel htmlFor="brew-note">Tasting note</FieldLabel>
                    <Textarea
                      id="brew-note"
                      name="note"
                      placeholder="Bright acidity, clean finish; grind slightly finer next time."
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
                </div>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || !search.roastId}
                >
                  <SaveIcon data-icon="inline-start" />
                  Save brew
                </Button>
              </FieldGroup>
            </form>
            <section>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-semibold">Brew history</h2>
                {search.roastId ? (
                  <span className="text-muted-foreground text-sm">
                    Roast #{search.roastId}
                  </span>
                ) : null}
              </div>
              <BrewDataTable
                data={brews.data ?? []}
                search={{
                  q: search.q,
                  method: search.method,
                  sort: search.sort,
                  hidden: search.hidden,
                  density: search.density,
                }}
                updateSearch={updateSearch}
                onAttach={(brew) => updateSearch({ brewId: brew.id }, false)}
              />
              {selectedBrew ? (
                <div className="bg-card mt-4 rounded-xl border p-5">
                  <AttachmentPanel
                    resourceType="brew"
                    resourceId={selectedBrew.id}
                    title={`Brew #${selectedBrew.id} photos`}
                    compact
                  />
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}
