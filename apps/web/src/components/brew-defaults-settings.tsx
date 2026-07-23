import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@tan-studio/ui/components/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@tan-studio/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import { getSettings, queryKeys, updateSettings } from "@/lib/api"

function milligrams(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 1_000)
}

export function BrewDefaultsSettings() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => getSettings(signal),
  })
  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof updateSettings>[1]) =>
      updateSettings(settings.data!.revision, body),
    onSuccess: () => {
      toast.success("Brew defaults saved")
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
    onError: (error) => toast.error(error.message),
  })

  if (settings.error) throw settings.error
  if (!settings.data) return null

  const defaults = settings.data
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    mutation.mutate({
      defaultRoaster: String(form.get("roaster") ?? ""),
      defaultGrinder: String(form.get("grinder") ?? ""),
      defaultGrinderSetting: String(form.get("grinderSetting") ?? ""),
      defaultKettle: String(form.get("kettle") ?? ""),
      defaultWater: String(form.get("water") ?? ""),
      defaultBrewMethod: String(form.get("method") ?? "V60"),
      defaultCoffeeMassMg: milligrams(form.get("coffeeMass")),
      defaultWaterMassMg: milligrams(form.get("waterMass")),
      defaultWaterTemperatureMilliC: milligrams(form.get("temperature")),
      defaultRestDays: Number(form.get("restDays")),
      defaultPeakDays: Number(form.get("peakDays")),
    })
  }

  return (
    <form key={defaults.revision} id="brew-defaults-form" onSubmit={submit}>
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>
            <h2>Brewing defaults</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="default-roaster">Roaster</FieldLabel>
                <Input
                  id="default-roaster"
                  name="roaster"
                  defaultValue={defaults.defaultRoaster}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-method">Method</FieldLabel>
                <Input
                  id="default-method"
                  name="method"
                  defaultValue={defaults.defaultBrewMethod}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-grinder">Grinder</FieldLabel>
                <Input
                  id="default-grinder"
                  name="grinder"
                  defaultValue={defaults.defaultGrinder}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-setting">
                  Grinder setting
                </FieldLabel>
                <Input
                  id="default-setting"
                  name="grinderSetting"
                  defaultValue={defaults.defaultGrinderSetting}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-kettle">Kettle</FieldLabel>
                <Input
                  id="default-kettle"
                  name="kettle"
                  defaultValue={defaults.defaultKettle}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-water">Water</FieldLabel>
                <Input
                  id="default-water"
                  name="water"
                  defaultValue={defaults.defaultWater}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="default-coffee">Coffee · g</FieldLabel>
                <Input
                  id="default-coffee"
                  name="coffeeMass"
                  type="number"
                  min="0.1"
                  step="0.1"
                  defaultValue={defaults.defaultCoffeeMassMg / 1_000}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-water-mass">Water · g</FieldLabel>
                <Input
                  id="default-water-mass"
                  name="waterMass"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={defaults.defaultWaterMassMg / 1_000}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="default-temp">Temperature · °C</FieldLabel>
                <Input
                  id="default-temp"
                  name="temperature"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  defaultValue={defaults.defaultWaterTemperatureMilliC / 1_000}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rest-days">Rest days</FieldLabel>
                <Input
                  id="rest-days"
                  name="restDays"
                  type="number"
                  min="1"
                  defaultValue={defaults.defaultRestDays}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="peak-days">Peak through day</FieldLabel>
                <Input
                  id="peak-days"
                  name="peakDays"
                  type="number"
                  min="1"
                  defaultValue={defaults.defaultPeakDays}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={mutation.isPending}>
            <SaveIcon data-icon="inline-start" />
            {mutation.isPending ? "Saving…" : "Save defaults"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
