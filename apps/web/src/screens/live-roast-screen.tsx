import { useQuery } from "@tanstack/react-query"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { toast } from "sonner"
import {
  BellRingIcon,
  BookmarkPlusIcon,
  CableIcon,
  CircleDotDashedIcon,
  EyeIcon,
  FlagIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import { RoastChart } from "@/components/roast-chart"
import { getDeviceState, getRoast, isDemoResult, queryKeys } from "@/lib/api"
import { formatElapsed } from "@/lib/format"
import { useWorkspaceStore } from "@/stores/workspace-store"

const sampleRoastId = "0197f1d2-9000-7000-8000-000000000001"

export function LiveRoastScreen() {
  const device = useQuery({
    queryKey: queryKeys.device(),
    queryFn: getDeviceState,
  })
  const demoLive =
    isDemoResult(device.data) && device.data.data.available === true
  const roast = useQuery({
    queryKey: queryKeys.roast(sampleRoastId),
    queryFn: () => getRoast(sampleRoastId),
    enabled: demoLive,
  })
  const [elapsedMs, setElapsedMs] = useState(384_000)
  const liveNote = useWorkspaceStore((state) => state.liveNote)
  const setLiveNote = useWorkspaceStore((state) => state.setLiveNote)

  useEffect(() => {
    if (!demoLive) return
    const timer = window.setInterval(
      () => setElapsedMs((value) => Math.min(value + 1_000, 521_000)),
      1_000
    )
    return () => window.clearInterval(timer)
  }, [demoLive])

  const visiblePoints = useMemo(
    () =>
      roast.data?.data.chart.filter((point) => point.elapsedMs <= elapsedMs) ??
      [],
    [elapsedMs, roast.data?.data.chart]
  )
  const current = visiblePoints.at(-1)

  if (device.isPending) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Checking live-monitoring capabilities…
      </div>
    )
  }

  if (!demoLive) {
    const state = device.data?.data
    const reason = device.isError
      ? "The local companion could not be reached. No roast or device state has been assumed."
      : state?.available
        ? "The USB adapter is available, but no verified live telemetry stream is active."
        : `The USB adapter is unavailable${state?.reason ? ` (${state.reason})` : ""}.`
    return (
      <div className="min-h-screen">
        <PageHeader
          eyebrow="Nano 7 · capability check"
          title="Live roast"
          description="Live telemetry appears only when a verified device stream is active"
          actions={
            <Button variant="outline" onClick={() => void device.refetch()}>
              <CableIcon data-icon="inline-start" />
              Check again
            </Button>
          }
        />
        <div className="px-5 py-6 sm:px-7">
          <Alert className="bg-warning max-w-3xl">
            <TriangleAlertIcon />
            <AlertTitle>Live monitoring unavailable</AlertTitle>
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Development simulation · no physical roaster"
        title="Live roast"
        description="Ethiopia Hamasho · Washed floral · gentle finish · revision 8"
        actions={
          <>
            <Badge variant="info">
              <CableIcon data-icon="inline-start" />
              {device.data?.data.connection ?? "connecting"}
            </Badge>
            <Button
              variant="outline"
              onClick={() => toast.success("Live notifications enabled")}
            >
              <BellRingIcon data-icon="inline-start" />
              Notify me
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="min-w-0">
          <section
            className="bg-card grid grid-cols-2 gap-x-5 gap-y-6 rounded-xl border p-5 sm:grid-cols-4 lg:grid-cols-6"
            aria-label="Live telemetry"
          >
            <Metric label="Elapsed" value={formatElapsed(elapsedMs)} emphasis />
            <Metric
              label="Bean temp"
              value={`${current?.temperatureC.toFixed(1) ?? "—"}°`}
              detail="Celsius"
              emphasis
            />
            <Metric
              label="Target"
              value={`${current?.profileC == null ? "—" : current.profileC.toFixed(1)}°`}
              detail="Profile revision 8"
            />
            <Metric
              label="Rate of rise"
              value={`${current?.rorCPerMin == null ? "—" : current.rorCPerMin.toFixed(1)}°`}
              detail="per minute"
            />
            <Metric label="Power" value="72%" detail="Device reported" />
            <Metric
              label="Stage"
              value="Maillard"
              detail="First crack predicted 7:29"
            />
          </section>

          <section
            className="bg-card mt-6 overflow-hidden rounded-xl border"
            aria-labelledby="live-chart-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 id="live-chart-heading" className="font-semibold">
                  Live telemetry
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Bounded in-memory view · durable device fragments retained
                  locally
                </p>
              </div>
              <Badge variant="success">
                <CircleDotDashedIcon data-icon="inline-start" />
                simulated · 1 Hz
              </Badge>
            </div>
            <RoastChart points={visiblePoints} live height={465} />
          </section>

          <Alert className="bg-warning mt-6">
            <ShieldCheckIcon />
            <AlertTitle>Roast control stays on the physical Nano</AlertTitle>
            <AlertDescription>
              Tan Studio monitors, records and annotates this roast. Start, stop
              and safety-critical control remain on the connected roaster with a
              nearby operator.
            </AlertDescription>
          </Alert>
        </main>

        <aside className="min-w-0">
          <section
            className="bg-card rounded-xl border p-5"
            aria-labelledby="operator-heading"
          >
            <div className="flex items-center gap-3">
              <span className="bg-info flex size-9 items-center justify-center rounded-full">
                <EyeIcon className="size-4" />
              </span>
              <div>
                <h2 id="operator-heading" className="font-semibold">
                  Operator present
                </h2>
                <p className="text-muted-foreground text-xs">
                  Confirmed on this Mac · 2 min ago
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-5">
              <Metric label="Load" value="100 g" />
              <Metric label="Level" value="2.6" />
            </div>
          </section>

          <section
            className="bg-card mt-5 rounded-xl border p-5"
            aria-labelledby="mark-events-heading"
          >
            <h2 id="mark-events-heading" className="font-semibold">
              Mark an event
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Adds an operator event at the current time and temperature.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  toast.success(
                    `Yellowing marked at ${formatElapsed(elapsedMs)}`
                  )
                }
              >
                Yellowing
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  toast.success(
                    `First crack marked at ${formatElapsed(elapsedMs)}`
                  )
                }
              >
                <FlagIcon data-icon="inline-start" />
                1st crack
              </Button>
            </div>
          </section>

          <section
            className="bg-card mt-5 rounded-xl border p-5"
            aria-labelledby="quick-note-heading"
          >
            <h2 id="quick-note-heading" className="font-semibold">
              Quick note
            </h2>
            <Field className="mt-4">
              <FieldLabel htmlFor="live-note">Observation</FieldLabel>
              <Textarea
                id="live-note"
                value={liveNote}
                onChange={(event) => setLiveNote(event.target.value)}
                placeholder="Aroma, sound, smoke, color…"
                rows={5}
              />
              <FieldDescription>
                Anchored at {formatElapsed(elapsedMs)} and{" "}
                {current?.temperatureC.toFixed(1) ?? "—"}°C.
              </FieldDescription>
            </Field>
            <Button
              className="mt-4 w-full"
              disabled={!liveNote.trim()}
              onClick={() => {
                toast.success("Live note saved")
                setLiveNote("")
              }}
            >
              <BookmarkPlusIcon data-icon="inline-start" />
              Save note
            </Button>
          </section>
        </aside>
      </div>
    </div>
  )
}
