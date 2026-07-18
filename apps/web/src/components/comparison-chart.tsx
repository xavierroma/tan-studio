import * as echarts from "echarts/core"
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components"
import { LineChart } from "echarts/charts"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useRef } from "react"

import type { RoastDetail } from "@/types"

echarts.use([
  GridComponent,
  LegendComponent,
  TooltipComponent,
  LineChart,
  CanvasRenderer,
])

export function ComparisonChart({
  roasts,
  alignment,
}: {
  roasts: RoastDetail[]
  alignment: "time" | "first-crack" | "normalized"
}) {
  const nodeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return
    const chart = echarts.init(node)
    const styles = getComputedStyle(document.documentElement)
    const colors = ["--chart-1", "--chart-2", "--chart-3", "--chart-4"].map(
      (token) => styles.getPropertyValue(token).trim()
    )
    const foreground = styles.getPropertyValue("--foreground").trim()
    const muted = styles.getPropertyValue("--muted-foreground").trim()
    const border = styles.getPropertyValue("--border").trim()
    const card = styles.getPropertyValue("--card").trim()

    const firstCrack = (roast: RoastDetail) =>
      roast.events.find((event) => event.label === "First crack")?.elapsedMs ??
      0
    const xValue = (roast: RoastDetail, elapsedMs: number) => {
      if (alignment === "first-crack")
        return (elapsedMs - firstCrack(roast)) / 1_000
      if (alignment === "normalized")
        return (elapsedMs / (roast.durationSeconds * 1_000)) * 100
      return elapsedMs / 1_000
    }

    chart.setOption({
      animation: false,
      color: colors,
      textStyle: {
        fontFamily: "Geist Variable, sans-serif",
        color: foreground,
      },
      grid: { top: 55, right: 30, bottom: 42, left: 52 },
      legend: { top: 14, textStyle: { color: muted } },
      tooltip: {
        trigger: "axis",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
      },
      xAxis: {
        type: "value",
        name:
          alignment === "normalized"
            ? "Roast progress · %"
            : alignment === "first-crack"
              ? "Seconds from first crack"
              : "Elapsed · seconds",
        nameLocation: "middle",
        nameGap: 28,
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: border } },
        splitLine: {
          lineStyle: { color: border, type: "dashed", opacity: 0.55 },
        },
      },
      yAxis: {
        type: "value",
        min: 20,
        max: 220,
        axisLabel: { color: muted, formatter: "{value}°" },
        axisLine: { show: false },
        splitLine: {
          lineStyle: { color: border, type: "dashed", opacity: 0.55 },
        },
      },
      series: roasts.map((roast, index) => ({
        name: `${roast.coffeeName} · r${roast.profileRevision}`,
        type: "line",
        showSymbol: false,
        smooth: 0.18,
        data: roast.chart.map((point) => [
          xValue(roast, point.elapsedMs),
          point.temperatureC,
        ]),
        lineStyle: {
          width: index === 0 ? 3 : 2,
          type: index === 2 ? "dashed" : "solid",
        },
      })),
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(node)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [alignment, roasts])

  return (
    <div
      ref={nodeRef}
      role="img"
      aria-label="Overlaid temperature curves for selected roasts"
      className="h-[28rem] w-full"
    />
  )
}
