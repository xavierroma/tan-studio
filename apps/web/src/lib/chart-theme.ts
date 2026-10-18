/**
 * Ink-and-stock chrome for the ECharts slider dataZoom, so default ECharts
 * blues never add a third hue. Styling only; zoom behaviour is unchanged.
 */
export function sliderZoomTheme(tokens: {
  foreground: string
  muted: string
  border: string
  card: string
}) {
  const { foreground, muted, border, card } = tokens
  return {
    backgroundColor: card,
    borderColor: border,
    fillerColor: "rgba(0, 0, 0, 0.08)",
    handleStyle: { color: card, borderColor: foreground, borderWidth: 1 },
    moveHandleStyle: { color: muted, opacity: 0.5 },
    dataBackground: {
      lineStyle: { color: muted, opacity: 0.5 },
      areaStyle: { color: muted, opacity: 0.08 },
    },
    selectedDataBackground: {
      lineStyle: { color: foreground, opacity: 0.6 },
      areaStyle: { color: foreground, opacity: 0.08 },
    },
    brushStyle: { color: "rgba(0, 0, 0, 0.08)" },
    textStyle: { color: muted },
    emphasis: {
      handleStyle: { color: card, borderColor: foreground, borderWidth: 1.5 },
      moveHandleStyle: { color: foreground, opacity: 0.7 },
    },
  }
}
