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
  firstCrack?: { elapsedMs: number; estimated: boolean }
  live?: boolean
  height?: number
  showFanAxis?: boolean
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
    label: "Profile rate of rise",
    axis: 1,
    colorIndex: 2,
    dashed: true,
    value: (point) => point.profileRorCPerMin,
  },
  {
    key: "actual_ROR",
    label: "Actual rate of rise",
    axis: 1,
    colorIndex: 3,
    value: (point) => point.rorCPerMin,
  },
  {
    key: "desired_ROR",
    label: "Target rate of rise",
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

function defaultSelection(
  channels: readonly ChartChannel[],
  points: readonly ChartPoint[]
) {
  const available = new Map(channels.map((channel) => [channel.name, channel]))
  if (channels.length === 0) {
    const selected = new Set<SeriesKey>(["temp"])
    if (points.some((point) => point.profileC != null)) selected.add("profile")
    if (points.some((point) => point.rorCPerMin != null))
      selected.add("actual_ROR")
    if (points.some((point) => point.desiredRorCPerMin != null))
      selected.add("desired_ROR")
    if (
      !points.some(
        (point) => point.rorCPerMin != null || point.desiredRorCPerMin != null
      ) &&
      points.some((point) => point.actualFanRpm != null)
    )
      selected.add("actual_fan_RPM")
    return selected
  }
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
  firstCrack,
  live = false,
  height = 390,
  showFanAxis = false,
}: RoastChartProps) {
  const chartNode = useRef<HTMLDivElement>(null)
  const channelByName = useMemo(
    () => new Map(channels.map((channel) => [channel.name, channel])),
    [channels]
  )
  const [visible, setVisible] = useState<Set<SeriesKey>>(() =>
    defaultSelection(channels, points)
  )
  const [includeCooldown, setIncludeCooldown] = useState(false)
  const hasCooldownSamples =
    durationMs != null && points.some((point) => point.elapsedMs > durationMs)
  const displayedPoints = useMemo(
    () =>
      !live && durationMs != null && !includeCooldown
        ? points.filter((point) => point.elapsedMs <= durationMs)
        : points,
    [durationMs, includeCooldown, live, points]
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
    const hasVisibleRate = seriesDefinitions
      .filter((series) => series.axis === 1 && visible.has(series.key))
      .some((series) =>
        displayedPoints.some((point) => series.value(point) != null)
      )
    const hasVisibleFan =
      showFanAxis &&
      visible.has("actual_fan_RPM") &&
      displayedPoints.some((point) => point.actualFanRpm != null)
    const hasVisiblePower =
      visible.has("power_kW") &&
      displayedPoints.some((point) => point.powerKw != null)
    const hasLowerPanel = hasVisibleRate || hasVisibleFan || hasVisiblePower
    const xValues = displayedPoints.flatMap((point) =>
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
      // Keep hover rendering on the base canvas. ECharts' separate hover layer
      // can clear sibling series in macOS WebKit once a chart is sufficiently
      // dense, even though the underlying data remains present.
      hoverLayerThreshold: Number.MAX_SAFE_INTEGER,
      aria: {
        enabled: true,
        description:
          "Kaffelogic roast telemetry with temperature, profile, rate of rise, power, and fan channels.",
      },
      textStyle: {
        color: foreground,
        fontFamily: "Geist Variable, sans-serif",
      },
      grid: hasLowerPanel
        ? [
            {
              top: 24,
              right: hasVisibleFan ? 72 : 56,
              height: "48%",
              left: 58,
            },
            {
              top: "60%",
              right: hasVisibleFan ? 72 : 56,
              bottom: 62,
              left: 58,
            },
          ]
        : { top: 24, right: 56, bottom: 52, left: 58 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: foreground },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? value.toFixed(2) : String(value),
      },
      dataZoom: [
        {
          type: "inside",
          filterMode: "none",
          xAxisIndex: hasLowerPanel ? [0, 1] : [0],
        },
        {
          type: "slider",
          xAxisIndex: hasLowerPanel ? [0, 1] : [0],
          height: 16,
          bottom: 8,
          borderColor: border,
          fillerColor: cssToken("--accent", "#eee1cf"),
          showDetail: false,
        },
      ],
      xAxis: [
        {
          type: "value",
          gridIndex: 0,
          min: minimumX,
          max: maximumX,
          axisLabel: hasLowerPanel
            ? { show: false }
            : {
                color: muted,
                formatter: (value: number) => minutesLabel(value),
                hideOverlap: true,
              },
          axisLine: { lineStyle: { color: border } },
          axisTick: { show: false },
          splitLine: {
            lineStyle: { color: border, type: "dashed", opacity: 0.48 },
          },
          name: hasLowerPanel ? undefined : "Roast time",
          nameLocation: "middle",
          nameGap: 32,
        },
        ...(hasLowerPanel
          ? [
              {
                type: "value" as const,
                gridIndex: 1,
                min: minimumX,
                max: maximumX,
                axisLabel: {
                  color: muted,
                  formatter: (value: number) => minutesLabel(value),
                  hideOverlap: true,
                },
                axisLine: { lineStyle: { color: border } },
                axisTick: { show: false },
                splitLine: {
                  lineStyle: {
                    color: border,
                    type: "dashed" as const,
                    opacity: 0.48,
                  },
                },
                name: "Roast time",
                nameLocation: "middle" as const,
                nameGap: 34,
              },
            ]
          : []),
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
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
          gridIndex: hasLowerPanel ? 1 : 0,
          min: -10,
          max: 40,
          name: "°C/min",
          show: hasVisibleRate,
          nameTextStyle: { color: muted },
          axisLabel: { color: muted },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: { color: border, type: "dashed", opacity: 0.34 },
          },
        },
        {
          type: "value",
          gridIndex: hasLowerPanel ? 1 : 0,
          min: 0,
          max: 1.5,
          show: false,
        },
        {
          type: "value",
          gridIndex: hasLowerPanel ? 1 : 0,
          min: 0,
          max: 18_000,
          name: "RPM",
          show: hasVisibleFan,
          position: "right",
          nameTextStyle: { color: muted },
          axisLabel: { color: muted },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      series: seriesDefinitions
        .filter((series) => visible.has(series.key))
        .map((series, index) => {
          const offset = channelByName.get(series.key)?.offsetMs ?? 0
          const lowerSeries = series.axis > 0
          return {
            name: series.label,
            type: "line" as const,
            yAxisIndex: series.axis,
            xAxisIndex: lowerSeries && hasLowerPanel ? 1 : 0,
            showSymbol: false,
            connectNulls: false,
            smooth: series.axis <= 1 ? 0.12 : false,
            data: displayedPoints.map((point) => [
              point.elapsedMs + offset,
              series.value(point),
            ]),
            lineStyle: {
              color: colors[series.colorIndex],
              width:
                series.key === "temp" || series.key === "actual_ROR"
                  ? 2.5
                  : 1.7,
              type: series.dashed ? "dashed" : "solid",
            },
            itemStyle: { color: colors[series.colorIndex] },
            // The axis tooltip and crosshair remain active; only the visual
            // emphasis transition is disabled so inspection cannot hide lines.
            emphasis: { disabled: true },
            blur: {
              lineStyle: { opacity: 1 },
              itemStyle: { opacity: 1 },
            },
            ...(index === 0
              ? {
                  markLine: {
                    symbol: "none",
                    silent: true,
                    label: { color: muted, fontSize: 10, formatter: "{b}" },
                    lineStyle: { color: border, type: "dashed", width: 1 },
                    data: [
                      ...events
                        .filter((event) => event.label !== "roast end")
                        .map((event) => ({
                          name: event.label,
                          xAxis: event.elapsedMs,
                        })),
                      ...(durationMs === undefined ||
                      events.some((event) => event.label === "roast end")
                        ? []
                        : [{ name: "Roast end", xAxis: durationMs }]),
                    ],
                  },
                  markArea: {
                    silent: true,
                    label: { color: muted, fontSize: 10 },
                    data: [
                      ...(firstCrack && durationMs !== undefined
                        ? [
                            [
                              {
                                name: "Pre-crack",
                                xAxis: 0,
                                itemStyle: {
                                  color: cssToken("--accent", "#eee1cf"),
                                  opacity: 0.1,
                                },
                              },
                              { xAxis: firstCrack.elapsedMs },
                            ],
                            [
                              {
                                name: firstCrack.estimated
                                  ? "Development · estimated"
                                  : "Development",
                                xAxis: firstCrack.elapsedMs,
                                itemStyle: {
                                  color: cssToken("--chart-1", "#b86f55"),
                                  opacity: firstCrack.estimated ? 0.08 : 0.12,
                                },
                              },
                              { xAxis: durationMs },
                            ],
                          ]
                        : []),
                      ...(durationMs !== undefined &&
                      cooldownEndMs !== undefined &&
                      cooldownEndMs > durationMs
                        ? [
                            [
                              {
                                name: "Cooldown",
                                xAxis: durationMs,
                                itemStyle: {
                                  color: cssToken("--muted", "#eee8de"),
                                  opacity: 0.28,
                                },
                              },
                              { xAxis: cooldownEndMs },
                            ],
                          ]
                        : []),
                    ],
                  },
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
  }, [
    channelByName,
    cooldownEndMs,
    durationMs,
    events,
    firstCrack,
    displayedPoints,
    showFanAxis,
    visible,
  ])

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
        {hasCooldownSamples ? (
          <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={includeCooldown}
              onCheckedChange={(checked) =>
                setIncludeCooldown(checked === true)
              }
            />
            Include cooldown
          </label>
        ) : null}
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
