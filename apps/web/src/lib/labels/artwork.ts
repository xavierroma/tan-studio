import { TanPrintFonts } from "./fonts"
import { TanLabelLogo } from "./logo"
export type LabelCopy = {
  roastId: number
  coffee: string
  country: string
  region: string
  altitude: string
  variety: string
  process: string
  profile: string
  level: string
  tasting: string
  grams: string
  date: string
}
export type LabelArtwork = {
  svg: string
  warnings: string[]
  fields: { field: string; text: string; size: number }[]
  small: boolean
  shown: string[]
}

const labelEscape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c] ?? c
  )
/** Print inks for the black/red-on-white B21 Pro stock (brand guide v1.1). */
export const LABEL_INK = "#000"
export const LABEL_RED = "#B6151B"
const TYPE = "typewriter"

function labelMeasure(text: unknown, font: string, size: number, tracking = 0) {
  const f = TanPrintFonts[font]!
  return (
    [...String(text)].reduce(
      (n, c) => n + ((f.glyphs[c]?.a || 0) * size) / f.units,
      0
    ) +
    Math.max(0, [...String(text)].length - 1) * tracking
  )
}
const recorded = (value: string) => value.trim() !== "" && value !== "—"

/**
 * Tan field-note label: the original plant, Courier Prime outlines, black ink
 * with a single Tan Red accent, left aligned on unprinted white stock.
 * `direction` is accepted for older callers; there is one approved layout.
 */
export function buildLabel(
  d: LabelCopy,
  _direction = "field",
  width = 50,
  height = 80,
  side = "front",
  paper = "dual-white"
): LabelArtwork {
  if (width < 48 || height < 30 || width > 200 || height > 200)
    throw Error("Use at least 48 × 30 mm for this fixed-size layout.")
  const warnings: string[] = [],
    parts: string[] = [],
    fields: LabelArtwork["fields"] = [],
    shown: string[] = []
  const small = height < 80,
    // Single-ink stock prints the red accent and cherries in black.
    accent = paper === "white" ? LABEL_INK : LABEL_RED
  const add = (
    field: string,
    text: unknown,
    x: number,
    y: number,
    size = 2.8,
    color = LABEL_INK,
    align = "start",
    tracking = 0
  ) => {
    const value = String(text || "Not recorded")
    const f = TanPrintFonts[TYPE]!
    for (const c of value)
      if (!f.glyphs[c])
        throw Error(
          `The print font cannot outline “${c}”. Edit label copy before downloading.`
        )
    const measured = labelMeasure(value, TYPE, size, tracking),
      start = align === "end" ? x - measured : x
    let pos = start
    const paths = [...value]
      .map((c) => {
        const g = f.glyphs[c]!,
          p = g.d
            ? `<path d="${g.d}" transform="translate(${pos.toFixed(5)} ${y}) scale(${size / f.units} ${-size / f.units})"/>`
            : ""
        pos += (g.a * size) / f.units + tracking
        return p
      })
      .join("")
    parts.push(
      `<g id="${field}" class="label-field" data-field="${field}" data-value="${labelEscape(value)}" data-font-mm="${size}" aria-label="${labelEscape(value)}" fill="${color}">${paths}</g>`
    )
    fields.push({ field, text: value, size })
    shown.push(field)
    return measured
  }
  const wrap = (value: string, size: number, maxWidth: number) => {
    const rows: string[] = []
    let line = ""
    for (const word of value.split(/\s+/)) {
      const next = line ? line + " " + word : word
      if (labelMeasure(next, TYPE, size) <= maxWidth) line = next
      else {
        if (line) rows.push(line)
        line = word
      }
    }
    if (line) rows.push(line)
    return rows
  }
  /** Wraps to `lines`; overflow is shortened with a warning, never dropped silently. */
  const fit = (
    field: string,
    text: unknown,
    x: number,
    y: number,
    size: number,
    maxWidth: number,
    lines = 1,
    lineHeight = size * 1.3,
    color = LABEL_INK,
    align = "start"
  ) => {
    const value = String(text || "Not recorded")
    const rows = wrap(value, size, maxWidth)
    if (
      rows.length > lines ||
      rows.some((t) => labelMeasure(t, TYPE, size) > maxWidth)
    ) {
      warnings.push(
        `${field}: copy is shortened; full value is in the source inspector.`
      )
      rows.length = Math.min(lines, rows.length)
      let last = rows[rows.length - 1] || value
      while (last && labelMeasure(last + "…", TYPE, size) > maxWidth)
        last = last.slice(0, -1)
      rows[rows.length - 1] = last.trimEnd() + "…"
    }
    rows
      .slice(0, lines)
      .forEach((t, i) =>
        add(
          i ? field + "-" + i : field,
          t,
          x,
          y + i * lineHeight,
          size,
          color,
          align
        )
      )
    return Math.min(lines, rows.length)
  }
  const rule = (y: number, x: number, end: number) =>
    parts.push(
      `<path d="M${x} ${y}H${end}" fill="none" stroke="${LABEL_INK}" stroke-width="0.25"/>`
    )
  /**
   * The original plant as two ink layers. On red/black stock the red layer is
   * tagged data-ink="red" for plane separation; on single-ink stock it is
   * drawn through the ink-black filter so its cherries print black.
   */
  const logo = (x: number, y: number, w: number) => {
    const h = ((w * TanLabelLogo.height) / TanLabelLogo.width).toFixed(4)
    const layer = (href: string, ink: "black" | "red", toBlack: boolean) =>
      `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMinYMin meet" data-ink="${ink}"${toBlack ? ' filter="url(#ink-black)"' : ""}/>`
    const twoInk = accent === LABEL_RED
    parts.push(
      `<g id="tan-logo">${layer(TanLabelLogo.black, "black", false)}${
        twoInk
          ? layer(TanLabelLogo.red, "red", false)
          : layer(TanLabelLogo.red, "black", true)
      }</g>`
    )
  }
  const date = d.date.toUpperCase(),
    origin =
      [d.country, d.region].filter(recorded).join(" · ") ||
      "Origin not recorded",
    total = recorded(d.grams) ? d.grams + " g" : "",
    rows = [
      ["variety", "Variety", d.variety],
      ["process", "Process", d.process],
      ["altitude", "Altitude", d.altitude],
      ["profile", "Profile", d.profile],
      ["level", "Level", d.level],
    ].filter(([, , value]) => recorded(value!)) as [string, string, string][]

  if (!small) {
    // 50 × 80 mm: 3 mm margins, plant top left, roast number as the one red accent.
    const left = 3,
      right = 47,
      measure = right - left
    logo(left, 3, 18)
    add("brand", "Tan", 24, 7.4, 4.4)
    add("roast-caption", "ROAST", 24, 12.2, 2.4, LABEL_INK, "start", 0.15)
    add("roast-number", String(d.roastId), 24, 18, 5.6, accent)
    const large = wrap(d.coffee, 5.2, measure).length <= 2,
      nameSize = large ? 5.2 : 4.2,
      nameLead = large ? 5.6 : 4.6
    const nameLines = fit(
      "coffee",
      d.coffee,
      left,
      26.5,
      nameSize,
      measure,
      2,
      nameLead
    )
    let y = 26.5 + (nameLines - 1) * nameLead + 4.5
    const originLines = fit("origin", origin, left, y, 2.7, measure, 2, 3.2)
    y += (originLines - 1) * 3.2
    rule(y + 2, left, right)
    y += 6.2
    for (const [field, caption, value] of rows) {
      add(
        field + "-caption",
        caption.toUpperCase(),
        left,
        y,
        2.2,
        LABEL_INK,
        "start",
        0.1
      )
      fit(field, value, 17, y, 2.6, right - 17)
      y += 3.5
    }
    if (recorded(d.tasting)) {
      add("tasting-caption", "TASTING", left, y, 2.2, LABEL_INK, "start", 0.1)
      fit("tasting", d.tasting, left, y + 3.4, 2.6, measure, 2, 3.2)
    }
    rule(73.2, left, right)
    if (total) fit("total", total, left, 77.3, 4, 24)
    fit("date", date, right, 77.1, 2.6, 20, 1, 3, LABEL_INK, "end")
  } else if (side === "details") {
    // 50 × 30 mm companion: every remaining field. Rows end above the rule at
    // 24.6 mm; a two-line tasting note is the deepest case (baseline 23.4 mm).
    const left = 2.5,
      right = 47.5,
      column = 14
    let y = 4.6
    for (const [field, caption, value] of rows) {
      add(
        field + "-caption",
        caption.toUpperCase(),
        left,
        y,
        2,
        LABEL_INK,
        "start",
        0.05
      )
      fit(field, value, column, y, 2.4, right - column)
      y += 3.1
    }
    if (recorded(d.tasting)) {
      add("tasting-caption", "TASTING", left, y, 2, LABEL_INK, "start", 0.05)
      fit("tasting", d.tasting, column, y, 2.4, right - column, 2, 2.8)
    }
    rule(24.6, left, right)
    add("roast-number", "Roast " + d.roastId, left, 28.2, 2.4)
    fit("date", date, right, 28.2, 2.3, 22, 1, 3, LABEL_INK, "end")
  } else {
    // 50 × 30 mm front, single ink.
    const left = 2.5,
      right = 47.5,
      measure = right - left
    logo(left, 2.2, 9)
    add("brand", "Tan", 13.5, 5.2, 2.8)
    add("roast-number", "Roast " + d.roastId, 13.5, 8.8, 2.6)
    fit("date", date, right, 8.8, 2.3, 18, 1, 3, LABEL_INK, "end")
    const oneLine = wrap(d.coffee, 4.2, measure).length <= 1,
      nameSize = oneLine ? 4.2 : 3.4,
      nameLines = fit("coffee", d.coffee, left, 15, nameSize, measure, 2, 3.8)
    const originY = 15 + (nameLines - 1) * 3.8 + 3.8
    fit("origin", origin, left, originY, 2.4, measure)
    rule(originY + 1.6, left, right)
    if (total) fit("total", total, left, 28, 2.8, 20)
    if (recorded(d.level))
      fit(
        "level",
        "Level " + d.level,
        right,
        28,
        2.4,
        22,
        1,
        3,
        LABEL_INK,
        "end"
      )
  }
  if (width > 50)
    warnings.push(
      "This width exceeds the selected 50 mm stock. Match the roll and app geometry before printing."
    )
  const desc = Object.entries(d)
    .map(([k, v]) => k + ": " + v)
    .join("; ")
  // White stock is the medium: no background is printed.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${labelEscape(d.coffee + " roast " + d.roastId + " label")}"><title>${labelEscape(d.coffee + " · Roast " + d.roastId + " label")}</title><desc>${labelEscape(desc)}. ${small ? "Front and details pair required for all fields." : "Complete information label."}</desc><defs><filter id="ink-black" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter></defs>${parts.join("")}</svg>`
  return { svg, warnings, fields, small, shown }
}
