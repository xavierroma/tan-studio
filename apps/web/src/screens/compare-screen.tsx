import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Textarea } from "@tan-studio/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@tan-studio/ui/components/toggle-group"
import { toast } from "sonner"
import { GitBranchIcon, Link2Icon, SaveIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { ComparisonChart } from "@/components/comparison-chart"
import { DevelopmentPrototype } from "@/components/development-prototype"
import { PageHeader } from "@/components/page-header"
import { getRoastDetail, roastSummaries } from "@/data/demo"
import { formatDuration, formatScore } from "@/lib/format"
import { useWorkspaceStore } from "@/stores/workspace-store"

export function CompareScreen() {
  return (
    <DevelopmentPrototype
      title="Compare roasts"
      description="Historical comparison requires persisted comparison and conclusion APIs"
    >
      <DemoCompareScreen />
    </DevelopmentPrototype>
  )
}

function DemoCompareScreen() {
  const selectedIds = useWorkspaceStore((state) => state.selectedRoastIds)
  const toggle = useWorkspaceStore((state) => state.addToComparison)
  const clear = useWorkspaceStore((state) => state.clearComparison)
  const initialIds =
    selectedIds.length >= 2
      ? selectedIds
      : roastSummaries.slice(0, 3).map((roast) => roast.id)
  const roasts = useMemo(
    () => initialIds.slice(0, 4).map(getRoastDetail),
    [initialIds]
  )
  const [alignment, setAlignment] = useState<
    "time" | "first-crack" | "normalized"
  >("first-crack")
  const [conclusion, setConclusion] = useState(
    "Revision 8 preserves the floral lift of r7 while adding sweetness after first crack. Keep r8 as the lot reference."
  )

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Compare roasts"
        description={`${roasts.length} overlays · align events, inspect metrics and save a conclusion back to the coffee lot`}
        actions={
          <>
            <Button variant="outline" onClick={clear}>
              <XIcon data-icon="inline-start" />
              Clear selection
            </Button>
            <Button
              onClick={() =>
                toast.success("Comparison saved to the coffee lot")
              }
            >
              <SaveIcon data-icon="inline-start" />
              Save comparison
            </Button>
          </>
        }
      />

      <div className="px-5 py-6 sm:px-7">
        <section
          className="bg-card flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Comparison controls"
        >
          <div className="flex flex-wrap gap-2">
            {roasts.map((roast, index) => (
              <Badge
                key={roast.id}
                variant={
                  index === 0
                    ? "default"
                    : index === 1
                      ? "info"
                      : index === 2
                        ? "success"
                        : "warning"
                }
              >
                {roast.coffeeName} · r{roast.profileRevision}
                <button
                  type="button"
                  onClick={() => toggle(roast.id)}
                  aria-label={`Remove ${roast.coffeeName} revision ${roast.profileRevision}`}
                  className="ml-1 rounded-full"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <ToggleGroup
            value={[alignment]}
            onValueChange={(value) => {
              const next = value.at(-1)
              if (
                next === "time" ||
                next === "first-crack" ||
                next === "normalized"
              )
                setAlignment(next)
            }}
            variant="outline"
            spacing={0}
            aria-label="Curve alignment"
          >
            <ToggleGroupItem value="time">Elapsed</ToggleGroupItem>
            <ToggleGroupItem value="first-crack">First crack</ToggleGroupItem>
            <ToggleGroupItem value="normalized">Normalized</ToggleGroupItem>
          </ToggleGroup>
        </section>

        <section
          className="bg-card mt-6 overflow-hidden rounded-xl border"
          aria-labelledby="comparison-chart-heading"
        >
          <div className="border-b px-5 py-4">
            <h2 id="comparison-chart-heading" className="font-semibold">
              Temperature overlays
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Aligned by{" "}
              {alignment === "first-crack"
                ? "first crack"
                : alignment === "normalized"
                  ? "normalized roast progress"
                  : "absolute elapsed time"}
            </p>
          </div>
          <ComparisonChart roasts={roasts} alignment={alignment} />
        </section>

        <section
          className="bg-card mt-6 overflow-hidden rounded-xl border"
          aria-labelledby="comparison-metrics-heading"
        >
          <div className="border-b px-5 py-4">
            <h2 id="comparison-metrics-heading" className="font-semibold">
              Metrics
            </h2>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="bg-muted text-muted-foreground grid grid-cols-[minmax(220px,1fr)_100px_120px_120px_100px_110px] gap-4 border-b px-5 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
                <span>Roast</span>
                <span>Duration</span>
                <span>Development</span>
                <span>Weight loss</span>
                <span>Score</span>
                <span>Result</span>
              </div>
              <div className="divide-y">
                {roasts.map((roast, index) => (
                  <div
                    key={roast.id}
                    className="grid grid-cols-[minmax(220px,1fr)_100px_120px_120px_100px_110px] items-center gap-4 px-5 py-4 text-sm"
                  >
                    <span>
                      <strong>{roast.coffeeName}</strong>
                      <small className="text-muted-foreground ml-2">
                        r{roast.profileRevision}
                      </small>
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatDuration(roast.durationSeconds)}
                    </span>
                    <span className="font-mono tabular-nums">
                      {roast.developmentPercent.toFixed(1)}%
                    </span>
                    <span className="font-mono tabular-nums">
                      {roast.lossPercent.toFixed(1)}%
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums">
                      {formatScore(roast.score)}
                    </span>
                    <Badge variant={index === 0 ? "success" : "secondary"}>
                      {index === 0 ? "Reference" : "Compared"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <Field className="bg-card rounded-xl border p-5">
            <FieldLabel htmlFor="comparison-conclusion">
              Comparison conclusion
            </FieldLabel>
            <Textarea
              id="comparison-conclusion"
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
              rows={4}
            />
            <FieldDescription>
              This conclusion becomes visible when planning the next roast for
              this coffee lot.
            </FieldDescription>
          </Field>
          <div className="bg-info rounded-xl border p-5">
            <Link2Icon className="text-primary size-5" />
            <h2 className="mt-3 font-semibold">Create the next revision</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Carry this evidence and conclusion into a reviewable profile
              proposal.
            </p>
            <Button
              variant="outline"
              className="bg-card mt-4 w-full"
              onClick={() =>
                toast.info(
                  "Comparison evidence attached to a new profile draft"
                )
              }
            >
              <GitBranchIcon data-icon="inline-start" />
              Profile draft
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
