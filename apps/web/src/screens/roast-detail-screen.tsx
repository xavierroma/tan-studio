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
    editMutation.mutate({
      profileId: profileId && Number.isFinite(profileId) ? profileId : null,
      coffeeId: coffeeId && Number.isFinite(coffeeId) ? coffeeId : null,
      levelThousandths:
        level != null && Number.isFinite(level)
          ? Math.round(level * 1_000)
          : null,
      greenInputMassMg:
        load != null && Number.isFinite(load) ? Math.round(load * 1_000) : null,
    })
  }

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
                      <FieldLabel htmlFor="profileId">Profile</FieldLabel>
                      <Select
                        name="profileId"
                        defaultValue={String(item.profile?.id ?? "")}
                      >
                        <SelectTrigger id="profileId" className="w-full">
                          <SelectValue placeholder="Select profile" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {profiles.data?.map((profile) => (
                              <SelectItem
                                key={profile.id}
                                value={String(profile.id)}
                              >
                                {profile.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coffeeId">Coffee</FieldLabel>
                      <Select
                        name="coffeeId"
                        defaultValue={String(item.coffee?.id ?? "none")}
                      >
                        <SelectTrigger id="coffeeId" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {coffees.data?.map((coffee) => (
                              <SelectItem
                                key={coffee.id}
                                value={String(coffee.id)}
                              >
                                {coffee.name}
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

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(0,1fr)_21rem]">
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
              <RoastChart points={points} height={440} showFanAxis />
            ) : (
              <p className="text-muted-foreground p-8 text-center text-sm">
                Telemetry appears after the Nano log is synchronized.
              </p>
            )}
          </section>

          {item.events.length > 0 ? (
            <section className="bg-card mt-6 rounded-xl border p-5">
              <h2 className="font-semibold">Device events</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {item.events.map((event) => (
                  <Badge key={event.id} variant="outline">
                    {event.kind.replaceAll("_", " ")} ·{" "}
                    {elapsed(event.elapsedMs)}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="flex min-w-0 flex-col gap-5">
          <section className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold">Next actions</h2>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                to="/brews"
                search={{ roastId: item.id, tab: undefined }}
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
                        : "warning"
                  }
                >
                  {context.data.rest.state === "pastPeak"
                    ? "past peak"
                    : context.data.rest.state}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  day {context.data.rest.ageDays}
                </span>
              </div>
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
            </section>
          ) : null}

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
                  <Select name="kind" defaultValue="observation">
                    <SelectTrigger id="note-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="observation">Observation</SelectItem>
                        <SelectItem value="tasting">Tasting</SelectItem>
                        <SelectItem value="recommendation">
                          Recommendation
                        </SelectItem>
                        <SelectItem value="general">General</SelectItem>
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
