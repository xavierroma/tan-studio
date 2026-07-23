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
    const foreground = cssToken("--foreground", "#3e3027")
    const muted = cssToken("--muted-foreground", "#796d62")
    const border = cssToken("--border", "#ded2c1")
    const card = cssToken("--card", "#fffcf7")
    const palette = [
      cssToken("--chart-1", "#b86f55"),
      cssToken("--chart-2", "#4e8982"),
      cssToken("--chart-3", "#7e9678"),
      cssToken("--chart-4", "#c29555"),
      cssToken("--chart-5", "#967aa1"),
    ]
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
      color: palette,
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
        textStyle: { color: muted },
      },
      grid: { top: 26, right: 66, bottom: 88, left: 58 },
      dataZoom: [
        { type: "inside", filterMode: "none" },
        {
          type: "slider",
          height: 16,
          bottom: 6,
          borderColor: border,
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
        const color = palette[index % palette.length]
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
            lineStyle: { color, width: index === 0 ? 3 : 2 },
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
            lineStyle: { color, width: 1.5, type: "dashed", opacity: 0.8 },
            itemStyle: { color },
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
