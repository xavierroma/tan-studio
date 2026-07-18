import type { CoffeeId } from "../shared/ids"
import type { InstantMs, Revision } from "../shared/units"
import { nextRevision, revision } from "../shared/units"
import { invariant } from "../shared/errors"
import {
  normalizedLookup,
  normalizedStringSet,
  optionalText,
  requiredText,
} from "../shared/text"

export type CoffeeIdentity = Readonly<{
  id: CoffeeId
  displayName: string
  normalizedName: string
  countryCode: string | null
  region: string | null
  farmProducer: string | null
  stationCooperative: string | null
  process: string | null
  varieties: readonly string[]
  altitudeMinMetres: number | null
  altitudeMaxMetres: number | null
  harvestLabel: string | null
  notes: string | null
  archivedAt: InstantMs | null
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type CreateCoffeeIdentityInput = Readonly<{
  id: CoffeeId
  displayName: string
  countryCode?: string | null
  region?: string | null
  farmProducer?: string | null
  stationCooperative?: string | null
  process?: string | null
  varieties?: readonly string[]
  altitudeMinMetres?: number | null
  altitudeMaxMetres?: number | null
  harvestLabel?: string | null
  notes?: string | null
  now: InstantMs
}>

function countryCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null
  const code = value.trim().toUpperCase()
  invariant(
    /^[A-Z]{2}$/.test(code),
    "invalid_country_code",
    "Country code must be ISO 3166-1 alpha-2",
    "countryCode"
  )
  return code
}

function altitude(
  value: number | null | undefined,
  field: string
): number | null {
  if (value === null || value === undefined) return null
  invariant(
    Number.isSafeInteger(value) && value >= -500 && value <= 10_000,
    "invalid_altitude",
    `${field} is outside the supported range`,
    field
  )
  return value
}

export function createCoffeeIdentity(
  input: CreateCoffeeIdentityInput
): CoffeeIdentity {
  const displayName = requiredText(input.displayName, "displayName")
  const min = altitude(input.altitudeMinMetres, "altitudeMinMetres")
  const max = altitude(input.altitudeMaxMetres, "altitudeMaxMetres")
  invariant(
    min === null || max === null || min <= max,
    "invalid_altitude_range",
    "Minimum altitude cannot exceed maximum altitude",
    "altitudeMinMetres"
  )

  return Object.freeze({
    id: input.id,
    displayName,
    normalizedName: normalizedLookup(displayName),
    countryCode: countryCode(input.countryCode),
    region: optionalText(input.region, "region", 200),
    farmProducer: optionalText(input.farmProducer, "farmProducer", 200),
    stationCooperative: optionalText(
      input.stationCooperative,
      "stationCooperative",
      200
    ),
    process: optionalText(input.process, "process", 200),
    varieties: normalizedStringSet(input.varieties ?? [], "varieties"),
    altitudeMinMetres: min,
    altitudeMaxMetres: max,
    harvestLabel: optionalText(input.harvestLabel, "harvestLabel", 100),
    notes: optionalText(input.notes, "notes", 10_000),
    archivedAt: null,
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type UpdateCoffeeIdentityInput = Readonly<{
  displayName?: string
  countryCode?: string | null
  region?: string | null
  farmProducer?: string | null
  stationCooperative?: string | null
  process?: string | null
  varieties?: readonly string[]
  altitudeMinMetres?: number | null
  altitudeMaxMetres?: number | null
  harvestLabel?: string | null
  notes?: string | null
}>

export function updateCoffeeIdentity(
  coffee: CoffeeIdentity,
  patch: UpdateCoffeeIdentityInput,
  now: InstantMs
): CoffeeIdentity {
  const displayName =
    patch.displayName === undefined
      ? coffee.displayName
      : requiredText(patch.displayName, "displayName")
  const min =
    patch.altitudeMinMetres === undefined
      ? coffee.altitudeMinMetres
      : altitude(patch.altitudeMinMetres, "altitudeMinMetres")
  const max =
    patch.altitudeMaxMetres === undefined
      ? coffee.altitudeMaxMetres
      : altitude(patch.altitudeMaxMetres, "altitudeMaxMetres")
  invariant(
    min === null || max === null || min <= max,
    "invalid_altitude_range",
    "Minimum altitude cannot exceed maximum altitude",
    "altitudeMinMetres"
  )
  return Object.freeze({
    ...coffee,
    displayName,
    normalizedName: normalizedLookup(displayName),
    countryCode:
      patch.countryCode === undefined
        ? coffee.countryCode
        : countryCode(patch.countryCode),
    region:
      patch.region === undefined
        ? coffee.region
        : optionalText(patch.region, "region", 200),
    farmProducer:
      patch.farmProducer === undefined
        ? coffee.farmProducer
        : optionalText(patch.farmProducer, "farmProducer", 200),
    stationCooperative:
      patch.stationCooperative === undefined
        ? coffee.stationCooperative
        : optionalText(patch.stationCooperative, "stationCooperative", 200),
    process:
      patch.process === undefined
        ? coffee.process
        : optionalText(patch.process, "process", 200),
    varieties:
      patch.varieties === undefined
        ? coffee.varieties
        : normalizedStringSet(patch.varieties, "varieties"),
    altitudeMinMetres: min,
    altitudeMaxMetres: max,
    harvestLabel:
      patch.harvestLabel === undefined
        ? coffee.harvestLabel
        : optionalText(patch.harvestLabel, "harvestLabel", 100),
    notes:
      patch.notes === undefined
        ? coffee.notes
        : optionalText(patch.notes, "notes", 10_000),
    revision: nextRevision(coffee.revision),
    updatedAt: now,
  })
}

export function archiveCoffeeIdentity(
  coffee: CoffeeIdentity,
  now: InstantMs
): CoffeeIdentity {
  if (coffee.archivedAt !== null) return coffee
  return Object.freeze({
    ...coffee,
    archivedAt: now,
    revision: nextRevision(coffee.revision),
    updatedAt: now,
  })
}
