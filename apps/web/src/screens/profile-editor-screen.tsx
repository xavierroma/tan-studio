import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tan-studio/ui/components/dropdown-menu"
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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tan-studio/ui/components/sheet"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { Textarea } from "@tan-studio/ui/components/textarea"
import {
  FileChartColumnIncreasingIcon,
  GitBranchIcon,
  InfoIcon,
  Layers3Icon,
  PlusIcon,
} from "lucide-react"
import type { FormEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import {
  ProfileComparisonChart,
  type ProfileChartCurve,
} from "@/components/profile-comparison-chart"
import {
  createChildProfile,
  getProfile,
  listProfiles,
  listRoasts,
  queryKeys,
} from "@/lib/api"
import type { ChartPoint } from "@/types"

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function points(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = record(item)
        return typeof row.timeSeconds === "number" &&
          typeof row.value === "number"
          ? [{ elapsedMs: row.timeSeconds * 1_000, value: row.value }]
          : []
      })
    : []
}
function cubic(
  start: number,
  outgoing: number,
  incoming: number,
  end: number,
  progress: number
) {
  const inverse = 1 - progress
  return (
    inverse ** 3 * start +
    3 * inverse ** 2 * progress * outgoing +
    3 * inverse * progress ** 2 * incoming +
    progress ** 3 * end
  )
}
export function sampleNativeCurve(value: unknown, samplesPerSegment = 24) {
  const controls = Array.isArray(value)
    ? points(value)
    : typeof value === "string"
      ? (() => {
          const values = value.split(",").map(Number)
          if (
            values.length % 2 !== 0 ||
            values.some((entry) => !Number.isFinite(entry))
          )
            return []
          return Array.from({ length: values.length / 2 }, (_, index) => ({
            elapsedMs: values[index * 2]! * 1_000,
            value: values[index * 2 + 1]!,
          }))
        })()
      : []
  if (controls.length < 6 || controls.length % 3 !== 0) return []
  const segments = controls.length / 3
  return Array.from(
    { length: (segments - 1) * samplesPerSegment + 1 },
    (_, index) => {
      if (index === (segments - 1) * samplesPerSegment)
        return controls[(segments - 1) * 3]!
      const segment = Math.floor(index / samplesPerSegment)
      const progress = (index % samplesPerSegment) / samplesPerSegment
      const start = controls[segment * 3]!
      const outgoing = controls[segment * 3 + 2]!
      const incoming = controls[(segment + 1) * 3 + 1]!
      const end = controls[(segment + 1) * 3]!
      return {
        elapsedMs: cubic(
          start.elapsedMs,
          outgoing.elapsedMs,
          incoming.elapsedMs,
          end.elapsedMs,
          progress
        ),
        value: cubic(
          start.value,
          outgoing.value,
          incoming.value,
          end.value,
          progress
        ),
      }
    }
  )
}
function interpolate(
  values: Array<{ elapsedMs: number; value: number }>,
  elapsedMs: number
) {
  const left = values.filter((point) => point.elapsedMs <= elapsedMs).at(-1)
  const right = values.find((point) => point.elapsedMs >= elapsedMs)
  if (!left) return right?.value ?? null
  if (!right || right.elapsedMs === left.elapsedMs) return left.value
  const progress =
    (elapsedMs - left.elapsedMs) / (right.elapsedMs - left.elapsedMs)
  return left.value + (right.value - left.value) * progress
}

function profileChartPoints(value: unknown): ChartPoint[] {
  const document = record(value)
  const roast = sampleNativeCurve(
    document.roastCurve ?? document.roast_profile
  ).toSorted((a, b) => a.elapsedMs - b.elapsedMs)
  const fan = sampleNativeCurve(
    document.fanCurve ?? document.fan_profile
  ).toSorted((a, b) => a.elapsedMs - b.elapsedMs)
  return [...new Set([...roast, ...fan].map((point) => point.elapsedMs))]
    .toSorted((a, b) => a - b)
    .map((elapsedMs) => ({
      elapsedMs,
      temperatureC: interpolate(roast, elapsedMs) ?? 0,
      profileC: null,
      rorCPerMin: null,
      actualFanRpm: interpolate(fan, elapsedMs),
    }))
}

export function ProfileEditorScreen() {
  const search = useSearch({ from: "/profiles" })
  const navigate = useNavigate({ from: "/profiles" })
  const queryClient = useQueryClient()
  const [childOpen, setChildOpen] = useState(false)
  const list = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(undefined, signal),
  })
  const selectedId = search.profileId ?? list.data?.[0]?.id
  const profile = useQuery({
    queryKey: queryKeys.profile(selectedId ?? 0),
    queryFn: ({ signal }) => getProfile(selectedId!, signal),
    enabled: selectedId != null,
  })
  const compareIds = useMemo(
    () =>
      (search.compare == null
        ? []
        : String(search.compare).split(",").map(Number)
      ).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== selectedId),
    [search.compare, selectedId]
  )
  const comparisons = useQueries({
    queries: compareIds.map((id) => ({
      queryKey: queryKeys.profile(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getProfile(id, signal),
    })),
  })
  const profileRoasts = useQuery({
    queryKey: queryKeys.roasts({ profileId: selectedId }),
    queryFn: ({ signal }) => listRoasts({ profileId: selectedId }, signal),
    enabled: selectedId != null,
  })
  const child = useMutation({
    mutationFn: (input: Parameters<typeof createChildProfile>[1]) =>
      createChildProfile(selectedId!, input),
    onSuccess: (created) => {
      toast.success(`Profile #${created.id} created`)
      setChildOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["profiles"] })
      void navigate({ search: { profileId: created.id, compare: undefined } })
    },
    onError: (error) => toast.error(error.message),
  })

  useEffect(() => {
    if (!search.profileId && selectedId)
      void navigate({
        search: { profileId: selectedId, compare: search.compare },
        replace: true,
      })
  }, [navigate, search.profileId, selectedId])
  if (list.error) throw list.error
  if (profile.error) throw profile.error

  const chartCurves = useMemo(
    () =>
      [profile.data, ...comparisons.map((query) => query.data)].flatMap(
        (candidate): ProfileChartCurve[] =>
          candidate
            ? [
                {
                  id: candidate.id,
                  name: candidate.name,
                  points: profileChartPoints(candidate.profile),
                },
              ]
            : []
      ),
    [comparisons, profile.data]
  )

  if (list.isPending)
    return (
      <div className="p-7">
        <Skeleton className="h-[38rem] rounded-xl" />
      </div>
    )
  if (!selectedId)
    return (
      <Empty className="m-7 min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileChartColumnIncreasingIcon />
          </EmptyMedia>
          <EmptyTitle>No profiles yet</EmptyTitle>
          <EmptyDescription>
            Synchronize the Nano to import its KPRO profile library.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (!profile.data)
    return (
      <div className="p-7">
        <Skeleton className="h-[38rem] rounded-xl" />
      </div>
    )

  const item = profile.data
  const parent = list.data?.find(
    (candidate) => candidate.id === item.parentProfileId
  )
  const children =
    list.data?.filter((candidate) => candidate.parentProfileId === item.id) ??
    []
  const profileItems =
    list.data?.map((candidate) => ({
      value: String(candidate.id),
      label: `#${candidate.id} · ${candidate.name}`,
    })) ?? []
  const latestRoasts = (profileRoasts.data ?? [])
    .toSorted((left, right) => right.id - left.id)
    .slice(0, 5)
  const submitChild = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    child.mutate({
      parentProfileId: item.id,
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? ""),
      designer: item.designer,
      recommendedLevelThousandths: Math.round(
        Number(form.get("level")) * 1_000
      ),
      referenceLoadMg: Math.round(Number(form.get("load")) * 1_000),
      profile: item.profile,
    })
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={`Profile #${item.id} · ${item.origin}`}
        title={item.name}
        description={
          item.description.split("\n").find(Boolean) ??
          "Kaffelogic roast profile"
        }
        actions={
          <Sheet open={childOpen} onOpenChange={setChildOpen}>
            <SheetTrigger
              render={
                <Button>
                  <GitBranchIcon data-icon="inline-start" />
                  Create adjusted child
                </Button>
              }
            />
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Create a child profile</SheetTitle>
                <SheetDescription>
                  The child keeps this exact profile document and records your
                  reusable changes without changing profile #{item.id}.
                </SheetDescription>
              </SheetHeader>
              <form
                id="child-profile-form"
                onSubmit={submitChild}
                className="px-4"
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="child-name">Name</FieldLabel>
                    <Input
                      id="child-name"
                      name="name"
                      required
                      defaultValue={`${item.name} · adjusted`}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="child-level">
                        Recommended level
                      </FieldLabel>
                      <Input
                        id="child-level"
                        name="level"
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        required
                        defaultValue={
                          (item.recommendedLevelThousandths ?? 0) / 1_000
                        }
                      />
                      <FieldDescription>
                        Default endpoint for a roast.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="child-load">
                        Reference load · g
                      </FieldLabel>
                      <Input
                        id="child-load"
                        name="load"
                        type="number"
                        min="1"
                        step="1"
                        required
                        defaultValue={(item.referenceLoadMg ?? 120_000) / 1_000}
                      />
                      <FieldDescription>
                        Bean mass the profile was tuned around.
                      </FieldDescription>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="child-description">
                      Why this variant?
                    </FieldLabel>
                    <Textarea
                      id="child-description"
                      name="description"
                      placeholder="What are you changing, and what result do you expect?"
                    />
                  </Field>
                </FieldGroup>
              </form>
              <SheetFooter>
                <Button
                  type="submit"
                  form="child-profile-form"
                  disabled={child.isPending}
                >
                  <PlusIcon data-icon="inline-start" />
                  Create profile
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      <div className="flex flex-col gap-6 px-5 py-6 sm:px-7">
        <div className="flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
          <Field>
            <FieldLabel htmlFor="profile-picker">Inspect profile</FieldLabel>
            <Select
              items={profileItems}
              value={String(item.id)}
              onValueChange={(value) =>
                value &&
                void navigate({
                  search: {
                    profileId: Number(value),
                    compare: search.compare,
                  },
                })
              }
            >
              <SelectTrigger id="profile-picker" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {profileItems.map((candidate) => (
                    <SelectItem key={candidate.value} value={candidate.value}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline">
                  <Layers3Icon data-icon="inline-start" />
                  Compare
                  {compareIds.length ? ` · ${compareIds.length}` : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Overlay up to 3 profiles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {list.data
                  ?.filter((candidate) => candidate.id !== item.id)
                  .map((candidate) => {
                    const selected = compareIds.includes(candidate.id)
                    return (
                      <DropdownMenuCheckboxItem
                        key={candidate.id}
                        checked={selected}
                        disabled={!selected && compareIds.length >= 3}
                        onCheckedChange={(checked) => {
                          const next = checked
                            ? [...compareIds, candidate.id].slice(0, 3)
                            : compareIds.filter((id) => id !== candidate.id)
                          void navigate({
                            search: {
                              profileId: item.id,
                              compare:
                                next.length === 1
                                  ? next[0]
                                  : next.length
                                    ? next.join(",")
                                    : undefined,
                            },
                            replace: true,
                          })
                        }}
                      >
                        #{candidate.id} · {candidate.name}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <section className="bg-card overflow-hidden rounded-xl border">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">Temperature & fan</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                The curve stored in the source KPRO; viewing it never normalizes
                or rewrites the original file.
              </p>
            </div>
            {item.sourceHash ? (
              <Badge variant="success">Source retained</Badge>
            ) : (
              <Badge variant="secondary">User profile</Badge>
            )}
          </div>
          {chartCurves[0]?.points.length ? (
            <ProfileComparisonChart curves={chartCurves} />
          ) : (
            <p className="text-muted-foreground p-8 text-center text-sm">
              This profile has no curve points yet.
            </p>
          )}
        </section>

        <section
          className="grid gap-4 sm:grid-cols-3"
          aria-label="Profile metrics"
        >
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Recommended level"
              value={
                item.recommendedLevelThousandths == null
                  ? "—"
                  : (item.recommendedLevelThousandths / 1_000).toFixed(1)
              }
              detail="A starting endpoint, adjustable per roast"
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Reference load"
              value={
                item.referenceLoadMg == null
                  ? "—"
                  : `${item.referenceLoadMg / 1_000} g`
              }
              detail="The bean mass this curve expects"
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Used by"
              value={`${item.roastCount} roasts`}
              detail={`${item.childCount} child profiles`}
            />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold">About this profile</h2>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed whitespace-pre-line">
              {item.description || "No description was supplied."}
            </p>
            <Alert className="bg-info mt-5">
              <InfoIcon />
              <AlertTitle>Adjustments belong to the roast first</AlertTitle>
              <AlertDescription>
                Changing level or boost for one run is recorded on that roast.
                Create a child only when you want the adjustment to become a
                reusable profile.
              </AlertDescription>
            </Alert>
          </section>
          <aside className="bg-card self-start rounded-xl border p-5">
            <h2 className="font-semibold">Relationships</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              {parent ? (
                <Link
                  to="/profiles"
                  search={{ profileId: parent.id, compare: undefined }}
                  className="underline-offset-4 hover:underline"
                >
                  Parent · #{parent.id} {parent.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">No parent profile</span>
              )}
              {children.slice(0, 3).map((candidate) => (
                <Link
                  key={candidate.id}
                  to="/profiles"
                  search={{ profileId: candidate.id, compare: undefined }}
                  className="underline-offset-4 hover:underline"
                >
                  Child · #{candidate.id} {candidate.name}
                </Link>
              ))}
              {latestRoasts.length ? (
                <div className="border-t pt-3">
                  <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                    Latest roasts
                  </p>
                  <div className="flex flex-col gap-2">
                    {latestRoasts.map((roast) => (
                      <Link
                        key={roast.id}
                        to="/roasts/$roastId"
                        params={{ roastId: String(roast.id) }}
                        className="flex items-center justify-between gap-3 underline-offset-4 hover:underline"
                      >
                        <span>
                          Roast #{roast.id}
                          {roast.coffee ? ` · ${roast.coffee.name}` : ""}
                        </span>
                        <Badge variant="secondary">{roast.status}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  No roasts use this profile yet
                </span>
              )}
              <Link
                to="/roasts"
                search={{
                  profileId: item.id,
                  coffeeId: undefined,
                  q: undefined,
                  status: undefined,
                  sort: undefined,
                  hidden: undefined,
                  density: undefined,
                  rest: undefined,
                  view: undefined,
                }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View its {item.roastCount} roasts
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
