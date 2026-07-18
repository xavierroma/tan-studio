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
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { toast } from "sonner"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CoffeeIcon,
  HistoryIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"
import { useState } from "react"

import { Metric } from "@/components/metric"
import { DevelopmentPrototype } from "@/components/development-prototype"
import { PageHeader } from "@/components/page-header"
import { coffeeLots, roastSummaries } from "@/data/demo"
import { formatDuration, formatScore } from "@/lib/format"

export function PreflightScreen() {
  return (
    <DevelopmentPrototype
      title="Plan the next roast"
      description="Preflight becomes available after profile revisions and validated device capabilities are connected"
    >
      <DemoPreflightScreen />
    </DevelopmentPrototype>
  )
}

function DemoPreflightScreen() {
  const [lotId, setLotId] = useState(coffeeLots[0]!.id)
  const [profile, setProfile] = useState("washed-r8")
  const [level, setLevel] = useState(2.6)
  const [load, setLoad] = useState(100)
  const lot =
    coffeeLots.find((candidate) => candidate.id === lotId) ?? coffeeLots[0]!
  const previous = roastSummaries.filter(
    (roast) => roast.lotCode === lot.lotCode
  )
  const best = previous.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Physical start remains on Nano 7"
        title="Plan the next roast"
        description="Choose coffee, profile, level and load with the lot’s prior roasts and tasting conclusions beside you"
        actions={
          <Badge variant="info">
            <ShieldCheckIcon data-icon="inline-start" />
            Preflight only
          </Badge>
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="min-w-0">
          <section
            className="bg-card rounded-xl border p-5"
            aria-labelledby="roast-setup-heading"
          >
            <div className="flex items-start gap-3">
              <span className="bg-success flex size-10 shrink-0 items-center justify-center rounded-full">
                <CoffeeIcon className="size-5" />
              </span>
              <div>
                <h2 id="roast-setup-heading" className="font-semibold">
                  Roast setup
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Parameters are validated against local profile and device
                  capabilities.
                </p>
              </div>
            </div>
            <FieldGroup className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel>Coffee lot</FieldLabel>
                <Select
                  value={lotId}
                  onValueChange={(value) =>
                    setLotId(value ?? coffeeLots[0]!.id)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {coffeeLots.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.coffeeName} · {item.lotCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {lot.onHandKg.toFixed(2)} kg on hand · {lot.storage}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Profile revision</FieldLabel>
                <Select
                  value={profile}
                  onValueChange={(value) => setProfile(value ?? "washed-r8")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="washed-r8">
                      Washed floral · gentle finish · r8
                    </SelectItem>
                    <SelectItem value="pink-r4">
                      Pink Bourbon clarity · r4
                    </SelectItem>
                    <SelectItem value="natural-r5">
                      Natural · fruit restraint · r5
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Immutable local revision · compatibility passed
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="preflight-level">Roast level</FieldLabel>
                <Input
                  id="preflight-level"
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={level}
                  onChange={(event) => setLevel(event.target.valueAsNumber)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="preflight-load">
                  Green input load · g
                </FieldLabel>
                <Input
                  id="preflight-load"
                  type="number"
                  min={50}
                  max={200}
                  value={load}
                  onChange={(event) => setLoad(event.target.valueAsNumber)}
                />
                <FieldDescription>
                  Inventory allocation occurs only after a completed/imported
                  roast.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </section>

          <section className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="bg-card rounded-xl border p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Previous best</h2>
                <Badge variant="success">Lot reference</Badge>
              </div>
              {best ? (
                <>
                  <p className="mt-4 text-lg font-semibold">
                    {best.profileName} · r{best.profileRevision}
                  </p>
                  <div className="mt-5 grid grid-cols-3 gap-4">
                    <Metric label="Score" value={formatScore(best.score)} />
                    <Metric
                      label="Duration"
                      value={formatDuration(best.durationSeconds)}
                    />
                    <Metric
                      label="Development"
                      value={`${best.developmentPercent}%`}
                    />
                  </div>
                  <p className="text-muted-foreground mt-5 border-t pt-4 text-sm leading-relaxed">
                    {best.tastingNotes}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground mt-4 text-sm">
                  No prior roast for this lot.
                </p>
              )}
            </div>
            <div className="bg-success rounded-xl border p-5">
              <SparklesIcon className="text-primary size-5" />
              <h2 className="mt-3 font-semibold">
                Tasting-derived next action
              </h2>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {lot.nextAction}
              </p>
              <div className="mt-5 border-t pt-4">
                <p className="text-muted-foreground text-xs font-semibold uppercase">
                  Selected setup
                </p>
                <p className="mt-2 font-mono text-sm">
                  Level {level.toFixed(1)} · {load} g ·{" "}
                  {profile.split("-").at(-1)}
                </p>
              </div>
            </div>
          </section>

          <section
            className="bg-card mt-6 rounded-xl border p-5"
            aria-labelledby="preflight-checks-heading"
          >
            <h2 id="preflight-checks-heading" className="font-semibold">
              Preflight checks
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["Profile constraints", "Validated locally"],
                ["Nano compatibility", "Model KN1007B"],
                ["Telemetry capture", "Ready · local database"],
                ["Operator presence", "Confirm at the roaster"],
              ].map(([label, detail], index) => (
                <div
                  key={label}
                  className="bg-secondary flex items-start gap-3 rounded-lg p-3"
                >
                  {index === 3 ? (
                    <CircleAlertIcon className="text-primary mt-0.5 size-4" />
                  ) : (
                    <CheckCircle2Icon className="text-primary mt-0.5 size-4" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside className="min-w-0">
          <section
            className="bg-card rounded-xl border p-5"
            aria-labelledby="prediction-heading"
          >
            <HistoryIcon className="text-primary size-5" />
            <h2 id="prediction-heading" className="mt-3 font-semibold">
              Prediction
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Derived from this profile and comparable roasts—not a control
              guarantee.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-5">
              <Metric label="First crack" value="7:29" detail="± 18 seconds" />
              <Metric label="Finish" value="8:41" detail="± 22 seconds" />
              <Metric label="Roasted mass" value="87.4 g" detail="12.6% loss" />
              <Metric
                label="End temp"
                value="205.4°"
                detail="measured estimate"
              />
            </div>
          </section>

          <Alert className="bg-warning mt-5">
            <ScaleIcon />
            <AlertTitle>Check the physical load</AlertTitle>
            <AlertDescription>
              Weigh {load} g of green coffee and confirm the profile on the Nano
              display before starting.
            </AlertDescription>
          </Alert>

          <section className="bg-info mt-5 rounded-xl border p-5">
            <ShieldCheckIcon className="text-primary size-5" />
            <h2 className="mt-3 font-semibold">Ready for physical handoff</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              This screen never starts the roaster. Continue at the Nano with a
              nearby operator.
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() =>
                toast.success(
                  "Preflight saved; begin the roast on the physical Nano"
                )
              }
            >
              Save preflight
            </Button>
          </section>
        </aside>
      </div>
    </div>
  )
}
