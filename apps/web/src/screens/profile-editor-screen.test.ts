import { describe, expect, it } from "vitest"

import { sampleNativeCurve } from "@/screens/profile-editor-screen"

describe("native Kaffelogic profile curves", () => {
  it("samples Studio's cubic Bezier control triples without changing their endpoints", () => {
    const points = sampleNativeCurve("0,20,0,0,20,50,60,110,40,90,80,130", 8)

    expect(points).toHaveLength(9)
    expect(points[0]).toEqual({ elapsedMs: 0, value: 20 })
    expect(points.at(-1)).toEqual({ elapsedMs: 60_000, value: 110 })
    expect(points.every((point) => Number.isFinite(point.value))).toBe(true)
  })

  it("fails closed for incomplete native control groups", () => {
    expect(sampleNativeCurve("0,20,0,0,20,50")).toEqual([])
  })

  it("samples the normalized control arrays returned by the Rust API", () => {
    const points = sampleNativeCurve(
      [
        { timeSeconds: 0, value: 20 },
        { timeSeconds: 0, value: 0 },
        { timeSeconds: 20, value: 50 },
        { timeSeconds: 60, value: 110 },
        { timeSeconds: 40, value: 90 },
        { timeSeconds: 80, value: 130 },
      ],
      4
    )

    expect(points).toHaveLength(5)
    expect(points.at(-1)).toEqual({ elapsedMs: 60_000, value: 110 })
  })
})
