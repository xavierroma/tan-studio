import type { Brand } from "./ids"
import { invariant } from "./errors"

export type InstantMs = Brand<number, "unix-ms">
export type DurationMs = Brand<number, "duration-ms">
export type MassMg = Brand<number, "mass-mg">
export type BasisPoints = Brand<number, "basis-points">
export type TemperatureMilliC = Brand<number, "temperature-milli-celsius">
export type RoastLevelThousandths = Brand<number, "roast-level-thousandths">
export type MoneyMinorUnits = Brand<number, "money-minor-units">
export type Revision = Brand<number, "revision">

function safeInteger(value: number, field: string): void {
  invariant(
    Number.isSafeInteger(value),
    "unsafe_integer",
    `${field} must be a safe integer`,
    field
  )
}

export function instantMs(value: number): InstantMs {
  safeInteger(value, "instantMs")
  return value as InstantMs
}

export function durationMs(value: number): DurationMs {
  safeInteger(value, "durationMs")
  invariant(
    value >= 0,
    "negative_duration",
    "Duration cannot be negative",
    "durationMs"
  )
  return value as DurationMs
}

export function massMg(value: number): MassMg {
  safeInteger(value, "massMg")
  return value as MassMg
}

export function nonNegativeMassMg(value: number, field = "massMg"): MassMg {
  safeInteger(value, field)
  invariant(value >= 0, "negative_mass", `${field} cannot be negative`, field)
  return value as MassMg
}

export function positiveMassMg(value: number, field = "massMg"): MassMg {
  safeInteger(value, field)
  invariant(value > 0, "nonpositive_mass", `${field} must be positive`, field)
  return value as MassMg
}

export function basisPoints(value: number): BasisPoints {
  safeInteger(value, "basisPoints")
  invariant(
    value >= 0 && value <= 10_000,
    "basis_points_out_of_range",
    "Basis points must be between 0 and 10000",
    "basisPoints"
  )
  return value as BasisPoints
}

export function temperatureMilliC(value: number): TemperatureMilliC {
  safeInteger(value, "temperatureMilliC")
  invariant(
    value >= -273_150,
    "temperature_below_absolute_zero",
    "Temperature cannot be below absolute zero",
    "temperatureMilliC"
  )
  return value as TemperatureMilliC
}

export function roastLevelThousandths(value: number): RoastLevelThousandths {
  safeInteger(value, "roastLevelThousandths")
  invariant(
    value >= 0 && value <= 10_000,
    "roast_level_out_of_range",
    "Roast level must be between 0 and 10000 thousandths",
    "roastLevelThousandths"
  )
  return value as RoastLevelThousandths
}

export function moneyMinorUnits(value: number): MoneyMinorUnits {
  safeInteger(value, "moneyMinorUnits")
  invariant(
    value >= 0,
    "negative_money",
    "Money amount cannot be negative",
    "moneyMinorUnits"
  )
  return value as MoneyMinorUnits
}

export function revision(value: number): Revision {
  safeInteger(value, "revision")
  invariant(
    value >= 1,
    "invalid_revision",
    "Revision must be at least one",
    "revision"
  )
  return value as Revision
}

export function nextRevision(value: Revision): Revision {
  return revision(value + 1)
}
