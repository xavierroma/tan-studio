export function gramsToMilligrams(grams: number): number {
  return Math.round(grams * 1_000)
}

export function celsiusToMilliCelsius(celsius: number): number {
  return Math.round(celsius * 1_000)
}

export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * 100)
}

export function millimetersToMicrometers(millimeters: number): number {
  return Math.round(millimeters * 1_000)
}
