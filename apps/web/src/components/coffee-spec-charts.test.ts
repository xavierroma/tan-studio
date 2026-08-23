import { describe, expect, test } from "vitest"

import { readCoffeeSpecChartData } from "@/components/coffee-spec-charts"

describe("coffee spec chart metadata", () => {
  test("reads complete provider cupping and flavor profiles", () => {
    const result = readCoffeeSpecChartData({
      score: 87,
      cuppingProfile: {
        fragrance: 8.3,
        wetAroma: 8.5,
        brightness: 8.5,
        flavor: 8.4,
        body: 9,
        finish: 8.2,
        sweetness: 8.3,
        cleanCup: 8.3,
        complexity: 8.5,
        uniformity: 8.5,
        correction: 2.5,
      },
      flavorProfile: {
        body: 4,
        floral: 0,
        honey: 3,
        sugars: 3,
        caramel: 4,
        fruits: 2,
        citrus: 2,
        berry: 0,
        cocoa: 5,
        nuts: 3,
        rustic: 2,
        spice: 0,
      },
    })

    expect(result?.cupping).toMatchObject({
      correction: 2.5,
      score: 87,
      values: { fragrance: 8.3, body: 9, uniformity: 8.5 },
    })
    expect(result?.flavor).toMatchObject({ cocoa: 5, floral: 0, body: 4 })
  })

  test("does not render incomplete chart data", () => {
    expect(readCoffeeSpecChartData({ score: 87 })).toBeNull()
    expect(
      readCoffeeSpecChartData({ cuppingProfile: { fragrance: 8.3 } })
    ).toBeNull()
  })
})
