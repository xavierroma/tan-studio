import { invariant } from "./errors"

export function requiredText(
  value: string,
  field: string,
  maxCodePoints = 200
): string {
  const cleaned = value.trim().normalize("NFC")
  invariant(cleaned.length > 0, "required_text", `${field} is required`, field)
  invariant(
    [...cleaned].length <= maxCodePoints,
    "text_too_long",
    `${field} is too long`,
    field,
    { maxCodePoints }
  )
  return cleaned
}

export function optionalText(
  value: string | null | undefined,
  field: string,
  maxCodePoints = 2_000
): string | null {
  if (value === null || value === undefined || value.trim().length === 0)
    return null
  return requiredText(value, field, maxCodePoints)
}

export function normalizedLookup(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und")
}

export function normalizedStringSet(
  values: readonly string[],
  field: string,
  maxItems = 50
): readonly string[] {
  invariant(
    values.length <= maxItems,
    "too_many_values",
    `${field} has too many values`,
    field,
    { maxItems }
  )
  const byNormalized = new Map<string, string>()
  for (const value of values) {
    const cleaned = requiredText(value, field, 100)
    const key = normalizedLookup(cleaned)
    invariant(
      !byNormalized.has(key),
      "duplicate_value",
      `${field} contains a duplicate value`,
      field,
      { value: cleaned }
    )
    byNormalized.set(key, cleaned)
  }
  return Object.freeze([...byNormalized.values()])
}

export function assertIanaTimezone(value: string): string {
  const cleaned = requiredText(value, "timezone", 100)
  try {
    new Intl.DateTimeFormat("en", { timeZone: cleaned }).format(0)
  } catch {
    invariant(
      false,
      "invalid_timezone",
      "Timezone must be a valid IANA timezone",
      "timezone"
    )
  }
  return cleaned
}
