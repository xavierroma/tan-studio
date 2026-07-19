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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tan-studio/ui/components/tabs"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { CoffeeIcon, SaveIcon, Settings2Icon } from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import {
  createBrew,
  getPreferences,
  listBrews,
  queryKeys,
  updatePreferences,
} from "@/lib/api"
import { formatRoastDate } from "@/lib/format"

function grams(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 1_000)
}

export function BrewsScreen() {
  const search = useSearch({ strict: false }) as {
    roastNumber?: number
    tab?: "brew" | "defaults"
  }
  const roastNumber = search.roastNumber
  const tab = search.tab ?? "brew"
  const navigate = useNavigate({ from: "/brews" })
  const queryClient = useQueryClient()
  const preferences = useQuery({
    queryKey: queryKeys.preferences(),
    queryFn: getPreferences,
  })
  const brews = useQuery({
    queryKey: queryKeys.brews(roastNumber),
    queryFn: () => listBrews(roastNumber),
  })
  const createMutation = useMutation({
    mutationFn: createBrew,
    onSuccess: (brew) => {
      toast.success(`Brew #${brew.number} saved`)
      void queryClient.invalidateQueries({ queryKey: ["brews"] })
    },
    onError: (error) => toast.error(error.message),
  })
  const defaultsMutation = useMutation({
    mutationFn: (input: Parameters<typeof updatePreferences>[1]) =>
      updatePreferences(preferences.data!.revision, input),
    onSuccess: () => {
      toast.success("Brew defaults updated")
      void queryClient.invalidateQueries({ queryKey: queryKeys.preferences() })
    },
    onError: (error) => toast.error(error.message),
  })

  const defaults = preferences.data
  const submitBrew = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    createMutation.mutate({
      roastNumber: Number(form.get("roastNumber")),
      method: String(form.get("method") || "V60"),
      grinderName: String(form.get("grinderName") || ""),
      grinderSetting: String(form.get("grinderSetting") || ""),
      kettleName: String(form.get("kettleName") || ""),
      waterName: String(form.get("waterName") || ""),
      coffeeMassMg: grams(form.get("coffeeGrams")),
      waterMassMg: grams(form.get("waterGrams")),
      waterTemperatureMilliC: Math.round(
        Number(form.get("waterTemperature")) * 1_000
      ),
      ...(form.get("score")
        ? { scoreBasisPoints: Math.round(Number(form.get("score")) * 100) }
        : {}),
      tastingNotes: String(form.get("tastingNotes") || ""),
      notes: String(form.get("notes") || ""),
    })
  }

  const submitDefaults = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    defaultsMutation.mutate({
      defaultRoasterName: String(form.get("defaultRoasterName") || ""),
      defaultGrinderName: String(form.get("defaultGrinderName") || ""),
      defaultGrinderSetting: String(form.get("defaultGrinderSetting") || ""),
      defaultKettleName: String(form.get("defaultKettleName") || ""),
      defaultWaterName: String(form.get("defaultWaterName") || ""),
      defaultBrewMethod: String(form.get("defaultBrewMethod") || "V60"),
      defaultCoffeeMassMg: grams(form.get("defaultCoffeeGrams")),
      defaultWaterMassMg: grams(form.get("defaultWaterGrams")),
      defaultWaterTemperatureMilliC: Math.round(
        Number(form.get("defaultWaterTemperature")) * 1_000
      ),
    })
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={roastNumber ? `Roast #${roastNumber}` : "Coffee feedback loop"}
        title="Brews & tastings"
        description="Link every cup back to its roast, recipe, equipment, and tasting result."
        actions={
          roastNumber ? (
            <Link
              to="/roasts/$roastId"
              params={{ roastId: String(roastNumber) }}
              className={buttonVariants({ variant: "outline" })}
            >
              Back to roast #{roastNumber}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <main className="min-w-0">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  tab: value === "defaults" ? "defaults" : undefined,
                }),
                replace: true,
              })
            }}
          >
            <TabsList variant="line">
              <TabsTrigger value="brew">Log a brew</TabsTrigger>
              <TabsTrigger value="defaults">My defaults</TabsTrigger>
            </TabsList>
            <TabsContent value="brew" className="pt-5">
              {!defaults ? (
                <p className="text-muted-foreground text-sm">
                  Loading your defaults…
                </p>
              ) : (
                <form
                  key={`brew-${defaults.revision}-${roastNumber ?? "new"}`}
                  onSubmit={submitBrew}
                  className="bg-card rounded-xl border p-5"
                >
                  <FieldGroup>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="roastNumber">
                          Roast number
                        </FieldLabel>
                        <Input
                          id="roastNumber"
                          name="roastNumber"
                          type="number"
                          min="1"
                          required
                          defaultValue={roastNumber}
                        />
                        <FieldDescription>
                          The short number printed on the bag.
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="method">Method</FieldLabel>
                        <Input
                          id="method"
                          name="method"
                          required
                          defaultValue={defaults.defaultBrewMethod}
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
                          placeholder="86.5"
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="grinderName">Grinder</FieldLabel>
                        <Input
                          id="grinderName"
                          name="grinderName"
                          defaultValue={defaults.defaultGrinderName}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="grinderSetting">
                          Grinder setting
                        </FieldLabel>
                        <Input
                          id="grinderSetting"
                          name="grinderSetting"
                          defaultValue={defaults.defaultGrinderSetting}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="kettleName">Kettle</FieldLabel>
                        <Input
                          id="kettleName"
                          name="kettleName"
                          defaultValue={defaults.defaultKettleName}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="waterName">Water</FieldLabel>
                        <Input
                          id="waterName"
                          name="waterName"
                          defaultValue={defaults.defaultWaterName}
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="coffeeGrams">
                          Coffee · grams
                        </FieldLabel>
                        <Input
                          id="coffeeGrams"
                          name="coffeeGrams"
                          type="number"
                          min="0.1"
                          step="0.1"
                          required
                          defaultValue={defaults.defaultCoffeeMassMg / 1_000}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="waterGrams">
                          Water · grams
                        </FieldLabel>
                        <Input
                          id="waterGrams"
                          name="waterGrams"
                          type="number"
                          min="1"
                          step="1"
                          required
                          defaultValue={defaults.defaultWaterMassMg / 1_000}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="waterTemperature">
                          Water · °C
                        </FieldLabel>
                        <Input
                          id="waterTemperature"
                          name="waterTemperature"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          required
                          defaultValue={
                            defaults.defaultWaterTemperatureMilliC / 1_000
                          }
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="tastingNotes">
                        Tasting notes
                      </FieldLabel>
                      <Textarea
                        id="tastingNotes"
                        name="tastingNotes"
                        placeholder="Aroma, acidity, sweetness, body, finish…"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="notes">Recipe notes</FieldLabel>
                      <Textarea
                        id="notes"
                        name="notes"
                        placeholder="Pour structure, drawdown, changes for next cup…"
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="self-start"
                      disabled={createMutation.isPending}
                    >
                      <SaveIcon data-icon="inline-start" />
                      {createMutation.isPending ? "Saving…" : "Save brew"}
                    </Button>
                  </FieldGroup>
                </form>
              )}
            </TabsContent>
            <TabsContent value="defaults" className="pt-5">
              {!defaults ? null : (
                <form
                  key={`defaults-${defaults.revision}`}
                  onSubmit={submitDefaults}
                  className="bg-card rounded-xl border p-5"
                >
                  <FieldGroup>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        [
                          "defaultRoasterName",
                          "Roaster",
                          defaults.defaultRoasterName,
                        ],
                        [
                          "defaultGrinderName",
                          "Grinder",
                          defaults.defaultGrinderName,
                        ],
                        [
                          "defaultGrinderSetting",
                          "Grinder setting",
                          defaults.defaultGrinderSetting,
                        ],
                        [
                          "defaultKettleName",
                          "Kettle",
                          defaults.defaultKettleName,
                        ],
                        [
                          "defaultWaterName",
                          "Water",
                          defaults.defaultWaterName,
                        ],
                        [
                          "defaultBrewMethod",
                          "Brew method",
                          defaults.defaultBrewMethod,
                        ],
                      ].map(([name, label, value]) => (
                        <Field key={name}>
                          <FieldLabel htmlFor={name}>{label}</FieldLabel>
                          <Input id={name} name={name} defaultValue={value} />
                        </Field>
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="defaultCoffeeGrams">
                          Coffee · grams
                        </FieldLabel>
                        <Input
                          id="defaultCoffeeGrams"
                          name="defaultCoffeeGrams"
                          type="number"
                          min="0.1"
                          step="0.1"
                          defaultValue={defaults.defaultCoffeeMassMg / 1_000}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="defaultWaterGrams">
                          Water · grams
                        </FieldLabel>
                        <Input
                          id="defaultWaterGrams"
                          name="defaultWaterGrams"
                          type="number"
                          min="1"
                          defaultValue={defaults.defaultWaterMassMg / 1_000}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="defaultWaterTemperature">
                          Water · °C
                        </FieldLabel>
                        <Input
                          id="defaultWaterTemperature"
                          name="defaultWaterTemperature"
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
                    <Button
                      type="submit"
                      className="self-start"
                      disabled={defaultsMutation.isPending}
                    >
                      <Settings2Icon data-icon="inline-start" />
                      Save my defaults
                    </Button>
                  </FieldGroup>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </main>

        <aside className="min-w-0">
          <section className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold">
              {roastNumber
                ? `Brews from roast #${roastNumber}`
                : "Recent brews"}
            </h2>
            <div className="mt-4 space-y-3">
              {(brews.data ?? []).length === 0 ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CoffeeIcon />
                    </EmptyMedia>
                    <EmptyTitle>No brews logged yet</EmptyTitle>
                    <EmptyDescription>
                      Scan a roast label or enter its short number to begin.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                brews.data?.map((brew) => {
                  const date = formatRoastDate(brew.brewedAt)
                  return (
                    <article key={brew.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">Brew #{brew.number}</p>
                          <p className="text-muted-foreground text-xs">
                            Roast #{brew.roastNumber} · {date.date} {date.time}
                          </p>
                        </div>
                        <Badge variant="secondary">{brew.method}</Badge>
                      </div>
                      <p className="mt-2 text-sm">
                        {(brew.coffeeMassMg / 1_000).toFixed(1)} g →{" "}
                        {(brew.waterMassMg / 1_000).toFixed(0)} g · 1:
                        {brew.ratio.toFixed(1)}
                      </p>
                      <p className="text-muted-foreground mt-2 text-sm">
                        {brew.tastingNotes || "No tasting notes yet."}
                      </p>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
