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
import { SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { createBrew, getSettings, listRoasts, queryKeys } from "@/lib/api"

function mg(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 1_000)
}

export function BrewEditorScreen() {
  const search = useSearch({ from: "/brews/new" })
  const navigate = useNavigate({ from: "/brews/new" })
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => getSettings(signal),
  })
  const roasts = useQuery({
    queryKey: queryKeys.roasts(),
    queryFn: ({ signal }) => listRoasts({}, signal),
  })
  const create = useMutation({
    mutationFn: createBrew,
    onSuccess: (brew) => {
      toast.success(`Brew #${brew.id} saved`)
      void queryClient.invalidateQueries({ queryKey: ["brews"] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.pantry() })
      void navigate({
        to: "/brews",
        search: {
          roastId: brew.roastId,
          brewId: brew.id,
          tab: undefined,
          q: undefined,
          method: undefined,
          sort: undefined,
          hidden: undefined,
          density: undefined,
        },
      })
    },
    onError: (error) => toast.error(error.message),
  })
  if (settings.error) throw settings.error
  if (roasts.error) throw roasts.error
  const defaults = settings.data
  const roastItems =
    roasts.data?.map((roast) => ({
      value: String(roast.id),
      label: `#${roast.id} · ${roast.coffee?.name ?? "Unassigned coffee"} · ${roast.profile?.name ?? "No profile"}`,
    })) ?? []

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    create.mutate({
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

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Log brew"
        actions={
          <Link
            to="/brews"
            search={{
              roastId: search.roastId,
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
            Back to brews
          </Link>
        }
      />
      <div className="px-3 py-4 sm:px-7 sm:py-6">
        {defaults ? (
          <form
            onSubmit={submit}
            className="bg-card mx-auto max-w-4xl rounded-xl border p-4 sm:p-6"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="brew-roast">Roast</FieldLabel>
                <Select
                  items={roastItems}
                  name="roastId"
                  required
                  defaultValue={
                    search.roastId ? String(search.roastId) : undefined
                  }
                >
                  <SelectTrigger id="brew-roast" className="w-full">
                    <SelectValue placeholder="Choose a roast" />
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
                    placeholder="Acidity, sweetness, finish, and what to change next."
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
              <Button type="submit" disabled={create.isPending}>
                <SaveIcon data-icon="inline-start" />
                Save brew
              </Button>
            </FieldGroup>
          </form>
        ) : null}
      </div>
    </div>
  )
}
