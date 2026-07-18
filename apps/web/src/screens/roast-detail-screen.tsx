import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tan-studio/ui/components/tabs"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  BookmarkPlusIcon,
  GitCompareArrowsIcon,
  PrinterIcon,
  SaveIcon,
  SparklesIcon,
} from "lucide-react"
import { useState } from "react"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import { RoastChart } from "@/components/roast-chart"
import { StatusChip } from "@/components/status-chip"
import { getRoast, queryKeys } from "@/lib/api"
import {
  formatDuration,
  formatElapsed,
  formatRoastDate,
  formatScore,
} from "@/lib/format"
import { useWorkspaceStore } from "@/stores/workspace-store"

export function RoastDetailScreen() {
  const { roastId } = useParams({ strict: false }) as { roastId: string }
  const { data, isPending } = useQuery({
    queryKey: queryKeys.roast(roastId),
    queryFn: ({ signal }) => getRoast(roastId, signal),
  })
  const addToComparison = useWorkspaceStore((state) => state.addToComparison)
  const selected = useWorkspaceStore((state) =>
    state.selectedRoastIds.includes(roastId)
  )
  const [note, setNote] = useState("")

  if (isPending || !data) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Loading roast…
      </div>
    )
  }

  const roast = data.data
  const roastedAt = formatRoastDate(roast.roastedAt)

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={`${roastedAt.date} · ${roastedAt.time}`}
        title={roast.coffeeName}
        description={`${roast.providerName} · ${roast.country}, ${roast.region} · Lot ${roast.lotCode}`}
        actions={
          <>
            <Button
              nativeButton={false}
              variant="ghost"
              render={
                <Link
                  to="/roasts"
                  search={{
                    q: undefined,
                    process: undefined,
                    status: undefined,
                  }}
                />
              }
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Notebook
            </Button>
            <Button variant="outline" onClick={() => addToComparison(roast.id)}>
              <GitCompareArrowsIcon data-icon="inline-start" />
              {selected ? "Selected" : "Compare"}
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link to="/labels" search={{ roastId: roast.id }} />}
            >
              <PrinterIcon data-icon="inline-start" />
              Label
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <StatusChip status={roast.status} />
            <Badge variant="outline">Raw .klog retained</Badge>
            <Badge variant="info">
              {data.source === "companion" ? "Local database" : "Sample log"}
            </Badge>
          </div>

          <section
            className="bg-card overflow-hidden rounded-xl border"
            aria-labelledby="roast-curve-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 id="roast-curve-heading" className="font-semibold">
                  Roast curve
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Measured temperature, profile target and rate of rise · hover
                  to inspect
                </p>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
                <span className="flex items-center gap-2">
                  <i className="bg-chart-1 size-2 rounded-full" />
                  Measured
                </span>
                <span className="flex items-center gap-2">
                  <i className="bg-chart-2 size-2 rounded-full" />
                  Target
                </span>
                <span className="flex items-center gap-2">
                  <i className="bg-chart-3 size-2 rounded-full" />
                  RoR
                </span>
              </div>
            </div>
            <RoastChart
              points={roast.chart}
              events={roast.events}
              height={430}
            />
          </section>

          <section
            className="bg-card mt-6 rounded-xl border"
            aria-labelledby="roast-events-heading"
          >
            <div className="border-b px-5 py-4">
              <h2 id="roast-events-heading" className="font-semibold">
                Events and annotations
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Device events are preserved; your notes remain anchored to
                elapsed time and temperature.
              </p>
            </div>
            <div className="divide-y">
              {roast.events.map((event) => (
                <div
                  key={event.id}
                  className="grid grid-cols-[5.5rem_5.5rem_1fr_auto] items-center gap-3 px-5 py-3 text-sm"
                >
                  <span className="font-mono font-semibold tabular-nums">
                    {formatElapsed(event.elapsedMs)}
                  </span>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {event.temperatureC == null
                      ? "—"
                      : `${event.temperatureC.toFixed(1)}°C`}
                  </span>
                  <span>{event.label}</span>
                  <Badge
                    variant={
                      event.kind === "annotation"
                        ? "warning"
                        : event.kind === "manual"
                          ? "info"
                          : "secondary"
                    }
                  >
                    {event.kind}
                  </Badge>
                </div>
              ))}
            </div>
            <FieldGroup className="border-t p-5">
              <Field>
                <FieldLabel htmlFor="annotation">
                  Add a note to this roast
                </FieldLabel>
                <Textarea
                  id="annotation"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="What did you notice during or after the roast?"
                />
                <FieldDescription>
                  A note added during live monitoring also records the current
                  elapsed time and temperature.
                </FieldDescription>
              </Field>
              <Button
                className="self-start"
                disabled={!note.trim()}
                onClick={() => {
                  toast.success("Annotation saved locally")
                  setNote("")
                }}
              >
                <BookmarkPlusIcon data-icon="inline-start" />
                Add annotation
              </Button>
            </FieldGroup>
          </section>
        </main>

        <aside className="min-w-0">
          <section
            className="bg-card rounded-xl border p-5"
            aria-labelledby="roast-summary-heading"
          >
            <h2 id="roast-summary-heading" className="font-semibold">
              Roast summary
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6">
              <Metric
                label="Duration"
                value={formatDuration(roast.durationSeconds)}
              />
              <Metric label="Level" value={roast.level.toFixed(1)} />
              <Metric
                label="Development"
                value={`${roast.developmentPercent.toFixed(1)}%`}
              />
              <Metric
                label="Weight loss"
                value={`${roast.lossPercent.toFixed(1)}%`}
              />
              <Metric
                label="Green load"
                value={`${roast.greenWeightGrams.toFixed(0)} g`}
              />
              <Metric
                label="Roasted"
                value={`${roast.roastedWeightGrams.toFixed(1)} g`}
              />
            </div>
            <div className="mt-6 border-t pt-5">
              <p className="text-muted-foreground text-xs font-semibold tracking-[0.1em] uppercase">
                Profile
              </p>
              <p className="mt-2 font-semibold">{roast.profileName}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Revision {roast.profileRevision}
                {roast.profileDescription
                  ? ` · ${roast.profileDescription}`
                  : ""}
              </p>
              <Button
                nativeButton={false}
                variant="outline"
                className="mt-4 w-full"
                render={
                  <Link to="/profiles" search={{ proposalFrom: undefined }} />
                }
              >
                Open profile revision
              </Button>
            </div>
          </section>

          <section
            className="bg-card mt-5 rounded-xl border p-5"
            aria-labelledby="tasting-heading"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="tasting-heading" className="font-semibold">
                  Tasting
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Promoted tasting summary
                </p>
              </div>
              <span className="text-primary font-mono text-3xl font-semibold tabular-nums">
                {formatScore(roast.score)}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {roast.descriptors.map((descriptor) => (
                <Badge key={descriptor} variant="success">
                  {descriptor}
                </Badge>
              ))}
            </div>
            <p className="mt-4 text-sm leading-relaxed">{roast.conclusion}</p>
            <Tabs defaultValue="next" className="mt-5">
              <TabsList variant="line">
                <TabsTrigger value="next">Next roast</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>
              <TabsContent
                value="next"
                className="text-muted-foreground pt-3 text-sm leading-relaxed"
              >
                {roast.nextAction}
              </TabsContent>
              <TabsContent
                value="notes"
                className="text-muted-foreground pt-3 text-sm leading-relaxed"
              >
                {roast.tastingNotes || "No tasting notes yet."}
              </TabsContent>
            </Tabs>
            <Button
              variant="outline"
              className="mt-5 w-full"
              onClick={() => toast.info("Tasting editor opened")}
            >
              <SaveIcon data-icon="inline-start" />
              Edit tasting
            </Button>
          </section>

          <section
            className="bg-info mt-5 rounded-xl border p-5"
            aria-labelledby="profile-proposal-heading"
          >
            <SparklesIcon className="text-primary size-5" />
            <h2 id="profile-proposal-heading" className="mt-3 font-semibold">
              Turn learning into a revision
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Compare this roast with its lot history, then draft a reviewable
              profile proposal. Nothing is sent to the roaster automatically.
            </p>
            <Button
              nativeButton={false}
              variant="outline"
              className="bg-card mt-4 w-full"
              render={
                <Link to="/profiles" search={{ proposalFrom: roast.id }} />
              }
            >
              <SparklesIcon data-icon="inline-start" />
              Draft proposal
            </Button>
          </section>
        </aside>
      </div>
    </div>
  )
}
