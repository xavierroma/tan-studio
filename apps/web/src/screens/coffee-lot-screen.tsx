import { Link, useParams } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CoffeeIcon,
  GitCompareArrowsIcon,
  SaveIcon,
  SparklesIcon,
} from "lucide-react"
import { useState } from "react"

import { Metric } from "@/components/metric"
import { DevelopmentPrototype } from "@/components/development-prototype"
import { PageHeader } from "@/components/page-header"
import { coffeeLots, roastSummaries } from "@/data/demo"
import { formatRoastDate, formatScore } from "@/lib/format"

export function CoffeeLotScreen() {
  return (
    <DevelopmentPrototype
      title="Coffee lot history"
      description="Lot history and structured tasting writes require the complete catalog workflow API"
    >
      <DemoCoffeeLotScreen />
    </DevelopmentPrototype>
  )
}

function DemoCoffeeLotScreen() {
  const { lotId } = useParams({ strict: false }) as { lotId: string }
  const lot =
    coffeeLots.find((candidate) => candidate.id === lotId) ?? coffeeLots[0]!
  const roasts = roastSummaries.filter((roast) => roast.lotCode === lot.lotCode)
  const [score, setScore] = useState(88.25)
  const [notes, setNotes] = useState(
    "Jasmine, white peach and bergamot. Clean, buoyant acidity with a sweeter finish than revision 7."
  )
  const [nextAction, setNextAction] = useState(lot.nextAction)

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={`${lot.providerName} · ${lot.providerReference}`}
        title={lot.coffeeName}
        description={`${lot.farm} · ${lot.region}, ${lot.country} · ${lot.process} · Lot ${lot.lotCode}`}
        actions={
          <>
            <Button
              nativeButton={false}
              variant="ghost"
              render={<Link to="/coffees" />}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Catalog
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link to="/compare" />}
            >
              <GitCompareArrowsIcon data-icon="inline-start" />
              Compare history
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/preflight" search={{ lotId: lot.id }} />}
            >
              Plan next roast
            </Button>
          </>
        }
      />

      <div className="px-5 py-6 sm:px-7">
        <section
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
          aria-label="Coffee lot summary"
        >
          <div className="bg-card rounded-xl border p-5 sm:col-span-2 xl:col-span-1">
            <span className="bg-success flex size-9 items-center justify-center rounded-full">
              <CoffeeIcon className="size-4" />
            </span>
            <p className="mt-3 font-semibold">{lot.variety}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {lot.harvest} · {lot.altitude}
            </p>
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="On hand"
              value={`${lot.onHandKg.toFixed(2)} kg`}
              detail={lot.storage}
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Roasts"
              value={lot.roastCount}
              detail={`${roasts.length} shown in current view`}
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Latest score"
              value={formatScore(lot.latestScore)}
              detail="Promoted tasting"
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Best score"
              value={formatScore(lot.bestScore)}
              detail="Lot reference"
            />
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <main className="min-w-0">
            <section
              className="bg-card overflow-hidden rounded-xl border"
              aria-labelledby="lot-roasts-heading"
            >
              <div className="border-b p-5">
                <h2 id="lot-roasts-heading" className="font-semibold">
                  Roast history
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Every roast of this physical green lot, with its profile
                  revision and feedback.
                </p>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="bg-muted text-muted-foreground grid grid-cols-[130px_minmax(190px,1fr)_100px_110px_100px_minmax(180px,1fr)] gap-4 border-b px-5 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
                    <span>Date</span>
                    <span>Profile</span>
                    <span>Duration</span>
                    <span>Development</span>
                    <span>Score</span>
                    <span>Notes</span>
                  </div>
                  <div className="divide-y">
                    {roasts.map((roast) => {
                      const date = formatRoastDate(roast.roastedAt)
                      return (
                        <Link
                          key={roast.id}
                          to="/roasts/$roastId"
                          params={{ roastId: roast.id }}
                          className="hover:bg-secondary/40 grid grid-cols-[130px_minmax(190px,1fr)_100px_110px_100px_minmax(180px,1fr)] items-center gap-4 px-5 py-4 text-sm"
                        >
                          <span className="font-mono text-xs">
                            <strong className="block">{date.date}</strong>
                            <small className="text-muted-foreground">
                              {date.time}
                            </small>
                          </span>
                          <span>
                            <strong className="block truncate">
                              {roast.profileName}
                            </strong>
                            <small className="text-muted-foreground">
                              Revision {roast.profileRevision}
                            </small>
                          </span>
                          <span className="font-mono">
                            {Math.floor(roast.durationSeconds / 60)}:
                            {String(roast.durationSeconds % 60).padStart(
                              2,
                              "0"
                            )}
                          </span>
                          <span className="font-mono">
                            {roast.developmentPercent}%
                          </span>
                          <span className="text-primary font-mono text-lg font-semibold">
                            {formatScore(roast.score)}
                          </span>
                          <span className="text-muted-foreground line-clamp-2 text-xs">
                            {roast.tastingNotes || "Tasting due"}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section
              className="bg-success mt-6 rounded-xl border p-5"
              aria-labelledby="lot-conclusion-heading"
            >
              <SparklesIcon className="text-primary size-5" />
              <h2 id="lot-conclusion-heading" className="mt-3 font-semibold">
                Current next-roast conclusion
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {nextAction}
              </p>
            </section>
          </main>

          <aside
            className="bg-card rounded-xl border p-5"
            aria-labelledby="new-tasting-heading"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="new-tasting-heading" className="font-semibold">
                  Structured tasting
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Latest roast · revision 8
                </p>
              </div>
              <Badge variant="success">Draft</Badge>
            </div>
            <FieldGroup className="mt-5">
              <Field>
                <FieldLabel htmlFor="tasting-score">Overall score</FieldLabel>
                <Input
                  id="tasting-score"
                  type="number"
                  min={0}
                  max={100}
                  step={0.25}
                  value={score}
                  onChange={(event) => setScore(event.target.valueAsNumber)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="aroma-score">Aroma</FieldLabel>
                  <Input
                    id="aroma-score"
                    type="number"
                    defaultValue={8.75}
                    step={0.25}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="acidity-score">Acidity</FieldLabel>
                  <Input
                    id="acidity-score"
                    type="number"
                    defaultValue={8.5}
                    step={0.25}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sweetness-score">Sweetness</FieldLabel>
                  <Input
                    id="sweetness-score"
                    type="number"
                    defaultValue={8.75}
                    step={0.25}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="finish-score">Finish</FieldLabel>
                  <Input
                    id="finish-score"
                    type="number"
                    defaultValue={8.25}
                    step={0.25}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="tasting-notes">Tasting notes</FieldLabel>
                <Textarea
                  id="tasting-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                />
                <FieldDescription>
                  Use searchable sensory language and note how the cup changes
                  as it cools.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="next-action">
                  Next-roast conclusion
                </FieldLabel>
                <Textarea
                  id="next-action"
                  value={nextAction}
                  onChange={(event) => setNextAction(event.target.value)}
                  rows={4}
                />
                <FieldDescription>
                  Shown during preflight for the next roast of this coffee.
                </FieldDescription>
              </Field>
              <Button
                onClick={() =>
                  toast.success(
                    "Tasting and next-roast conclusion saved locally"
                  )
                }
              >
                <SaveIcon data-icon="inline-start" />
                Save tasting
              </Button>
            </FieldGroup>
          </aside>
        </div>
      </div>
    </div>
  )
}
