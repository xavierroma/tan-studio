import * as echarts from "echarts/core"
import {
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components"
import { LineChart } from "echarts/charts"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useRef } from "react"

import type { ChartPoint, RoastDetail } from "@/types"

echarts.use([
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  LineChart,
  CanvasRenderer,
])

type RoastChartProps = {
  points: ChartPoint[]
  events?: RoastDetail["events"]
  live?: boolean
  height?: number
}

function cssToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function minutesLabel(elapsedMs: number) {
  const totalSeconds = Math.round(elapsedMs / 1_000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

export function RoastChart({
  points,
  events = [],
  live = false,
  height = 390,
}: RoastChartProps) {
  const chartNode = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = chartNode.current
    if (!node) return

    const chart = echarts.init(node, undefined, { renderer: "canvas" })
    const foreground = cssToken("--foreground", "#3e3027")
    const muted = cssToken("--muted-foreground", "#796d62")
    const border = cssToken("--border", "#ded2c1")
    const card = cssToken("--card", "#fffcf7")
    const clay = cssToken("--chart-1", "#b86f55")
    const lagoon = cssToken("--chart-2", "#4e8982")
    const sage = cssToken("--chart-3", "#7e9678")

    chart.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      textStyle: {
        color: foreground,
        fontFamily: "Geist Variable, sans-serif",
      },
      grid: { top: 28, right: 48, bottom: 42, left: 48, containLabel: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? value.toFixed(1) : String(value),
      },
      xAxis: {
        type: "value",
        min: 0,
        max: points.at(-1)?.elapsedMs ?? 600_000,
        axisLabel: {
          color: muted,
          formatter: (value: number) => minutesLabel(value),
        },
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
        splitLine: {
          lineStyle: { color: border, type: "dashed", opacity: 0.55 },
        },
      },
      yAxis: [
        {
          type: "value",
          min: 20,
          max: 220,
          axisLabel: { color: muted, formatter: "{value}°" },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: { color: border, type: "dashed", opacity: 0.55 },
          },
        },
        {
          type: "value",
          min: 0,
          max: 30,
          axisLabel: { color: muted, formatter: "{value}°/m" },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: live ? "Bean temperature" : "Measured temperature",
          type: "line",
          showSymbol: false,
          smooth: 0.22,
          data: points.map((point) => [point.elapsedMs, point.temperatureC]),
          lineStyle: { color: clay, width: 3 },
          itemStyle: { color: clay },
          markLine: {
            symbol: "none",
            silent: true,
            label: { color: muted, fontSize: 10, formatter: "{b}" },
            lineStyle: { color: border, type: "dashed", width: 1 },
            data: events.map((event) => ({
              name: event.label,
              xAxis: event.elapsedMs,
            })),
          },
        },
        {
          name: "Profile target",
          type: "line",
          showSymbol: false,
          smooth: 0.2,
          data: points.map((point) => [point.elapsedMs, point.profileC]),
          lineStyle: { color: lagoon, width: 2, type: "dashed" },
          itemStyle: { color: lagoon },
        },
        {
          name: "Rate of rise",
          type: "line",
          yAxisIndex: 1,
          showSymbol: false,
          smooth: 0.28,
          data: points.map((point) => [point.elapsedMs, point.rorCPerMin]),
          lineStyle: { color: sage, width: 1.75 },
          itemStyle: { color: sage },
        },
      ],
    })

    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
    }
  }, [events, live, points])

  return (
    <div
      ref={chartNode}
      role="img"
      aria-label="Roast temperature, profile target, and rate of rise over elapsed time"
      style={{ height }}
      className="w-full"
    />
  )
}
