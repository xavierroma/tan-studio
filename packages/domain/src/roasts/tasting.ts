import type { RoastId, TastingId, TastingScaleRevisionId } from "../shared/ids"
import type {
  BasisPoints,
  DurationMs,
  InstantMs,
  MassMg,
  TemperatureMilliC,
} from "../shared/units"
import {
  basisPoints,
  durationMs,
  positiveMassMg,
  temperatureMilliC,
} from "../shared/units"
import { invariant } from "../shared/errors"
import {
  assertIanaTimezone,
  normalizedStringSet,
  optionalText,
} from "../shared/text"

export type TastingOutcome = "positive" | "mixed" | "negative" | "neutral"

export type BrewContext = Readonly<{
  method: string | null
  doseMassMg: MassMg | null
  beverageMassMg: MassMg | null
  waterTemperatureMilliC: TemperatureMilliC | null
  grindSetting: string | null
  notes: string | null
}>

export type BrewContextInput = Readonly<{
  method?: string | null
  doseMassMg?: number | null
  beverageMassMg?: number | null
  waterTemperatureMilliC?: number | null
  grindSetting?: string | null
  notes?: string | null
}>

export type Tasting = Readonly<{
  id: TastingId
  rootTastingId: TastingId
  supersedesTastingId: TastingId | null
  roastId: RoastId
  tastedAt: InstantMs
  sourceTimezone: string
  restAgeMs: DurationMs
  scaleRevisionId: TastingScaleRevisionId
  scoreBasisPoints: BasisPoints | null
  componentScores: Readonly<Record<string, BasisPoints>>
  descriptors: readonly string[]
  brewContext: BrewContext
  notes: string | null
  outcome: TastingOutcome
  worked: string | null
  didNotWork: string | null
  nextAction: string | null
  authorLabel: string | null
  createdAt: InstantMs
}>

export type TastingContent = Readonly<{
  tastedAt: InstantMs
  sourceTimezone: string
  restAgeMs: number
  scaleRevisionId: TastingScaleRevisionId
  scoreBasisPoints?: number | null
  componentScores?: Readonly<Record<string, number>>
  descriptors?: readonly string[]
  brewContext?: BrewContextInput
  notes?: string | null
  outcome: TastingOutcome
  worked?: string | null
  didNotWork?: string | null
  nextAction?: string | null
  authorLabel?: string | null
}>

function createComponentScores(
  values: Readonly<Record<string, number>>
): Readonly<Record<string, BasisPoints>> {
  const result: Record<string, BasisPoints> = Object.create(null)
  const entries = Object.entries(values)
  invariant(
    entries.length <= 50,
    "too_many_component_scores",
    "Too many tasting component scores",
    "componentScores"
  )
  for (const [rawKey, value] of entries) {
    const key = rawKey.trim()
    invariant(
      /^[a-z][a-z0-9_.-]{0,63}$/.test(key),
      "invalid_score_dimension",
      "Score dimension has an invalid key",
      "componentScores"
    )
    result[key] = basisPoints(value)
  }
  return Object.freeze(result)
}

function brewContext(input: BrewContextInput | undefined): BrewContext {
  const dose = input?.doseMassMg ?? null
  const beverage = input?.beverageMassMg ?? null
  return Object.freeze({
    method: optionalText(input?.method, "brewContext.method", 100),
    doseMassMg:
      dose === null ? null : positiveMassMg(dose, "brewContext.doseMassMg"),
    beverageMassMg:
      beverage === null
        ? null
        : positiveMassMg(beverage, "brewContext.beverageMassMg"),
    waterTemperatureMilliC:
      input?.waterTemperatureMilliC === null ||
      input?.waterTemperatureMilliC === undefined
        ? null
        : temperatureMilliC(input.waterTemperatureMilliC),
    grindSetting: optionalText(
      input?.grindSetting,
      "brewContext.grindSetting",
      100
    ),
    notes: optionalText(input?.notes, "brewContext.notes", 1_000),
  })
}

function content(input: TastingContent) {
  return {
    tastedAt: input.tastedAt,
    sourceTimezone: assertIanaTimezone(input.sourceTimezone),
    restAgeMs: durationMs(input.restAgeMs),
    scaleRevisionId: input.scaleRevisionId,
    scoreBasisPoints:
      input.scoreBasisPoints === null || input.scoreBasisPoints === undefined
        ? null
        : basisPoints(input.scoreBasisPoints),
    componentScores: createComponentScores(input.componentScores ?? {}),
    descriptors: normalizedStringSet(
      input.descriptors ?? [],
      "descriptors",
      100
    ),
    brewContext: brewContext(input.brewContext),
    notes: optionalText(input.notes, "notes", 10_000),
    outcome: input.outcome,
    worked: optionalText(input.worked, "worked", 2_000),
    didNotWork: optionalText(input.didNotWork, "didNotWork", 2_000),
    nextAction: optionalText(input.nextAction, "nextAction", 2_000),
    authorLabel: optionalText(input.authorLabel, "authorLabel", 100),
  } as const
}

export function createTasting(
  input: Readonly<
    { id: TastingId; roastId: RoastId; createdAt: InstantMs } & TastingContent
  >
): Tasting {
  return Object.freeze({
    id: input.id,
    rootTastingId: input.id,
    supersedesTastingId: null,
    roastId: input.roastId,
    ...content(input),
    createdAt: input.createdAt,
  })
}

export function reviseTasting(
  previous: Tasting,
  input: Readonly<{ id: TastingId; createdAt: InstantMs } & TastingContent>
): Tasting {
  invariant(
    input.id !== previous.id,
    "same_tasting_revision_id",
    "A tasting revision needs a new ID",
    "id"
  )
  return Object.freeze({
    id: input.id,
    rootTastingId: previous.rootTastingId,
    supersedesTastingId: previous.id,
    roastId: previous.roastId,
    ...content(input),
    createdAt: input.createdAt,
  })
}
