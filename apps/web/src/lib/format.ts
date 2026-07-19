export const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
})

export const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

export function formatRoastDate(value: string | null) {
  if (value == null) {
    return { date: "Date unavailable", time: "" }
  }
  const date = new Date(value)
  return {
    date: dateFormatter.format(date),
    time: timeFormatter.format(date),
  }
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function formatElapsed(elapsedMs: number) {
  return formatDuration(elapsedMs / 1_000)
}

export function formatMass(massKg: number) {
  return massKg < 1
    ? `${Math.round(massKg * 1_000)} g`
    : `${massKg.toFixed(2)} kg`
}

export function formatScore(score: number | null) {
  return score == null ? "—" : score.toFixed(score % 1 === 0 ? 0 : 2)
}
