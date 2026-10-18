import { Card, CardContent } from "@tan-studio/ui/components/card"
import { RoastGiftPage } from "@/components/roast-gift-page"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CoffeeIcon,
  PencilIcon,
  TagIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  BrewHistory,
  CollectionLink,
  NotebookBreadcrumbs,
  NotebookSection,
  ResourceLink,
  RoastHistory,
} from "@/components/notebook"
import { NotebookNotes } from "@/components/notebook-notes"
import { dateText, levelText, massText } from "@/lib/notebook"
import { useNotebookHistory } from "@/lib/notebook-queries"

import { AttachmentPanel } from "@/components/attachment-panel"
import { EntityImage } from "@/components/entity-image"
import { PageHeader } from "@/components/page-header"
import { RoastChart } from "@/components/roast-chart"
import {
  getRoast,
  getRoastContext,
  getRoastSeries,
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
function temperature(value?: number | null) {
  return value == null ? "—" : `${(value / 1_000).toFixed(1)} °C`
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
  const history = useNotebookHistory()
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
  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) =>
      updateRoast(roastId, roast.data!.revision, { archived }),
    onSuccess: (updated) => {
      toast.success(
        updated.archivedAt
          ? `Roast #${updated.id} archived`
          : `Roast #${updated.id} restored`
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.pantry() })
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.roast(roastId) })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.roastContext(roastId),
      })
    },
    onError: (error) => toast.error(error.message),
  })
  if (roast.error) throw roast.error
  if (context.error) throw context.error
  if (roast.isPending || !roast.data)
    return (
      <div className="p-7">
        <Skeleton className="h-[38rem]" />
      </div>
    )

  const item = roast.data
  const points = chartPoints(series.data ?? null)
  const actualFirstCrack =
    item.events.find(
      (event) => event.kind === "first_crack" && event.source === "user"
    ) ?? item.events.find((event) => event.kind === "first_crack")
  const displayEvents =
    actualFirstCrack?.source === "user"
      ? item.events.filter(
          (event) => event.kind !== "first_crack" || event.source === "user"
        )
      : item.events
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
      <NotebookBreadcrumbs
        items={[
          <CollectionLink type="roast" />,
          ...(item.coffee
            ? [
                <ResourceLink type="coffee" id={item.coffee.id}>
                  {item.coffee.name}
                </ResourceLink>,
              ]
            : []),
          `Roast #${item.id}`,
        ]}
      />
      <PageHeader
        title={`Roast #${item.id}`}
        description={`${dateText(item.roastedAt, true)} · ${item.status}${item.archivedAt ? " · archived" : ""}`}
        image={
          <EntityImage
            attachmentId={item.profileImageAttachmentId}
            entityType="roast"
            alt={`Roast #${item.id}`}
          />
        }
        actions={
          <>
            <Button
              nativeButton={false}
              role="link"
              render={<Link to="/brews/new" search={{ roastId: item.id }} />}
            >
              <CoffeeIcon data-icon="inline-start" />
              Record a brew
            </Button>
            <Button
              nativeButton={false}
              role="link"
              variant={"outline"}
              render={
                <Link
                  to="/roasts/$roastId/edit"
                  params={{ roastId: String(item.id) }}
                />
              }
            >
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
            <Button
              nativeButton={false}
              role="link"
              variant={"outline"}
              render={<Link to="/labels" search={{ roastId: item.id }} />}
            >
              <TagIcon data-icon="inline-start" />
              Jar label
            </Button>
            <Button
              variant="outline"
              disabled={archiveMutation.isPending}
              onClick={() => archiveMutation.mutate(!item.archivedAt)}
            >
              {item.archivedAt ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {item.archivedAt ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />
      <div className="notebook-lineage">
        <div>
          <small>Coffee</small>
          {item.coffee ? (
            <ResourceLink type="coffee" id={item.coffee.id}>
              {item.coffee.name}
            </ResourceLink>
          ) : (
            <span>
              Not assigned ·{" "}
              <Link
                to="/roasts/$roastId/edit"
                params={{ roastId: String(item.id) }}
                className="notebook-link text-sm"
              >
                Assign coffee
              </Link>
            </span>
          )}
          {context.data?.coffee ? (
            <p>
              {[context.data.coffee.country, context.data.coffee.process]
                .filter(Boolean)
                .join(" · ")}{" "}
              · {massText(context.data.coffee.remainingMassMg)} green
            </p>
          ) : null}
        </div>
        <div>
          <small>Profile</small>
          {item.profile ? (
            <ResourceLink type="profile" id={item.profile.id}>
              {item.profile.name}
            </ResourceLink>
          ) : (
            <span>Not assigned</span>
          )}
        </div>
      </div>
      <dl className="notebook-facts">
        {[
          ["Level", levelText(item.levelThousandths)],
          [
            "Green → roasted",
            `${massText(item.greenInputMassMg)} → ${massText(item.roastedYieldMassMg)}`,
          ],
          [
            "Weight loss",
            item.greenInputMassMg && item.roastedYieldMassMg != null
              ? `${(100 * (1 - item.roastedYieldMassMg / item.greenInputMassMg)).toFixed(1)}%`
              : "—",
          ],
          ["Duration", elapsed(item.durationMs)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {item.status === "planned" ? (
        <Alert>
          <AlertTitle>Prepared</AlertTitle>
          <AlertDescription>
            Run the roast on the Nano, then synchronize to attach its log.
          </AlertDescription>
        </Alert>
      ) : null}
      <NotebookNotes
        type="roast"
        id={item.id}
        notes={context.data?.notes.filter(
          (n) => !n.links.some((l) => l.resourceType === "brew")
        )}
        title="Roast notes"
      />
      <NotebookSection
        title="Brews & tasting"
        count={context.data?.brews.length ?? 0}
      >
        <BrewHistory
          brews={context.data?.brews ?? []}
          roasts={history.roasts}
        />
      </NotebookSection>
      {item.coffee ? (
        <NotebookSection
          title="Other roasts of this coffee"
          count={
            history.roasts.filter(
              (r) => r.coffee?.id === item.coffee?.id && r.id !== item.id
            ).length
          }
        >
          <RoastHistory
            roasts={history.roasts.filter(
              (r) => r.coffee?.id === item.coffee?.id && r.id !== item.id
            )}
            brews={history.brews}
            notes={history.notes}
          />
        </NotebookSection>
      ) : null}
      <div className="notebook-columns">
        <NotebookSection title="Roast details">
          <dl className="notebook-details">
            {[
              [
                "Development",
                item.developmentBasisPoints == null
                  ? "—"
                  : `${item.developmentBasisPoints / 100}%`,
              ],
              ["End temperature", temperature(item.endTemperatureMilliC)],
              [
                "Cooling",
                item.cooldownEndMs == null || item.durationMs == null
                  ? "—"
                  : elapsed(item.cooldownEndMs - item.durationMs),
              ],
              ["Result", item.result],
              ["End reason", item.endReason || "—"],
              ["Roasted at", dateText(item.roastedAt, true)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </NotebookSection>
        <NotebookSection title="Rest & peak">
          <dl className="notebook-details">
            <div>
              <dt>Rest state</dt>
              <dd>{context.data?.rest?.state ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>
                {context.data?.rest?.ageDays == null
                  ? "—"
                  : `${context.data.rest.ageDays} days`}
              </dd>
            </div>
            <div>
              <dt>Suggested window</dt>
              <dd>
                {context.data?.rest?.suggestedFrom
                  ? `${dateText(context.data.rest.suggestedFrom)} – ${dateText(context.data.rest.suggestedUntil)}`
                  : "—"}
              </dd>
            </div>
          </dl>
        </NotebookSection>
      </div>
      <NotebookSection title="Milestones">
        <dl className="notebook-details">
          {displayEvents.map((event) => (
            <div key={event.id}>
              <dt>{event.kind.replaceAll("_", " ")}</dt>
              <dd>
                {elapsed(event.elapsedMs)}
                {event.temperatureMilliC == null
                  ? ""
                  : ` · ${temperature(event.temperatureMilliC)}`}
              </dd>
            </div>
          ))}
          {!actualFirstCrack && expectedFirstCrackPoint ? (
            <div>
              <dt>Expected first crack</dt>
              <dd>
                ~{elapsed(expectedFirstCrackPoint.elapsedMs)} ·{" "}
                {expectedFirstCrackC}°C
              </dd>
            </div>
          ) : null}
          {!displayEvents.length ? (
            <p className="notebook-empty">No milestones recorded.</p>
          ) : null}
        </dl>
      </NotebookSection>
      <Card
        className="mt-8 overflow-hidden"
        aria-labelledby="roast-chart-title"
      >
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <h2 id="roast-chart-title">Roast curve</h2>
            </div>
            <Badge variant="secondary">
              {item.sampleStream?.rowCount.toLocaleString() ?? 0} samples
            </Badge>
          </div>
          {series.isPending && item.sampleStream ? (
            <Skeleton className="m-5 h-96" />
          ) : points.length > 0 ? (
            <RoastChart
              points={points}
              events={displayEvents.map((event) => ({
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
              {...(item.cooldownEndMs == null
                ? {}
                : { cooldownEndMs: item.cooldownEndMs })}
              height={680}
              showFanAxis
            />
          ) : (
            <p className="text-muted-foreground py-6 text-sm">
              No telemetry yet. Synchronize the Nano log.
            </p>
          )}
        </CardContent>
      </Card>
      <RoastGiftPage roast={item} />
      <div id="roast-media" className="notebook-section">
        <AttachmentPanel
          resourceType="roast"
          resourceId={item.id}
          title="Images & files"
        />
      </div>
    </div>
  )
}
