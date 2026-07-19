import * as echarts from "echarts/core"
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components"
import { LineChart } from "echarts/charts"
import { CanvasRenderer } from "echarts/renderers"
import { Checkbox } from "@tan-studio/ui/components/checkbox"
import { useEffect, useMemo, useRef, useState } from "react"

import type { ChartChannel, ChartPoint, RoastDetail } from "@/types"

echarts.use([
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  LineChart,
  CanvasRenderer,
])

type RoastChartProps = {
  points: ChartPoint[]
  channels?: ChartChannel[]
  events?: RoastDetail["events"]
  durationMs?: number
  cooldownEndMs?: number
  live?: boolean
  height?: number
}

type SeriesKey =
  | "spot_temp"
  | "temp"
  | "mean_temp"
  | "profile"
  | "profile_ROR"
  | "actual_ROR"
  | "desired_ROR"
  | "power_kW"
  | "actual_fan_RPM"

const seriesDefinitions: ReadonlyArray<{
  key: SeriesKey
  label: string
  axis: 0 | 1 | 2 | 3
  colorIndex: number
  dashed?: boolean
  value(point: ChartPoint): number | null | undefined
}> = [
  {
    key: "spot_temp",
    label: "Spot temp",
    axis: 0,
    colorIndex: 4,
    value: (point) => point.spotTemperatureC,
  },
  {
    key: "temp",
    label: "Temp",
    axis: 0,
    colorIndex: 0,
    value: (point) => point.temperatureC,
  },
  {
    key: "mean_temp",
    label: "Mean temp",
    axis: 0,
    colorIndex: 1,
    value: (point) => point.meanTemperatureC,
  },
  {
    key: "profile",
    label: "Profile",
    axis: 0,
    colorIndex: 2,
    dashed: true,
    value: (point) => point.profileC,
  },
  {
    key: "profile_ROR",
    label: "Profile RoR",
    axis: 1,
    colorIndex: 2,
    dashed: true,
    value: (point) => point.profileRorCPerMin,
  },
  {
    key: "actual_ROR",
    label: "Actual RoR",
    axis: 1,
    colorIndex: 3,
    value: (point) => point.rorCPerMin,
  },
  {
    key: "desired_ROR",
    label: "Desired RoR",
    axis: 1,
    colorIndex: 4,
    dashed: true,
    value: (point) => point.desiredRorCPerMin,
  },
  {
    key: "power_kW",
    label: "Power kW",
    axis: 2,
    colorIndex: 5,
    value: (point) => point.powerKw,
  },
  {
    key: "actual_fan_RPM",
    label: "Actual fan RPM",
    axis: 3,
    colorIndex: 6,
    value: (point) => point.actualFanRpm,
  },
]
const emptyChannels: ChartChannel[] = []

function cssToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function minutesLabel(elapsedMs: number) {
  const totalSeconds = Math.round(elapsedMs / 1_000)
  const sign = totalSeconds < 0 ? "−" : ""
  const absolute = Math.abs(totalSeconds)
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`
}

function defaultSelection(channels: readonly ChartChannel[]) {
  const available = new Map(channels.map((channel) => [channel.name, channel]))
  return new Set(
    seriesDefinitions
      .filter((series) => available.get(series.key)?.hiddenByDefault !== true)
      .map((series) => series.key)
  )
}

export function RoastChart({
  points,
  channels = emptyChannels,
  events = [],
  durationMs,
  cooldownEndMs,
  live = false,
  height = 390,
}: RoastChartProps) {
  const chartNode = useRef<HTMLDivElement>(null)
  const channelByName = useMemo(
    () => new Map(channels.map((channel) => [channel.name, channel])),
    [channels]
  )
  const [visible, setVisible] = useState<Set<SeriesKey>>(() =>
    defaultSelection(channels)
  )

  useEffect(() => {
    const node = chartNode.current
    if (!node) return

    const chart = echarts.init(node, undefined, { renderer: "canvas" })
    const foreground = cssToken("--foreground", "#3e3027")
    const muted = cssToken("--muted-foreground", "#796d62")
    const border = cssToken("--border", "#ded2c1")
    const card = cssToken("--card", "#fffcf7")
    const colors = [
      cssToken("--chart-1", "#b86f55"),
      cssToken("--chart-2", "#4e8982"),
      cssToken("--chart-3", "#7e9678"),
      cssToken("--chart-4", "#c29555"),
      cssToken("--chart-5", "#967aa1"),
      cssToken("--warning", "#a97836"),
      muted,
    ]
    const xValues = points.flatMap((point) =>
      seriesDefinitions
        .filter((series) => visible.has(series.key))
        .map(
          (series) =>
            point.elapsedMs + (channelByName.get(series.key)?.offsetMs ?? 0)
        )
    )
    const minimumX = Math.min(0, ...xValues)
    const maximumX = Math.max(
      durationMs ?? 0,
      cooldownEndMs ?? 0,
      ...xValues,
      60_000
    )

    chart.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      aria: {
        enabled: true,
        description:
          "Kaffelogic roast telemetry with temperature, profile, rate of rise, power, and fan channels.",
      },
      textStyle: {
        color: foreground,
        fontFamily: "Geist Variable, sans-serif",
      },
      grid: { top: 26, right: 62, bottom: 52, left: 52 },
      tooltip: {
        trigger: "axis",
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? value.toFixed(2) : String(value),
      },
      dataZoom: [
        { type: "inside", filterMode: "none" },
        {
          type: "slider",
          height: 16,
          bottom: 8,
          borderColor: border,
          fillerColor: cssToken("--accent", "#eee1cf"),
          showDetail: false,
        },
      ],
      xAxis: {
        type: "value",
        min: minimumX,
        max: maximumX,
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
          min: 0,
          max: 250,
          name: "°C",
          nameTextStyle: { color: muted },
          axisLabel: { color: muted, formatter: "{value}°" },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: { color: border, type: "dashed", opacity: 0.55 },
          },
        },
        {
          type: "value",
          min: -10,
          max: 40,
          name: "°C/min",
          nameTextStyle: { color: muted },
          axisLabel: { color: muted },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
        { type: "value", min: 0, max: 1.5, show: false },
        { type: "value", min: 0, max: 18_000, show: false },
      ],
      series: seriesDefinitions
        .filter((series) => visible.has(series.key))
        .map((series, index) => {
          const offset = channelByName.get(series.key)?.offsetMs ?? 0
          return {
            name: series.label,
            type: "line" as const,
            yAxisIndex: series.axis,
            showSymbol: false,
            connectNulls: false,
            smooth: series.axis <= 1 ? 0.12 : false,
            data: points.map((point) => [
              point.elapsedMs + offset,
              series.value(point),
            ]),
            lineStyle: {
              color: colors[series.colorIndex],
              width:
                series.key === "temp" || series.key === "mean_temp" ? 2.4 : 1.5,
              type: series.dashed ? "dashed" : "solid",
            },
            itemStyle: { color: colors[series.colorIndex] },
            ...(index === 0
              ? {
                  markLine: {
                    symbol: "none",
                    silent: true,
                    label: { color: muted, fontSize: 10, formatter: "{b}" },
                    lineStyle: { color: border, type: "dashed", width: 1 },
                    data: [
                      ...events.map((event) => ({
                        name: event.label,
                        xAxis: event.elapsedMs,
                      })),
                      ...(durationMs === undefined
                        ? []
                        : [{ name: "Roast end", xAxis: durationMs }]),
                    ],
                  },
                  markArea:
                    durationMs !== undefined &&
                    cooldownEndMs !== undefined &&
                    cooldownEndMs > durationMs
                      ? {
                          silent: true,
                          itemStyle: {
                            color: cssToken("--muted", "#eee8de"),
                            opacity: 0.28,
                          },
                          label: { color: muted, formatter: "Cooldown" },
                          data: [
                            [{ xAxis: durationMs }, { xAxis: cooldownEndMs }],
                          ],
                        }
                      : undefined,
                }
              : {}),
          }
        }),
    })

    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
    }
  }, [channelByName, cooldownEndMs, durationMs, events, points, visible])

  const availableSeries = seriesDefinitions.filter((series) =>
    points.some((point) => series.value(point) != null)
  )

  return (
    <div>
      <div
        className="flex flex-wrap gap-x-4 gap-y-2 border-b px-5 py-3"
        aria-label="Visible roast chart channels"
      >
        {availableSeries.map((series) => (
          <label
            key={series.key}
            className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs"
          >
            <Checkbox
              checked={visible.has(series.key)}
              onCheckedChange={() =>
                setVisible((current) => {
                  const next = new Set(current)
                  if (next.has(series.key)) next.delete(series.key)
                  else next.add(series.key)
                  return next
                })
              }
            />
            {series.label}
          </label>
        ))}
      </div>
      <div
        ref={chartNode}
        role="img"
        aria-label={`${live ? "Live" : "Historical"} Kaffelogic roast telemetry chart`}
        style={{ height }}
        className="w-full"
      />
    </div>
  )
}
