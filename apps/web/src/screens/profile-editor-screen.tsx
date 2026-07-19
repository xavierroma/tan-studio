import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { buttonVariants } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import {
  ArrowLeftIcon,
  FileChartColumnIncreasingIcon,
  GaugeIcon,
  LockKeyholeIcon,
} from "lucide-react"
import { useEffect, useMemo } from "react"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import { RoastChart } from "@/components/roast-chart"
import { listProfiles, queryKeys } from "@/lib/api"
import type { ChartPoint, RoastProfile } from "@/types"

type ProfileSearch = {
  profile?: string
  proposalFrom?: string
}

function interpolate(
  points: ReadonlyArray<{ elapsedMs: number; value: number }>,
  elapsedMs: number
) {
  if (points.length === 0) return null
  const first = points[0]!
  const last = points.at(-1)!
  if (elapsedMs < first.elapsedMs || elapsedMs > last.elapsedMs) {
    return null
  }
  const rightIndex = points.findIndex((point) => point.elapsedMs >= elapsedMs)
  if (rightIndex < 0) return last.value
  const right = points[rightIndex]!
  const left = points[Math.max(0, rightIndex - 1)]!
  if (right.elapsedMs === left.elapsedMs) return right.value
  const progress =
    (elapsedMs - left.elapsedMs) / (right.elapsedMs - left.elapsedMs)
  return left.value + (right.value - left.value) * progress
}

function profileChart(profile: RoastProfile): ChartPoint[] {
  const roast = profile.roastCurve
    .map((point) => ({ elapsedMs: point.elapsedMs, value: point.temperatureC }))
    .toSorted((left, right) => left.elapsedMs - right.elapsedMs)
  const fan = profile.fanCurve
    .map((point) => ({ elapsedMs: point.elapsedMs, value: point.fanRpm }))
    .toSorted((left, right) => left.elapsedMs - right.elapsedMs)
  const elapsedTimes = [
    ...new Set([...roast, ...fan].map((point) => point.elapsedMs)),
  ].toSorted((left, right) => left - right)
  return elapsedTimes.map((elapsedMs) => ({
    elapsedMs,
    temperatureC: interpolate(roast, elapsedMs) ?? 0,
    profileC: null,
    rorCPerMin: null,
    actualFanRpm: interpolate(fan, elapsedMs),
  }))
}

function formatDate(value: string | null) {
  if (!value) return "Factory default"
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp)
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(timestamp)
}

function ProfileLoading() {
  return (
    <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Skeleton className="h-[34rem] rounded-xl" />
      <Skeleton className="h-[34rem] rounded-xl" />
    </div>
  )
}

export function ProfileEditorScreen() {
  const search = useSearch({ strict: false }) as ProfileSearch
  const navigate = useNavigate({ from: "/profiles" })
  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(signal),
  })
  const profiles = profilesQuery.data?.data ?? []
  const selected =
    profiles.find((profile) => profile.id === search.profile) ?? profiles[0]

  useEffect(() => {
    if (selected && search.profile !== selected.id) {
      void navigate({
        search: (previous) => ({ ...previous, profile: selected.id }),
        replace: true,
      })
    }
  }, [navigate, search.profile, selected])

  const chart = useMemo(
    () => (selected ? profileChart(selected) : []),
    [selected]
  )

  if (profilesQuery.error) throw profilesQuery.error

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={selected?.fileName ?? "Nano profile library"}
        title={selected?.displayName ?? "Roast profiles"}
        description={
          selected
            ? `Revision ${selected.revisionNumber} · Designed by ${selected.designer || "Unknown"} · Original KPRO retained`
            : "Lossless profiles imported from the connected Kaffeelogic library"
        }
        actions={
          <Link
            to="/roasts"
            search={{
              q: undefined,
              group: undefined,
              sort: undefined,
              date: undefined,
              provider: undefined,
              process: undefined,
              minScore: undefined,
              status: undefined,
            }}
            className={buttonVariants({ variant: "outline" })}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Roast notebook
          </Link>
        }
      />

      {profilesQuery.isPending ? <ProfileLoading /> : null}

      {!profilesQuery.isPending && profiles.length === 0 ? (
        <Empty className="m-5 min-h-80 border sm:m-7">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileChartColumnIncreasingIcon />
            </EmptyMedia>
            <EmptyTitle>No profiles imported yet</EmptyTitle>
            <EmptyDescription>
              Connect and synchronize a Nano from Device &amp; sync. Tan Studio
              retains the original KPRO bytes before creating this view.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {selected ? (
        <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-w-0">
            <section className="bg-card overflow-hidden rounded-xl border">
              <div className="border-b p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Profile files</h2>
                  <Badge variant="secondary">{profiles.length}</Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Imported from the Nano sync library
                </p>
              </div>
              <div className="max-h-[42rem] divide-y overflow-y-auto">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    aria-pressed={profile.id === selected.id}
                    onClick={() =>
                      void navigate({
                        search: (previous) => ({
                          ...previous,
                          profile: profile.id,
                        }),
                      })
                    }
                    className="hover:bg-secondary/40 aria-pressed:bg-accent/40 w-full px-4 py-3 text-left transition-colors"
                  >
                    <span className="block truncate text-sm font-medium">
                      {profile.displayName}
                    </span>
                    <span className="text-muted-foreground mt-1 block truncate text-xs">
                      {profile.fileName}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <main className="min-w-0">
            <section className="bg-card overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="font-semibold">Temperature and fan profile</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    KPRO cubic Bézier controls sampled without changing the
                    retained source.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    Schema {selected.schemaVersion}
                  </Badge>
                  {selected.warnings.length === 0 ? (
                    <Badge variant="success">Parsed without warnings</Badge>
                  ) : (
                    <Badge variant="warning">
                      {selected.warnings.length} warnings
                    </Badge>
                  )}
                </div>
              </div>
              <RoastChart points={chart} height={430} showFanAxis />
            </section>

            <section
              className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Profile summary"
            >
              <div className="bg-card rounded-xl border p-5">
                <Metric
                  label="Recommended level"
                  value={selected.recommendedLevel?.toFixed(1) ?? "—"}
                  detail="Kaffelogic level"
                />
              </div>
              <div className="bg-card rounded-xl border p-5">
                <Metric
                  label="Reference load"
                  value={
                    selected.referenceLoadGrams == null
                      ? "—"
                      : `${selected.referenceLoadGrams.toLocaleString()} g`
                  }
                  detail="Profile metadata"
                />
              </div>
              <div className="bg-card rounded-xl border p-5">
                <Metric
                  label="Roast duration"
                  value={
                    chart.length === 0
                      ? "—"
                      : `${Math.round(chart.at(-1)!.elapsedMs / 1_000)} s`
                  }
                  detail="Final curve point"
                />
              </div>
              <div className="bg-card rounded-xl border p-5">
                <Metric
                  label="Roast levels"
                  value={selected.roastLevelsC.length}
                  detail={
                    selected.roastLevelsC.length === 0
                      ? "Not specified"
                      : `${Math.min(...selected.roastLevelsC).toFixed(1)}–${Math.max(...selected.roastLevelsC).toFixed(1)} °C`
                  }
                />
              </div>
            </section>

            <section
              className="bg-card mt-6 rounded-xl border p-5"
              aria-labelledby="profile-notes-heading"
            >
              <div className="flex items-center gap-3">
                <span className="bg-info flex size-9 items-center justify-center rounded-full">
                  <GaugeIcon className="size-4" />
                </span>
                <div>
                  <h2 id="profile-notes-heading" className="font-semibold">
                    Native profile metadata
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    Modified{" "}
                    {formatDate(
                      selected.profileModifiedAt ?? selected.sourceModifiedAt
                    )}
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed whitespace-pre-line">
                {selected.description || "No profile description was supplied."}
              </p>
            </section>

            <Alert className="bg-info mt-6">
              <LockKeyholeIcon />
              <AlertTitle>Device deployment remains read-only</AlertTitle>
              <AlertDescription>
                Reading, parsing and visualization are enabled. Tan Studio will
                not write a profile to the Nano until the write protocol is
                captured and validated safely.
              </AlertDescription>
            </Alert>
          </main>
        </div>
      ) : null}
    </div>
  )
}
