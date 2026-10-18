import { Card, CardContent } from "@tan-studio/ui/components/card"
import { BarChart, RadarChart } from "echarts/charts"
import {
  AriaComponent,
  PolarComponent,
  RadarComponent,
  TooltipComponent,
} from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useRef } from "react"

echarts.use([
  AriaComponent,
  BarChart,
  CanvasRenderer,
  PolarComponent,
  RadarChart,
  RadarComponent,
  TooltipComponent,
])

const cuppingDimensions = [
  ["fragrance", "Fragrance"],
  ["wetAroma", "Wet aroma"],
  ["brightness", "Brightness"],
  ["flavor", "Flavor"],
  ["body", "Body"],
  ["finish", "Finish"],
  ["sweetness", "Sweetness"],
  ["cleanCup", "Clean cup"],
  ["complexity", "Complexity"],
  ["uniformity", "Uniformity"],
] as const

// ECharts lays radar indicators counter-clockwise. Reverse the provider's
// clockwise order after Fragrance so Wet aroma remains at upper right.
const radarDimensions = [
  cuppingDimensions[0],
  cuppingDimensions[9],
  cuppingDimensions[8],
  cuppingDimensions[7],
  cuppingDimensions[6],
  cuppingDimensions[5],
  cuppingDimensions[4],
  cuppingDimensions[3],
  cuppingDimensions[2],
  cuppingDimensions[1],
] as const

const flavorDimensions = [
  ["body", "Body"],
  ["floral", "Floral"],
  ["honey", "Honey"],
  ["sugars", "Sugars"],
  ["caramel", "Caramel"],
  ["fruits", "Fruits"],
  ["citrus", "Citrus"],
  ["berry", "Berry"],
  ["cocoa", "Cocoa"],
  ["nuts", "Nuts"],
  ["rustic", "Rustic"],
  ["spice", "Spice"],
] as const

type CuppingValues = Record<(typeof cuppingDimensions)[number][0], number>
type FlavorValues = Record<(typeof flavorDimensions)[number][0], number>

export type CoffeeSpecChartData = {
  cupping: {
    values: CuppingValues
    correction: number
    score: number
  } | null
  flavor: FlavorValues | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function dimensionRecord<
  T extends ReadonlyArray<readonly [string, string, ...unknown[]]>,
>(source: Record<string, unknown> | null, dimensions: T, maximum: number) {
  if (!source) return null
  const result: Record<string, number> = {}
  for (const [key] of dimensions) {
    const value = finiteNumber(source[key])
    if (value === null || value < 0 || value > maximum) return null
    result[key] = value
  }
  return result as Record<T[number][0], number>
}

export function readCoffeeSpecChartData(
  metadata: unknown
): CoffeeSpecChartData | null {
  const root = record(metadata)
  if (!root) return null
  const cuppingSource = record(root.cuppingProfile)
  const cuppingValues = dimensionRecord(
    cuppingSource,
    cuppingDimensions,
    10
  ) as CuppingValues | null
  const flavor = dimensionRecord(
    record(root.flavorProfile),
    flavorDimensions,
    5
  ) as FlavorValues | null
  const metadataScore = finiteNumber(root.score)
  const correction = finiteNumber(cuppingSource?.correction) ?? 0
  const score =
    metadataScore ??
    (cuppingValues
      ? Object.values(cuppingValues).reduce((sum, value) => sum + value, 0) +
        correction
      : null)
  const cupping =
    cuppingValues && score !== null
      ? { values: cuppingValues, correction, score }
      : null
  return cupping || flavor ? { cupping, flavor } : null
}

function cssToken(name: string, fallback: string) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  )
}

function CuppingRadar({
  coffeeName,
  data,
}: {
  coffeeName: string
  data: NonNullable<CoffeeSpecChartData["cupping"]>
}) {
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!node.current) return
    const chart = echarts.init(node.current, undefined, { renderer: "canvas" })
    const foreground = cssToken("--foreground", "#000000")
    const muted = cssToken("--muted-foreground", "#57544c")
    const border = cssToken("--border", "#00000029")
    const card = cssToken("--card", "#fff9ee")
    const red = cssToken("--tan-red", "#b6151b")
    const values = radarDimensions.map(([key]) => data.values[key])

    chart.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      aria: {
        enabled: true,
        description: `${coffeeName} provider cupping scores: ${cuppingDimensions
          .map(([key, label]) => `${label} ${data.values[key]}`)
          .join(", ")}. Final score ${data.score}.`,
      },
      textStyle: {
        color: foreground,
        fontFamily: "Geist Variable, sans-serif",
      },
      tooltip: {
        trigger: "item",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
        formatter: () =>
          cuppingDimensions
            .map(([key, label]) => `${label}: ${data.values[key]}`)
            .join("<br/>")
            .concat(`<br/><strong>Score: ${data.score.toFixed(1)}</strong>`),
      },
      radar: {
        center: ["50%", "50%"],
        radius: "67%",
        startAngle: 90,
        splitNumber: 8,
        shape: "circle",
        indicator: radarDimensions.map(([, label]) => ({
          name: label.toUpperCase(),
          min: 6,
          max: 10,
        })),
        axisName: { color: muted, fontSize: 10 },
        axisLine: { lineStyle: { color: border, opacity: 0.8 } },
        splitLine: { lineStyle: { color: border, opacity: 0.85 } },
        splitArea: { areaStyle: { color: ["transparent"] } },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 4,
          data: [{ value: values }],
          lineStyle: { color: red, width: 2 },
          itemStyle: { color: red },
          areaStyle: { color: red, opacity: 0.06 },
          label: {
            show: true,
            color: foreground,
            fontSize: 11,
            formatter: ({ value }: { value: number | string }) => String(value),
          },
        },
      ],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(node.current)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [coffeeName, data])

  return (
    <div>
      <div
        ref={node}
        className="h-[22rem] w-full"
        role="img"
        aria-label={`${coffeeName} provider cupping radar chart`}
      />
      <p className="text-muted-foreground text-center text-sm">
        Cupper&apos;s correction {data.correction.toFixed(1)}
      </p>
      <p className="text-center font-[family-name:var(--tan-font-brand)] text-2xl">
        Score {data.score.toFixed(1)}
      </p>
    </div>
  )
}

function FlavorPolar({
  coffeeName,
  values,
}: {
  coffeeName: string
  values: FlavorValues
}) {
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!node.current) return
    const chart = echarts.init(node.current, undefined, { renderer: "canvas" })
    const foreground = cssToken("--foreground", "#000000")
    const muted = cssToken("--muted-foreground", "#57544c")
    const border = cssToken("--border", "#00000029")
    const card = cssToken("--card", "#fff9ee")

    chart.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      aria: {
        enabled: true,
        description: `${coffeeName} provider flavor intensities from zero to five: ${flavorDimensions
          .map(([key, label]) => `${label} ${values[key]}`)
          .join(", ")}.`,
      },
      textStyle: {
        color: foreground,
        fontFamily: "Geist Variable, sans-serif",
      },
      tooltip: {
        trigger: "item",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
        formatter: ({ name, value }: { name: string; value: number }) =>
          `${name}: ${value} / 5`,
      },
      polar: { center: ["50%", "50%"], radius: "70%" },
      angleAxis: {
        type: "category",
        startAngle: 120,
        clockwise: true,
        data: flavorDimensions.map(([, label]) => label.toUpperCase()),
        axisLabel: { color: muted, fontSize: 10, margin: 12 },
        axisLine: { lineStyle: { color: border } },
        splitLine: { show: true, lineStyle: { color: border, opacity: 0.75 } },
      },
      radiusAxis: {
        min: 0,
        max: 5,
        interval: 0.5,
        axisLabel: {
          color: muted,
          formatter: (value: number) =>
            Number.isInteger(value) ? String(value) : "",
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: border, opacity: 0.85 } },
      },
      series: [
        {
          type: "bar",
          coordinateSystem: "polar",
          barWidth: "100%",
          data: flavorDimensions.map(([key, label]) => ({
            name: label,
            value: values[key],
          })),
          // One ink; light-stock gaps keep adjacent categories readable.
          itemStyle: {
            color: foreground,
            opacity: 0.78,
            borderColor: card,
            borderWidth: 1,
          },
        },
      ],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(node.current)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [coffeeName, values])

  return (
    <div>
      <div
        ref={node}
        className="h-[22rem] w-full"
        role="img"
        aria-label={`${coffeeName} provider flavor intensity polar chart`}
      />
    </div>
  )
}

export function CoffeeSpecCharts({
  coffeeName,
  metadata,
}: {
  coffeeName: string
  metadata: unknown
}) {
  const data = readCoffeeSpecChartData(metadata)
  if (!data) return null

  return (
    <Card className="mt-8" aria-labelledby="provider-cupping-title">
      <CardContent className="p-0">
        <h2 id="provider-cupping-title" className="py-3">
          Provider cupping profile
        </h2>
        <div className="mt-4 grid gap-8 xl:grid-cols-2">
          {data.cupping ? (
            <CuppingRadar coffeeName={coffeeName} data={data.cupping} />
          ) : null}
          {data.flavor ? (
            <FlavorPolar coffeeName={coffeeName} values={data.flavor} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
