import { LineChart } from "echarts/charts"
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useRef } from "react"

import { sliderZoomTheme } from "@/lib/chart-theme"
import type { ChartPoint } from "@/types"

echarts.use([
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  LineChart,
  CanvasRenderer,
])

export type ProfileChartCurve = {
  id: number
  name: string
  points: ChartPoint[]
}

function cssToken(name: string, fallback: string) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  )
}

function timeLabel(value: number) {
  const seconds = Math.round(value / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

// ECharts takes the literal "solid" or a mutable numeric dash array.
const lineType = (dash: "solid" | readonly number[]): "solid" | number[] =>
  typeof dash === "string" ? dash : [...dash]

export function ProfileComparisonChart({
  curves,
  height = 460,
}: {
  curves: ProfileChartCurve[]
  height?: number
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
    // Two inks only. The selected profile plus up to three comparisons each get
    // their own temperature dash and fan dash; every stroke stays at or above
    // 0.85 opacity so it keeps well over 3:1 contrast on light stock. The
    // legend draws each series with its own line style.
    const curveStyles = [
      { color: red, temp: "solid", fan: [1, 3] },
      { color: foreground, temp: "solid", fan: [1, 3] },
      { color: foreground, temp: [10, 5], fan: [6, 3, 1, 3] },
      { color: red, temp: [10, 5], fan: [6, 3, 1, 3] },
    ] as const
    const maxX = Math.max(
      60_000,
      ...curves.flatMap((curve) => curve.points.map((point) => point.elapsedMs))
    )
    chart.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      aria: {
        enabled: true,
        description:
          "Overlaid Kaffelogic profile temperature and fan curves for comparison.",
      },
      textStyle: {
        color: foreground,
        fontFamily: "Geist Variable, sans-serif",
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
      },
      legend: {
        type: "scroll",
        bottom: 30,
        textStyle: { color: foreground },
        itemWidth: 28,
        pageIconColor: foreground,
        pageIconInactiveColor: border,
        pageTextStyle: { color: muted },
      },
      grid: { top: 26, right: 66, bottom: 88, left: 58 },
      dataZoom: [
        { type: "inside", filterMode: "none" },
        {
          type: "slider",
          height: 16,
          bottom: 6,
          ...sliderZoomTheme({ foreground, muted, border, card }),
          showDetail: false,
        },
      ],
      xAxis: {
        type: "value",
        min: 0,
        max: maxX,
        name: "Roast time",
        nameLocation: "middle",
        nameGap: 30,
        axisLabel: { color: muted, formatter: timeLabel },
        axisLine: { lineStyle: { color: border } },
        splitLine: {
          lineStyle: { color: border, type: "dashed", opacity: 0.5 },
        },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          max: 250,
          name: "°C",
          axisLabel: { color: muted, formatter: "{value}°" },
          splitLine: {
            lineStyle: { color: border, type: "dashed", opacity: 0.5 },
          },
        },
        {
          type: "value",
          min: 0,
          max: 18_000,
          name: "Fan RPM",
          position: "right",
          axisLabel: { color: muted },
          splitLine: { show: false },
        },
      ],
      series: curves.flatMap((curve, index) => {
        const style =
          curveStyles[Math.min(index, curveStyles.length - 1)] ?? curveStyles[0]
        const color = style.color
        return [
          {
            name: `#${curve.id} ${curve.name} · temperature`,
            type: "line",
            yAxisIndex: 0,
            showSymbol: false,
            smooth: 0.12,
            data: curve.points.map((point) => [
              point.elapsedMs,
              point.temperatureC,
            ]),
            lineStyle: {
              color,
              width: index === 0 ? 3 : 2,
              type: lineType(style.temp),
            },
            itemStyle: { color },
            emphasis: { disabled: true },
          },
          {
            name: `#${curve.id} ${curve.name} · fan`,
            type: "line",
            yAxisIndex: 1,
            showSymbol: false,
            connectNulls: false,
            data: curve.points.map((point) => [
              point.elapsedMs,
              point.actualFanRpm,
            ]),
            lineStyle: {
              color,
              width: 1.6,
              type: lineType(style.fan),
              opacity: 0.85,
            },
            itemStyle: { color, opacity: 0.85 },
            emphasis: { disabled: true },
          },
        ]
      }),
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(node.current)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [curves])

  return (
    <div
      ref={node}
      style={{ height }}
      role="img"
      aria-label="Profile comparison chart"
    />
  )
}
