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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tan-studio/ui/components/tabs"
import { toast } from "sonner"
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleHelpIcon,
  GitBranchIcon,
  LockKeyholeIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/page-header"
import { DevelopmentPrototype } from "@/components/development-prototype"
import { RoastChart } from "@/components/roast-chart"
import { profilePoints } from "@/data/demo"
import type { ChartPoint } from "@/types"

export function ProfileEditorScreen() {
  return (
    <DevelopmentPrototype
      title="Profile revisions"
      description="Profile editing and AI proposals remain disabled until lossless profile persistence is connected"
    >
      <DemoProfileEditorScreen />
    </DevelopmentPrototype>
  )
}

function DemoProfileEditorScreen() {
  const [revision, setRevision] = useState(8)
  const [endTemperature, setEndTemperature] = useState(207)
  const [developmentSeconds, setDevelopmentSeconds] = useState(72)
  const [proposalVisible, setProposalVisible] = useState(true)

  const chart = useMemo<ChartPoint[]>(
    () =>
      profilePoints.map(([seconds, temperature], index) => ({
        elapsedMs: seconds * 1_000,
        temperatureC: temperature,
        profileC: temperature + (proposalVisible && index > 6 ? 1.2 : 0),
        rorCPerMin: Math.max(2.4, 24 - index * 2.35),
      })),
    [proposalVisible]
  )

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Profile family · Washed floral"
        title="Washed floral · gentle finish"
        description={`Revision ${revision} · Compatible with Nano 7 · Local immutable history`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => toast.success("Profile validation passed")}
            >
              <CheckCircle2Icon data-icon="inline-start" />
              Validate
            </Button>
            <Button
              onClick={() => {
                setRevision((value) => value + 1)
                toast.success("New local profile revision created")
              }}
            >
              <GitBranchIcon data-icon="inline-start" />
              Create revision
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[17rem_minmax(0,1fr)_22rem]">
        <aside className="min-w-0">
          <section
            className="bg-card overflow-hidden rounded-xl border"
            aria-labelledby="profile-history-heading"
          >
            <div className="border-b p-4">
              <h2 id="profile-history-heading" className="font-semibold">
                Revision history
              </h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Every accepted change creates a new revision.
              </p>
            </div>
            <div className="divide-y">
              {[8, 7, 6, 5].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRevision(item)}
                  aria-pressed={revision === item}
                  className="hover:bg-secondary/40 aria-pressed:bg-accent/30 flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors"
                >
                  <span className="bg-secondary flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold">
                    r{item}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {item === 8
                        ? "Gentler finish"
                        : item === 7
                          ? "Longer development"
                          : "Profile refinement"}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {item === 8 ? "Jul 17" : `Jun ${item + 10}`} ·{" "}
                      {item === 8 ? "current" : "historical"}
                    </span>
                  </span>
                  <ChevronRightIcon className="text-muted-foreground size-4" />
                </button>
              ))}
            </div>
          </section>

          <section
            className="bg-card mt-5 rounded-xl border p-4"
            aria-labelledby="profile-use-heading"
          >
            <h2 id="profile-use-heading" className="font-semibold">
              Evidence
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Roasts</dt>
                <dd className="mt-1 font-mono text-lg font-semibold">18</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Tastings</dt>
                <dd className="mt-1 font-mono text-lg font-semibold">14</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Best score</dt>
                <dd className="text-primary mt-1 font-mono text-lg font-semibold">
                  88.25
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Median</dt>
                <dd className="mt-1 font-mono text-lg font-semibold">86.9</dd>
              </div>
            </dl>
          </section>
        </aside>

        <main className="min-w-0">
          <section
            className="bg-card overflow-hidden rounded-xl border"
            aria-labelledby="profile-curve-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 id="profile-curve-heading" className="font-semibold">
                  Temperature profile
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Drag-point editing follows deterministic Nano profile
                  constraints.
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">Current r{revision}</Badge>
                {proposalVisible ? (
                  <Badge variant="info">Proposal preview</Badge>
                ) : null}
              </div>
            </div>
            <RoastChart points={chart} height={430} />
          </section>

          <section
            className="bg-card mt-6 rounded-xl border p-5"
            aria-labelledby="profile-settings-heading"
          >
            <h2 id="profile-settings-heading" className="font-semibold">
              Progressive settings
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Changes remain local until a compatible, reviewed device-write
              protocol is enabled.
            </p>
            <FieldGroup className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="end-temperature">
                  End temperature
                </FieldLabel>
                <Input
                  id="end-temperature"
                  type="number"
                  value={endTemperature}
                  onChange={(event) =>
                    setEndTemperature(event.target.valueAsNumber)
                  }
                />
                <FieldDescription>
                  °C · proposal suggests 208.2°C
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="development-time">
                  Development time
                </FieldLabel>
                <Input
                  id="development-time"
                  type="number"
                  value={developmentSeconds}
                  onChange={(event) =>
                    setDevelopmentSeconds(event.target.valueAsNumber)
                  }
                />
                <FieldDescription>seconds after first crack</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="preheat">Preheat target</FieldLabel>
                <Input id="preheat" type="number" defaultValue={160} />
                <FieldDescription>
                  °C · device-compatible range
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="load">Reference load</FieldLabel>
                <Input id="load" type="number" defaultValue={100} />
                <FieldDescription>grams of green coffee</FieldDescription>
              </Field>
            </FieldGroup>
          </section>

          <Alert className="bg-info mt-6">
            <LockKeyholeIcon />
            <AlertTitle>
              Device deployment is intentionally read-only
            </AlertTitle>
            <AlertDescription>
              Tan Studio can import, edit, validate and version this profile.
              Writing it to the roaster remains disabled until legitimate Studio
              traffic is captured and the command contract is proven safe.
            </AlertDescription>
          </Alert>
        </main>

        <aside className="min-w-0">
          <section
            className="bg-card rounded-xl border"
            aria-labelledby="ai-proposal-heading"
          >
            <div className="border-b p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="bg-info flex size-9 items-center justify-center rounded-full">
                  <WandSparklesIcon className="size-4" />
                </span>
                <Badge variant="info">Review required</Badge>
              </div>
              <h2 id="ai-proposal-heading" className="mt-4 font-semibold">
                Evidence-assisted proposal
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Based on 6 selected roasts and 5 promoted tastings.
              </p>
            </div>
            <Tabs defaultValue="changes" className="p-5">
              <TabsList className="w-full">
                <TabsTrigger value="changes">Changes</TabsTrigger>
                <TabsTrigger value="context">Context</TabsTrigger>
              </TabsList>
              <TabsContent value="changes" className="pt-4">
                <div className="space-y-4">
                  <div className="bg-secondary rounded-lg p-3">
                    <p className="text-muted-foreground text-xs font-semibold uppercase">
                      Finish target
                    </p>
                    <p className="mt-2 font-mono text-sm">
                      <del className="text-muted-foreground">207.0°C</del> →{" "}
                      <strong>208.2°C</strong>
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                      Supports more sweetness after three cups described the
                      finish as quick.
                    </p>
                  </div>
                  <div className="bg-secondary rounded-lg p-3">
                    <p className="text-muted-foreground text-xs font-semibold uppercase">
                      Post-crack time
                    </p>
                    <p className="mt-2 font-mono text-sm">
                      <del className="text-muted-foreground">72 s</del> →{" "}
                      <strong>82 s</strong>
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                      Keeps the same first-crack timing while lengthening
                      development.
                    </p>
                  </div>
                </div>
              </TabsContent>
              <TabsContent
                value="context"
                className="text-muted-foreground pt-4 text-sm leading-relaxed"
              >
                Coffee identity, profile revisions, roast metrics, promoted
                tasting summaries and your selected next-roast conclusions. Raw
                notes outside this selection are excluded.
              </TabsContent>
            </Tabs>
            <div className="border-t p-5">
              <div className="text-muted-foreground flex items-start gap-2 text-xs">
                <CircleHelpIcon className="mt-0.5 size-4 shrink-0" />
                <p>
                  Medium confidence. The latest roast has only one tasting; cup
                  again after day 10.
                </p>
              </div>
              <Button
                className="mt-4 w-full"
                onClick={() => {
                  setEndTemperature(208.2)
                  setDevelopmentSeconds(82)
                  setProposalVisible(false)
                  toast.success("Proposal accepted into a new local draft")
                }}
              >
                <SparklesIcon data-icon="inline-start" />
                Accept into draft
              </Button>
              <Button
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => setProposalVisible(false)}
              >
                Dismiss proposal
              </Button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
