import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
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
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { Textarea } from "@tan-studio/ui/components/textarea"
import {
  ArrowLeftIcon,
  CoffeeIcon,
  FileTextIcon,
  PencilIcon,
  PrinterIcon,
  SaveIcon,
} from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import { RoastChart } from "@/components/roast-chart"
import { AttachmentPanel } from "@/components/attachment-panel"
import {
  createNote,
  getRoast,
  getRoastContext,
  getRoastSeries,
  listCoffees,
  listProfiles,
  queryKeys,
  updateRoast,
} from "@/lib/api"
import type { ChartPoint } from "@/types"

function chartPoints(
  series: Awaited<ReturnType<typeof getRoastSeries>>
): ChartPoint[] {
  return (
    series?.points.map((point) => ({
      elapsedMs: point.elapsedMs,
      temperatureC: point.temperatureMilliC / 1_000,
      spotTemperatureC:
        point.spotTemperatureMilliC == null
          ? null
          : point.spotTemperatureMilliC / 1_000,
      meanTemperatureC:
        point.meanTemperatureMilliC == null
          ? null
          : point.meanTemperatureMilliC / 1_000,
      profileC:
        point.profileTemperatureMilliC == null
          ? null
          : point.profileTemperatureMilliC / 1_000,
      rorCPerMin:
        point.rorMilliCPerMin == null ? null : point.rorMilliCPerMin / 1_000,
      profileRorCPerMin:
        point.profileRorMilliCPerMin == null
          ? null
          : point.profileRorMilliCPerMin / 1_000,
      desiredRorCPerMin:
        point.desiredRorMilliCPerMin == null
          ? null
          : point.desiredRorMilliCPerMin / 1_000,
      powerKw: point.powerMilliKw == null ? null : point.powerMilliKw / 1_000,
      actualFanRpm: point.actualFanRpm ?? null,
    })) ?? []
  )
}

function grams(value?: number | null) {
  return value == null ? "—" : `${(value / 1_000).toLocaleString()} g`
}
function elapsed(value?: number | null) {
  if (value == null) return "—"
  const seconds = Math.round(value / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function localDateTime(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function profileNumber(snapshot: unknown, key: string) {
  if (!snapshot || typeof snapshot !== "object") return null
  const fields = (snapshot as { fields?: unknown }).fields
  if (!fields || typeof fields !== "object") return null
  const value = (fields as Record<string, unknown>)[key]
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const noteKindItems = [
  { value: "observation", label: "Observation" },
  { value: "tasting", label: "Tasting" },
  { value: "recommendation", label: "Recommendation" },
  { value: "general", label: "General" },
]

export function RoastDetailScreen() {
  const params = useParams({ from: "/roasts/$roastId" })
  const roastId = Number(params.roastId)
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [noteBody, setNoteBody] = useState("")
  const roast = useQuery({
    queryKey: queryKeys.roast(roastId),
    queryFn: ({ signal }) => getRoast(roastId, signal),
  })
  const context = useQuery({
    queryKey: queryKeys.roastContext(roastId),
    queryFn: ({ signal }) => getRoastContext(roastId, signal),
  })
  const series = useQuery({
    queryKey: queryKeys.series(
      roastId,
      roast.data?.sampleStream?.streamVersion
    ),
    queryFn: ({ signal }) => getRoastSeries(roast.data!, signal),
    enabled: Boolean(roast.data?.sampleStream),
  })
  const profiles = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(undefined, signal),
  })
  const coffees = useQuery({
    queryKey: queryKeys.coffees(),
    queryFn: ({ signal }) => listCoffees(undefined, signal),
  })

  const noteMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      toast.success("Note saved")
      setNoteBody("")
      void queryClient.invalidateQueries({
        queryKey: queryKeys.roastContext(roastId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.roast(roastId) })
    },
    onError: (error) => toast.error(error.message),
  })
  const editMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateRoast>[2]) =>
      updateRoast(roastId, roast.data!.revision, input),
    onSuccess: () => {
      toast.success("Roast updated")
      setEditOpen(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.roast(roastId) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.roastContext(roastId),
      })
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
    },
    onError: (error) => toast.error(error.message),
  })

  if (roast.error) throw roast.error
  if (context.error) throw context.error
  if (roast.isPending || !roast.data)
    return (
      <div className="p-7">
        <Skeleton className="h-[38rem] rounded-xl" />
      </div>
    )

  const item = roast.data
  const points = chartPoints(series.data ?? null)
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
  const submitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = noteBody.trim()
    if (!body) return
    noteMutation.mutate({
      kind: String(form.get("kind") ?? "observation"),
      body,
      source: "user",
      attributes: {},
      links: [{ resourceType: "roast", resourceId: roastId }],
    })
  }
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
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
    const roastedAtInput = String(form.get("roastedAt") ?? "")
    const currentRoastedAt = localDateTime(item.roastedAt)
    const patch: Parameters<typeof updateRoast>[2] = {
      profileId: profileId && Number.isFinite(profileId) ? profileId : null,
      coffeeId: coffeeId && Number.isFinite(coffeeId) ? coffeeId : null,
      levelThousandths:
        level != null && Number.isFinite(level)
          ? Math.round(level * 1_000)
          : null,
      greenInputMassMg:
        load != null && Number.isFinite(load) ? Math.round(load * 1_000) : null,
    }
    if (roastedAtInput !== currentRoastedAt) {
      patch.roastedAt = roastedAtInput
        ? new Date(roastedAtInput).toISOString()
        : null
      patch.sourceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    editMutation.mutate(patch)
  }

  const actualFirstCrack = item.events.find(
    (event) => event.kind === "first_crack"
  )
  const expectedFirstCrackC = profileNumber(item.profileSnapshot, "expect_fc")
  const expectedFirstCrackPoint =
    actualFirstCrack || expectedFirstCrackC == null
      ? null
      : points.find(
          (point) =>
            point.elapsedMs <= (item.durationMs ?? Number.POSITIVE_INFINITY) &&
            (point.temperatureC ?? Number.NEGATIVE_INFINITY) >=
              expectedFirstCrackC
        )
  const firstCrack = actualFirstCrack
    ? { elapsedMs: actualFirstCrack.elapsedMs, estimated: false }
    : expectedFirstCrackPoint
      ? { elapsedMs: expectedFirstCrackPoint.elapsedMs, estimated: true }
      : undefined

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={
          item.roastedAt
            ? new Intl.DateTimeFormat(undefined, {
                dateStyle: "long",
                timeStyle: "short",
              }).format(new Date(item.roastedAt))
            : "Date unavailable"
        }
        title={`Roast #${item.id}`}
        description={`${item.coffee?.name ?? "Unassigned coffee"} · ${item.profile?.name ?? "No profile"}`}
        actions={
          <>
            <Link
              to="/roasts"
              search={{
                q: undefined,
                status: undefined,
                profileId: undefined,
                coffeeId: undefined,
                sort: undefined,
                hidden: undefined,
                density: undefined,
                rest: undefined,
                view: undefined,
              }}
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Roasts
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
                  <SheetTitle>Edit roast #{item.id}</SheetTitle>
                  <SheetDescription>
                    Only the details you change are written. The imported log
                    and telemetry remain untouched.
                  </SheetDescription>
                </SheetHeader>
                <form
                  id="edit-roast-form"
                  onSubmit={submitEdit}
                  className="px-4"
                >
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
                            {profileItems.map((profile) => (
                              <SelectItem
                                key={profile.value}
                                value={profile.value}
                              >
                                {profile.label}
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
                            {coffeeItems.map((coffee) => (
                              <SelectItem
                                key={coffee.value}
                                value={coffee.value}
                              >
                                {coffee.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
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
                    </div>
                  </FieldGroup>
                </form>
                <SheetFooter>
                  <Button
                    type="submit"
                    form="edit-roast-form"
                    disabled={editMutation.isPending}
                  >
                    <SaveIcon data-icon="inline-start" />
                    Save roast
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </>
        }
      />

      <div className="grid gap-6 px-3 py-4 sm:px-7 sm:py-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <main className="min-w-0">
          <section
            className="bg-card grid grid-cols-2 gap-5 rounded-xl border p-5 sm:grid-cols-3 lg:grid-cols-6"
            aria-label="Roast summary"
          >
            <Metric
              label="Level"
              value={
                item.levelThousandths == null
                  ? "—"
                  : (item.levelThousandths / 1_000).toFixed(1)
              }
            />
            <Metric label="Green load" value={grams(item.greenInputMassMg)} />
            <Metric label="Yield" value={grams(item.roastedYieldMassMg)} />
            <Metric label="Duration" value={elapsed(item.durationMs)} />
            <Metric label="Brews" value={String(item.brewCount)} />
            <Metric label="Status" value={item.status} />
          </section>

          {item.status === "planned" ? (
            <Alert className="bg-info mt-6">
              <CoffeeIcon />
              <AlertTitle>This roast is prepared</AlertTitle>
              <AlertDescription>
                Run it on the Nano, then synchronize. Tan Studio will attach the
                next device log to roast #{item.id} and keep these coffee and
                adjustment choices.
              </AlertDescription>
            </Alert>
          ) : null}

          <section
            className="bg-card mt-6 overflow-hidden rounded-xl border"
            aria-labelledby="roast-chart-title"
          >
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 id="roast-chart-title" className="font-semibold">
                  Roast curve
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Temperature, profile, rate of rise, power, and fan data from
                  the retained KLOG.
                </p>
              </div>
              <Badge variant="secondary">
                {item.sampleStream?.rowCount.toLocaleString() ?? 0} samples
              </Badge>
            </div>
            {series.isPending ? (
              <Skeleton className="m-5 h-96" />
            ) : points.length > 0 ? (
              <RoastChart
                points={points}
                events={item.events.map((event) => ({
                  id: event.id,
                  elapsedMs: event.elapsedMs,
                  label: event.kind.replaceAll("_", " "),
                  temperatureC:
                    event.temperatureMilliC == null
                      ? null
                      : event.temperatureMilliC / 1_000,
                  kind: "device" as const,
                }))}
                {...(firstCrack ? { firstCrack } : {})}
                {...(item.durationMs == null
                  ? {}
                  : { durationMs: item.durationMs })}
                height={680}
                showFanAxis
              />
            ) : (
              <p className="text-muted-foreground p-8 text-center text-sm">
                Telemetry appears after the Nano log is synchronized.
              </p>
            )}
          </section>

          <section className="bg-card mt-6 rounded-xl border p-5">
            <h2 className="font-semibold">Milestones</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.events.map((event) => (
                <Badge key={event.id} variant="outline">
                  {event.kind.replaceAll("_", " ")} · {elapsed(event.elapsedMs)}
                </Badge>
              ))}
              {!actualFirstCrack && expectedFirstCrackPoint ? (
                <Badge variant="secondary">
                  Expected first crack · ~
                  {elapsed(expectedFirstCrackPoint.elapsedMs)}
                  {expectedFirstCrackC == null
                    ? ""
                    : ` · ${expectedFirstCrackC.toFixed(0)}°C`}
                </Badge>
              ) : null}
              {!actualFirstCrack && !expectedFirstCrackPoint ? (
                <Badge variant="secondary">First crack not logged</Badge>
              ) : null}
            </div>
          </section>
        </main>

        <aside className="flex min-w-0 flex-col gap-5">
          <section className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold">Next actions</h2>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                to="/brews"
                search={{
                  roastId: item.id,
                  brewId: undefined,
                  tab: undefined,
                  q: undefined,
                  method: undefined,
                  sort: undefined,
                  hidden: undefined,
                  density: undefined,
                }}
                className={buttonVariants()}
              >
                <CoffeeIcon data-icon="inline-start" />
                Log a brew
              </Link>
              <Link
                to="/labels"
                search={{ roastId: item.id }}
                className={buttonVariants({ variant: "outline" })}
              >
                <PrinterIcon data-icon="inline-start" />
                Create label
              </Link>
              {item.profile ? (
                <Link
                  to="/profiles"
                  search={{ profileId: item.profile.id }}
                  className={buttonVariants({ variant: "outline" })}
                >
                  View profile
                </Link>
              ) : null}
            </div>
          </section>

          {context.data?.rest ? (
            <section className="bg-card rounded-xl border p-5">
              <h2 className="font-semibold">Rest & peak</h2>
              <div className="mt-3 flex items-center gap-2">
                <Badge
                  variant={
                    context.data.rest.state === "peak"
                      ? "success"
                      : context.data.rest.state === "resting"
                        ? "info"
                        : context.data.rest.state === "unknown"
                          ? "secondary"
                          : "warning"
                  }
                >
                  {context.data.rest.state === "pastPeak"
                    ? "past peak"
                    : context.data.rest.state === "unknown"
                      ? "date required"
                      : context.data.rest.state}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  {context.data.rest.ageDays == null
                    ? "Set roast date"
                    : `day ${context.data.rest.ageDays}`}
                </span>
              </div>
              {context.data.rest.suggestedFrom &&
              context.data.rest.suggestedUntil ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  Suggested window:{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                  }).format(new Date(context.data.rest.suggestedFrom))}{" "}
                  –{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                  }).format(new Date(context.data.rest.suggestedUntil))}
                </p>
              ) : null}
            </section>
          ) : null}

          <AttachmentPanel
            resourceType="roast"
            resourceId={item.id}
            title="Roast media"
            description="Attach process photos, finished beans, videos, or supporting documents."
          />

          <section className="bg-card rounded-xl border p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Notes</h2>
              <Badge variant="secondary">
                {context.data?.notes.length ?? 0}
              </Badge>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {context.data?.notes.map((note) => (
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
                  <FieldLabel htmlFor="note-kind">Type</FieldLabel>
                  <Select
                    items={noteKindItems}
                    name="kind"
                    defaultValue="observation"
                  >
                    <SelectTrigger id="note-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {noteKindItems.map((kind) => (
                          <SelectItem key={kind.value} value={kind.value}>
                            {kind.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="note-body">Add a note</FieldLabel>
                  <Textarea
                    id="note-body"
                    name="body"
                    required
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    placeholder="What did you notice?"
                  />
                  <FieldDescription>
                    Saved to roast #{item.id}; agents receive it through the
                    same API.
                  </FieldDescription>
                </Field>
                <Button type="submit" disabled={noteMutation.isPending}>
                  <FileTextIcon data-icon="inline-start" />
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
