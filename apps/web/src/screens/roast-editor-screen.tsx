import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { ArrowLeftIcon, SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import {
  getRoast,
  listCoffees,
  listProfiles,
  queryKeys,
  updateRoast,
} from "@/lib/api"

const roastStatusItems = [
  { value: "planned", label: "Planned" },
  { value: "completed", label: "Completed" },
  { value: "interrupted", label: "Interrupted" },
]

const roastResultItems = [
  { value: "success", label: "Success" },
  { value: "aborted", label: "Aborted" },
  { value: "fault", label: "Fault" },
  { value: "unknown", label: "Unknown" },
]

function elapsedInput(value?: number | null) {
  if (value == null) return ""
  const seconds = Math.round(value / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function parseElapsedInput(value: string) {
  const match = /^(\d+):([0-5]\d)$/u.exec(value.trim())
  if (!match) return null
  return (Number(match[1]) * 60 + Number(match[2])) * 1_000
}

function parseSettingsObject(value: string, label: string) {
  const parsed = JSON.parse(value) as unknown
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed
}

function localDateTime(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function RoastEditorScreen() {
  const params = useParams({ from: "/roasts/$roastId/edit" })
  const roastId = Number(params.roastId)
  const navigate = useNavigate({ from: "/roasts/$roastId/edit" })
  const queryClient = useQueryClient()
  const roast = useQuery({
    queryKey: queryKeys.roast(roastId),
    queryFn: ({ signal }) => getRoast(roastId, signal),
  })
  const profiles = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(undefined, signal),
  })
  const coffees = useQuery({
    queryKey: queryKeys.coffees(),
    queryFn: ({ signal }) => listCoffees(undefined, signal),
  })
  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateRoast>[2]) =>
      updateRoast(roastId, roast.data!.revision, input),
    onSuccess: () => {
      toast.success("Roast updated")
      void queryClient.invalidateQueries({ queryKey: queryKeys.roast(roastId) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.roastContext(roastId),
      })
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
      void navigate({
        to: "/roasts/$roastId",
        params: { roastId: String(roastId) },
      })
    },
    onError: (error) => toast.error(error.message),
  })

  if (roast.error) throw roast.error
  if (profiles.error) throw profiles.error
  if (coffees.error) throw coffees.error
  if (roast.isPending || !roast.data) {
    return (
      <div className="p-7">
        <Skeleton className="mx-auto h-[38rem] max-w-6xl rounded-xl" />
      </div>
    )
  }

  const item = roast.data
  const profileItems =
    profiles.data?.map((profile) => ({
      value: String(profile.id),
      label: `#${profile.id} · ${profile.name}`,
    })) ?? []
  const coffeeItems = [
    { value: "none", label: "Unassigned" },
    ...(coffees.data?.map((coffee) => ({
      value: String(coffee.id),
      label: `#${coffee.id} · ${coffee.name}`,
    })) ?? []),
  ]
  const actualFirstCrack =
    item.events.find(
      (event) => event.kind === "first_crack" && event.source === "user"
    ) ?? item.events.find((event) => event.kind === "first_crack")

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const optionalNumber = (name: string) => {
      const value = String(form.get(name) ?? "").trim()
      return value === "" ? null : Number(value)
    }
    const profileId = optionalNumber("profileId")
    const coffeeId = optionalNumber("coffeeId")
    const level = optionalNumber("level")
    const load = optionalNumber("load")
    const roastedYield = optionalNumber("roastedYield")
    const developmentPercent = optionalNumber("developmentPercent")
    const endTemperature = optionalNumber("endTemperature")
    const status = String(form.get("status") ?? item.status)
    const result = String(form.get("result") ?? item.result)
    const roastedAtInput = String(form.get("roastedAt") ?? "")
    const durationInput = String(form.get("duration") ?? "").trim()
    const coolingInput = String(form.get("coolingDuration") ?? "").trim()
    const endReason = String(form.get("endReason") ?? "").trim()
    const patch: Parameters<typeof updateRoast>[2] = {}
    const nextProfileId =
      profileId && Number.isFinite(profileId) ? profileId : null
    const nextCoffeeId = coffeeId && Number.isFinite(coffeeId) ? coffeeId : null
    const nextLevel =
      level != null && Number.isFinite(level) ? Math.round(level * 1_000) : null
    const nextLoad =
      load != null && Number.isFinite(load) ? Math.round(load * 1_000) : null
    const nextYield =
      roastedYield != null && Number.isFinite(roastedYield)
        ? Math.round(roastedYield * 1_000)
        : null
    const nextDevelopment =
      developmentPercent != null && Number.isFinite(developmentPercent)
        ? Math.round(developmentPercent * 100)
        : null
    const nextDuration =
      durationInput === "" ? null : parseElapsedInput(durationInput)
    if (durationInput !== "" && nextDuration == null) {
      toast.error("Roast duration must use m:ss, for example 6:53")
      return
    }
    const nextCoolingDuration =
      coolingInput === "" ? null : parseElapsedInput(coolingInput)
    if (coolingInput !== "" && nextCoolingDuration == null) {
      toast.error("Cooling duration must use m:ss, for example 3:50")
      return
    }
    if (nextCoolingDuration != null && nextDuration == null) {
      toast.error("Set roast duration before cooling duration")
      return
    }
    const nextCooldownEnd =
      nextCoolingDuration == null || nextDuration == null
        ? null
        : nextDuration + nextCoolingDuration
    const nextEndTemperature =
      endTemperature != null && Number.isFinite(endTemperature)
        ? Math.round(endTemperature * 1_000)
        : null
    if (nextProfileId !== (item.profile?.id ?? null))
      patch.profileId = nextProfileId
    if (nextCoffeeId !== (item.coffee?.id ?? null))
      patch.coffeeId = nextCoffeeId
    if (nextLevel !== item.levelThousandths) patch.levelThousandths = nextLevel
    if (nextLoad !== item.greenInputMassMg) patch.greenInputMassMg = nextLoad
    if (nextYield !== item.roastedYieldMassMg)
      patch.roastedYieldMassMg = nextYield
    if (nextDevelopment !== item.developmentBasisPoints) {
      patch.developmentBasisPoints = nextDevelopment
    }
    if (nextDuration !== item.durationMs) patch.durationMs = nextDuration
    if (nextCooldownEnd !== item.cooldownEndMs)
      patch.cooldownEndMs = nextCooldownEnd
    if (nextEndTemperature !== item.endTemperatureMilliC)
      patch.endTemperatureMilliC = nextEndTemperature
    if (endReason !== item.endReason) patch.endReason = endReason
    if (status !== item.status) patch.status = status
    if (result !== item.result) patch.result = result
    if (roastedAtInput !== localDateTime(item.roastedAt)) {
      patch.roastedAt = roastedAtInput
        ? new Date(roastedAtInput).toISOString()
        : null
      patch.sourceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }

    const firstCrackInput = String(form.get("firstCrack") ?? "").trim()
    const firstCrackTemperature = optionalNumber("firstCrackTemperature")
    if (firstCrackInput === "") {
      if (actualFirstCrack?.source === "user") patch.firstCrack = null
    } else {
      const elapsedMs = parseElapsedInput(firstCrackInput)
      if (elapsedMs == null) {
        toast.error("First crack time must use m:ss, for example 6:20")
        return
      }
      const temperatureMilliC =
        firstCrackTemperature != null && Number.isFinite(firstCrackTemperature)
          ? Math.round(firstCrackTemperature * 1_000)
          : null
      if (
        elapsedMs !== actualFirstCrack?.elapsedMs ||
        temperatureMilliC !== (actualFirstCrack?.temperatureMilliC ?? null)
      ) {
        patch.firstCrack = { elapsedMs, temperatureMilliC }
      }
    }

    try {
      const adjustments = parseSettingsObject(
        String(form.get("adjustments") ?? "{}"),
        "Adjustments"
      )
      const roasterParameters = parseSettingsObject(
        String(form.get("roasterParameters") ?? "{}"),
        "Roaster parameters"
      )
      if (JSON.stringify(adjustments) !== JSON.stringify(item.adjustments)) {
        patch.adjustments = adjustments
      }
      if (
        JSON.stringify(roasterParameters) !==
        JSON.stringify(item.roasterParameters)
      ) {
        patch.roasterParameters = roasterParameters
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid settings")
      return
    }

    if (Object.keys(patch).length === 0) {
      toast.info("No roast changes to save")
      return
    }
    save.mutate(patch)
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={`Roast #${item.id}`}
        title="Edit roast"
        description="Update recorded details and milestones without changing imported telemetry."
        actions={
          <>
            <Link
              to="/roasts/$roastId"
              params={{ roastId: String(item.id) }}
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Roast
            </Link>
            <Button
              type="submit"
              form="roast-editor-form"
              disabled={save.isPending}
            >
              <SaveIcon data-icon="inline-start" />
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-7 sm:py-6">
        <form
          id="roast-editor-form"
          key={`${item.id}-${item.revision}`}
          onSubmit={submit}
          className="flex flex-col gap-5"
        >
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Roast</h2>
                </CardTitle>
                <CardDescription>
                  Identity, timing, and outcome.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="roastedAt">Roasted at</FieldLabel>
                    <Input
                      id="roastedAt"
                      name="roastedAt"
                      type="datetime-local"
                      defaultValue={localDateTime(item.roastedAt)}
                    />
                    {!item.roastedAt ? (
                      <FieldDescription>
                        The Nano clock was unavailable; set the local time.
                      </FieldDescription>
                    ) : null}
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="duration">
                        Roast duration · m:ss
                      </FieldLabel>
                      <Input
                        id="duration"
                        name="duration"
                        inputMode="numeric"
                        placeholder="6:53"
                        pattern="[0-9]+:[0-5][0-9]"
                        defaultValue={elapsedInput(item.durationMs)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="endTemperature">
                        End temperature · °C
                      </FieldLabel>
                      <Input
                        id="endTemperature"
                        name="endTemperature"
                        type="number"
                        min="-100"
                        max="500"
                        step="0.1"
                        defaultValue={
                          item.endTemperatureMilliC == null
                            ? ""
                            : item.endTemperatureMilliC / 1_000
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coolingDuration">
                        Cooling duration · m:ss
                      </FieldLabel>
                      <Input
                        id="coolingDuration"
                        name="coolingDuration"
                        inputMode="numeric"
                        placeholder="3:50"
                        pattern="[0-9]+:[0-5][0-9]"
                        defaultValue={
                          item.cooldownEndMs == null || item.durationMs == null
                            ? ""
                            : elapsedInput(item.cooldownEndMs - item.durationMs)
                        }
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="endReason">End reason</FieldLabel>
                    <Input
                      id="endReason"
                      name="endReason"
                      maxLength={200}
                      placeholder="0:level"
                      defaultValue={item.endReason}
                    />
                    <FieldDescription>
                      Use 0:level for a normal automatic transition to cooling at
                      the selected roast level.
                    </FieldDescription>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="status">Status</FieldLabel>
                      <Select
                        items={roastStatusItems}
                        name="status"
                        defaultValue={item.status}
                      >
                        <SelectTrigger id="status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {roastStatusItems.map((entry) => (
                              <SelectItem key={entry.value} value={entry.value}>
                                {entry.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="result">Result</FieldLabel>
                      <Select
                        items={roastResultItems}
                        name="result"
                        defaultValue={item.result}
                      >
                        <SelectTrigger id="result" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {roastResultItems.map((entry) => (
                              <SelectItem key={entry.value} value={entry.value}>
                                {entry.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="profileId">Profile</FieldLabel>
                    <Select
                      items={profileItems}
                      name="profileId"
                      defaultValue={String(item.profile?.id ?? "")}
                    >
                      <SelectTrigger id="profileId" className="w-full">
                        <SelectValue placeholder="Select profile" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {profileItems.map((entry) => (
                            <SelectItem key={entry.value} value={entry.value}>
                              {entry.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="coffeeId">Coffee</FieldLabel>
                    <Select
                      items={coffeeItems}
                      name="coffeeId"
                      defaultValue={String(item.coffee?.id ?? "none")}
                    >
                      <SelectTrigger id="coffeeId" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {coffeeItems.map((entry) => (
                            <SelectItem key={entry.value} value={entry.value}>
                              {entry.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Measurements</h2>
                </CardTitle>
                <CardDescription>
                  Roast level, input, and finished yield.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="level">Level</FieldLabel>
                      <Input
                        id="level"
                        name="level"
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        defaultValue={
                          item.levelThousandths == null
                            ? ""
                            : item.levelThousandths / 1_000
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="load">Green load · g</FieldLabel>
                      <Input
                        id="load"
                        name="load"
                        type="number"
                        min="0.1"
                        step="0.1"
                        defaultValue={
                          item.greenInputMassMg == null
                            ? ""
                            : item.greenInputMassMg / 1_000
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="roastedYield">
                        Roasted yield · g
                      </FieldLabel>
                      <Input
                        id="roastedYield"
                        name="roastedYield"
                        type="number"
                        min="0.1"
                        max={
                          item.greenInputMassMg == null
                            ? undefined
                            : item.greenInputMassMg / 1_000
                        }
                        step="0.1"
                        defaultValue={
                          item.roastedYieldMassMg == null
                            ? ""
                            : item.roastedYieldMassMg / 1_000
                        }
                      />
                    </Field>
                  </div>
                </FieldGroup>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Roast milestones</h2>
              </CardTitle>
              <CardDescription>
                User-entered first crack overrides the imported marker without
                changing the original log.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="firstCrack">
                      First crack · m:ss
                    </FieldLabel>
                    <Input
                      id="firstCrack"
                      name="firstCrack"
                      inputMode="numeric"
                      placeholder="6:20"
                      pattern="[0-9]+:[0-5][0-9]"
                      defaultValue={elapsedInput(actualFirstCrack?.elapsedMs)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="firstCrackTemperature">
                      Temperature · °C
                    </FieldLabel>
                    <Input
                      id="firstCrackTemperature"
                      name="firstCrackTemperature"
                      type="number"
                      min="-100"
                      max="500"
                      step="0.1"
                      defaultValue={
                        actualFirstCrack?.temperatureMilliC == null
                          ? ""
                          : actualFirstCrack.temperatureMilliC / 1_000
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="developmentPercent">
                      Development · %
                    </FieldLabel>
                    <Input
                      id="developmentPercent"
                      name="developmentPercent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      defaultValue={
                        item.developmentBasisPoints == null
                          ? ""
                          : item.developmentBasisPoints / 100
                      }
                    />
                    <FieldDescription>
                      Recalculated from first crack when left unchanged.
                    </FieldDescription>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Advanced settings</h2>
              </CardTitle>
              <CardDescription>
                JSON objects retained with this roast record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="adjustments">Adjustments</FieldLabel>
                    <Textarea
                      id="adjustments"
                      name="adjustments"
                      className="min-h-40 font-mono text-xs"
                      defaultValue={JSON.stringify(item.adjustments, null, 2)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="roasterParameters">
                      Roaster parameters
                    </FieldLabel>
                    <Textarea
                      id="roasterParameters"
                      name="roasterParameters"
                      className="min-h-40 font-mono text-xs"
                      defaultValue={JSON.stringify(
                        item.roasterParameters,
                        null,
                        2
                      )}
                    />
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              <SaveIcon data-icon="inline-start" />
              {save.isPending ? "Saving…" : "Save roast"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
