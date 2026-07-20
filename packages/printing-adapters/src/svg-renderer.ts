import * as QRCode from "qrcode"

import type {
  LabelBoxElementBase,
  LabelDocument,
  ResolvedLabelElement,
  SemanticInk,
  SemanticStroke,
  Sha256,
} from "./label-document"

const MAXIMUM_MEDIA_UM = 1_000_000
const MAXIMUM_ELEMENTS = 1_000
const MAXIMUM_TEXT_CHARACTERS = 16_384
const MAXIMUM_QR_PAYLOAD_BYTES = 2_048
const MINIMUM_QR_MODULE_UM = 250
const MAXIMUM_QR_QUIET_MODULES = 32
const utf8Encoder = new TextEncoder()

const INKS: Readonly<Record<SemanticInk, string>> = Object.freeze({
  foreground: "#2F2925",
  muted: "#756B63",
  primary: "#8A5A44",
  accent: "#D8A48F",
  success: "#66806A",
  warning: "#B57A45",
  info: "#607D8B",
  paper: "#FBF7F0",
  black: "#000000",
  white: "#FFFFFF",
})

export type SvgImageAsset = {
  mimeType: "image/png" | "image/jpeg"
  base64: string
}

export type SvgRenderOptions = {
  imageAssets?: ReadonlyMap<Sha256, SvgImageAsset>
}

export type SvgPrintArtifact = {
  kind: "svg"
  mimeType: "image/svg+xml"
  widthUm: number
  heightUm: number
  bytes: Uint8Array
  sha256: Sha256
}

export type LabelRenderErrorCode =
  | "invalid_document"
  | "invalid_geometry"
  | "duplicate_element_id"
  | "text_overflow"
  | "missing_image"
  | "invalid_image"
  | "qr_payload_too_large"
  | "qr_geometry"
  | "symbol_encoding_failed"
  | "symbol_renderer_unavailable"
  | "cancelled"

export class LabelRenderError extends Error {
  readonly code: LabelRenderErrorCode
  readonly elementId: string | undefined

  constructor(code: LabelRenderErrorCode, message: string, elementId?: string) {
    super(message)
    this.name = "LabelRenderError"
    this.code = code
    this.elementId = elementId
  }
}

/**
 * Deterministic Stage-0 SVG renderer. It performs no filesystem, network,
 * spooler, printer, or system-font I/O.
 */
export class DeterministicSvgLabelRenderer {
  async render(
    document: LabelDocument,
    options: SvgRenderOptions = {},
    signal?: AbortSignal
  ): Promise<SvgPrintArtifact> {
    throwIfAborted(signal)
    const svg = renderLabelToSvg(document, options, signal)
    const bytes = new TextEncoder().encode(svg)
    throwIfAborted(signal)
    return {
      kind: "svg",
      mimeType: "image/svg+xml",
      widthUm: document.widthUm,
      heightUm: document.heightUm,
      bytes,
      sha256: await sha256(bytes),
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export function renderLabelToSvg(
  document: LabelDocument,
  options: SvgRenderOptions = {},
  signal?: AbortSignal
): string {
  validateDocument(document)
  const ids = new Set<string>()
  const rendered: string[] = []

  rendered.push(
    `<rect x="0" y="0" width="${document.widthUm}" height="${document.heightUm}" fill="${INKS[document.background]}"/>`
  )

  for (const element of document.elements) {
    throwIfAborted(signal)
    validateBase(element, document)
    if (ids.has(element.id)) {
      throw new LabelRenderError(
        "duplicate_element_id",
        `Element ID ${element.id} is duplicated`,
        element.id
      )
    }
    ids.add(element.id)
    rendered.push(renderElement(element, options))
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${micrometresToMillimetres(document.widthUm)}mm" height="${micrometresToMillimetres(document.heightUm)}mm" viewBox="0 0 ${document.widthUm} ${document.heightUm}" role="img">`,
    ...rendered,
    "</svg>",
  ].join("\n")
}

function renderElement(
  element: ResolvedLabelElement,
  options: SvgRenderOptions
): string {
  switch (element.kind) {
    case "rect":
      return renderRect(element)
    case "line":
      return `<line id="${escapeXml(element.id)}" x1="${element.from.xUm}" y1="${element.from.yUm}" x2="${element.to.xUm}" y2="${element.to.yUm}" stroke="${INKS[element.ink]}" stroke-width="${element.strokeUm}"${commonAttributes(element)}/>`
    case "text":
      return renderText(element)
    case "image":
      return renderImage(element, options)
    case "qr":
      return renderQr(element)
    case "barcode":
      throw new LabelRenderError(
        "symbol_renderer_unavailable",
        `${element.kind} rendering requires the maintained symbol adapter`,
        element.id
      )
    default:
      throw new LabelRenderError(
        "invalid_document",
        "Unknown label element kind"
      )
  }
}

function renderQr(
  element: Extract<ResolvedLabelElement, { kind: "qr" }>
): string {
  const payloadBytes = utf8Encoder.encode(element.data).byteLength
  if (payloadBytes === 0 || payloadBytes > MAXIMUM_QR_PAYLOAD_BYTES) {
    throw new LabelRenderError(
      "qr_payload_too_large",
      `QR payload must contain 1 through ${MAXIMUM_QR_PAYLOAD_BYTES} UTF-8 bytes`,
      element.id
    )
  }

  let symbol: QRCode.QRCode
  try {
    symbol = QRCode.create(element.data, {
      errorCorrectionLevel: element.correction,
    })
  } catch (error) {
    throw new LabelRenderError(
      "symbol_encoding_failed",
      `QR encoding failed: ${errorMessage(error)}`,
      element.id
    )
  }

  const moduleCount = symbol.modules.size
  const totalModules = moduleCount + element.quietModules * 2
  const moduleSizeUm = Math.trunc(
    Math.min(element.frame.widthUm, element.frame.heightUm) / totalModules
  )
  if (moduleSizeUm < MINIMUM_QR_MODULE_UM) {
    throw new LabelRenderError(
      "qr_geometry",
      `QR frame provides ${moduleSizeUm} um per module; at least ${MINIMUM_QR_MODULE_UM} um is required`,
      element.id
    )
  }

  const symbolSizeUm = totalModules * moduleSizeUm
  const symbolXUm =
    element.frame.xUm + Math.trunc((element.frame.widthUm - symbolSizeUm) / 2)
  const symbolYUm =
    element.frame.yUm + Math.trunc((element.frame.heightUm - symbolSizeUm) / 2)
  const matrixXUm = symbolXUm + element.quietModules * moduleSizeUm
  const matrixYUm = symbolYUm + element.quietModules * moduleSizeUm
  const path = qrDarkModulePath(
    symbol.modules,
    matrixXUm,
    matrixYUm,
    moduleSizeUm
  )

  return `<g id="${escapeXml(element.id)}" data-qr-version="${symbol.version}" data-qr-mask="${symbol.maskPattern ?? "unknown"}" data-qr-module-count="${moduleCount}" data-qr-module-um="${moduleSizeUm}" data-qr-quiet-modules="${element.quietModules}"${commonAttributes(element)}><rect x="${symbolXUm}" y="${symbolYUm}" width="${symbolSizeUm}" height="${symbolSizeUm}" fill="${INKS.white}"/><path fill="${INKS.black}" shape-rendering="crispEdges" d="${path}"/></g>`
}

function qrDarkModulePath(
  modules: QRCode.BitMatrix,
  originXUm: number,
  originYUm: number,
  moduleSizeUm: number
): string {
  const commands: string[] = []
  for (let row = 0; row < modules.size; row += 1) {
    let column = 0
    while (column < modules.size) {
      if (modules.get(row, column) === 0) {
        column += 1
        continue
      }
      const runStart = column
      while (column < modules.size && modules.get(row, column) !== 0) {
        column += 1
      }
      const xUm = originXUm + runStart * moduleSizeUm
      const yUm = originYUm + row * moduleSizeUm
      const widthUm = (column - runStart) * moduleSizeUm
      commands.push(`M${xUm} ${yUm}h${widthUm}v${moduleSizeUm}h-${widthUm}z`)
    }
  }
  return commands.join("")
}

function renderRect(
  element: Extract<ResolvedLabelElement, { kind: "rect" }>
): string {
  const fill = element.fill === undefined ? "none" : INKS[element.fill]
  const stroke = renderStroke(element.stroke)
  return `<rect id="${escapeXml(element.id)}" x="${element.frame.xUm}" y="${element.frame.yUm}" width="${element.frame.widthUm}" height="${element.frame.heightUm}" rx="${element.radiusUm}" fill="${fill}"${stroke}${commonAttributes(element)}/>`
}

function renderText(
  element: Extract<ResolvedLabelElement, { kind: "text" }>
): string {
  if (
    element.content.length > MAXIMUM_TEXT_CHARACTERS ||
    hasForbiddenXmlControl(element.content)
  ) {
    throw new LabelRenderError(
      "invalid_document",
      "Text content is invalid or too long",
      element.id
    )
  }
  let lines = element.content.split(/\r\n|\r|\n/)
  if (lines.length > element.maxLines) {
    if (element.overflow === "error") {
      throw new LabelRenderError(
        "text_overflow",
        `Text has ${lines.length} explicit lines; maximum is ${element.maxLines}`,
        element.id
      )
    }
    lines = lines.slice(0, element.maxLines)
    const finalIndex = lines.length - 1
    lines[finalIndex] = `${lines[finalIndex] ?? ""}…`
  }

  const lineHeightUm = divideBasisPoints(
    element.sizeUm,
    element.lineHeightBasisPoints
  )
  const textBlockHeight = element.sizeUm + lineHeightUm * (lines.length - 1)
  if (textBlockHeight > element.frame.heightUm) {
    throw new LabelRenderError(
      "text_overflow",
      "Text block is taller than its physical frame",
      element.id
    )
  }
  const firstBaseline =
    element.verticalAlign === "start"
      ? element.frame.yUm + element.sizeUm
      : element.verticalAlign === "center"
        ? element.frame.yUm +
          Math.trunc((element.frame.heightUm - textBlockHeight) / 2) +
          element.sizeUm
        : element.frame.yUm +
          element.frame.heightUm -
          textBlockHeight +
          element.sizeUm
  const x =
    element.horizontalAlign === "start"
      ? element.frame.xUm
      : element.horizontalAlign === "center"
        ? element.frame.xUm + Math.trunc(element.frame.widthUm / 2)
        : element.frame.xUm + element.frame.widthUm
  const anchor =
    element.horizontalAlign === "start"
      ? "start"
      : element.horizontalAlign === "center"
        ? "middle"
        : "end"
  const fontFamily =
    element.font.family === "geist_sans" ? "Geist Sans" : "Noto Sans"
  const spans = lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${firstBaseline + lineHeightUm * index}">${escapeXml(line)}</tspan>`
    )
    .join("")
  return `<text id="${escapeXml(element.id)}" fill="${INKS.foreground}" font-family="${fontFamily}" font-size="${element.sizeUm}" font-style="${element.font.style}" font-weight="${element.weight}" text-anchor="${anchor}" xml:space="preserve"${commonAttributes(element)}>${spans}</text>`
}

function renderImage(
  element: Extract<ResolvedLabelElement, { kind: "image" }>,
  options: SvgRenderOptions
): string {
  const asset = options.imageAssets?.get(element.artifactHash)
  if (asset === undefined) {
    throw new LabelRenderError(
      "missing_image",
      `No validated image asset was supplied for ${element.artifactHash}`,
      element.id
    )
  }
  if (
    (asset.mimeType !== "image/png" && asset.mimeType !== "image/jpeg") ||
    typeof asset.base64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      asset.base64
    )
  ) {
    throw new LabelRenderError(
      "invalid_image",
      "Image asset is not canonical Base64",
      element.id
    )
  }
  return `<image id="${escapeXml(element.id)}" x="${element.frame.xUm}" y="${element.frame.yUm}" width="${element.frame.widthUm}" height="${element.frame.heightUm}" preserveAspectRatio="${element.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}" href="data:${asset.mimeType};base64,${asset.base64}"${commonAttributes(element)}/>`
}

function commonAttributes(element: ResolvedLabelElement): string {
  const opacity =
    element.opacityBasisPoints === 10_000
      ? ""
      : ` opacity="${basisPointsDecimal(element.opacityBasisPoints)}"`
  if (element.rotationMdeg === 0) return opacity

  const center =
    "frame" in element
      ? {
          x: element.frame.xUm + Math.trunc(element.frame.widthUm / 2),
          y: element.frame.yUm + Math.trunc(element.frame.heightUm / 2),
        }
      : {
          x: Math.trunc((element.from.xUm + element.to.xUm) / 2),
          y: Math.trunc((element.from.yUm + element.to.yUm) / 2),
        }
  return `${opacity} transform="rotate(${millidegreesDecimal(element.rotationMdeg)} ${center.x} ${center.y})"`
}

function renderStroke(stroke: SemanticStroke | undefined): string {
  if (stroke === undefined) return ""
  const dash =
    stroke.dashUm === undefined || stroke.dashUm.length === 0
      ? ""
      : ` stroke-dasharray="${stroke.dashUm.join(" ")}"`
  return ` stroke="${INKS[stroke.ink]}" stroke-width="${stroke.widthUm}"${dash}`
}

function validateDocument(document: LabelDocument): void {
  if (document.schemaVersion !== 1) {
    throw new LabelRenderError(
      "invalid_document",
      "Unsupported label schema version"
    )
  }
  positiveInteger(document.widthUm, "widthUm")
  positiveInteger(document.heightUm, "heightUm")
  if (
    document.widthUm > MAXIMUM_MEDIA_UM ||
    document.heightUm > MAXIMUM_MEDIA_UM
  ) {
    throw new LabelRenderError(
      "invalid_geometry",
      "Label media exceeds the one-metre safety limit"
    )
  }
  nonNegativeInteger(document.bleedUm, "bleedUm")
  nonNegativeInteger(document.safeInsetUm, "safeInsetUm")
  validateInk(document.background)
  if (
    document.safeInsetUm * 2 >= document.widthUm ||
    document.safeInsetUm * 2 >= document.heightUm
  ) {
    throw new LabelRenderError(
      "invalid_geometry",
      "Safe inset consumes the label media"
    )
  }
  if (!Array.isArray(document.elements)) {
    throw new LabelRenderError(
      "invalid_document",
      "Label elements must be an array"
    )
  }
  if (document.elements.length > MAXIMUM_ELEMENTS) {
    throw new LabelRenderError(
      "invalid_document",
      `Label exceeds ${MAXIMUM_ELEMENTS} elements`
    )
  }
}

function validateBase(
  element: ResolvedLabelElement,
  document: LabelDocument
): void {
  if (
    typeof element.id !== "string" ||
    element.id.length === 0 ||
    element.id.length > 128 ||
    hasForbiddenXmlControl(element.id)
  ) {
    throw new LabelRenderError(
      "invalid_document",
      "Element ID is invalid",
      element.id
    )
  }
  integer(element.rotationMdeg, "rotationMdeg", element.id)
  rangedInteger(
    element.opacityBasisPoints,
    0,
    10_000,
    "opacityBasisPoints",
    element.id
  )

  if ("frame" in element) {
    validateFrame(element, document)
  } else {
    pointWithinMedia(element.from.xUm, element.from.yUm, document, element.id)
    pointWithinMedia(element.to.xUm, element.to.yUm, document, element.id)
    positiveInteger(element.strokeUm, "strokeUm", element.id)
  }

  switch (element.kind) {
    case "text":
      rangedInteger(element.sizeUm, 1, MAXIMUM_MEDIA_UM, "sizeUm", element.id)
      rangedInteger(element.weight, 1, 1_000, "weight", element.id)
      rangedInteger(
        element.lineHeightBasisPoints,
        1,
        100_000,
        "lineHeightBasisPoints",
        element.id
      )
      rangedInteger(element.maxLines, 1, 1_000, "maxLines", element.id)
      if (
        typeof element.content !== "string" ||
        (element.font.family !== "geist_sans" &&
          element.font.family !== "noto_sans") ||
        (element.font.style !== "normal" && element.font.style !== "italic") ||
        !["start", "center", "end"].includes(element.horizontalAlign) ||
        !["start", "center", "end"].includes(element.verticalAlign) ||
        (element.overflow !== "error" && element.overflow !== "ellipsis")
      ) {
        throw new LabelRenderError(
          "invalid_document",
          "Text element contains an unsupported value",
          element.id
        )
      }
      break
    case "rect":
      nonNegativeInteger(element.radiusUm, "radiusUm", element.id)
      if (
        element.radiusUm * 2 >
        Math.min(element.frame.widthUm, element.frame.heightUm)
      ) {
        throw new LabelRenderError(
          "invalid_geometry",
          "Rectangle radius exceeds its frame",
          element.id
        )
      }
      if (element.fill !== undefined) validateInk(element.fill, element.id)
      if (element.stroke !== undefined)
        validateStroke(element.stroke, element.id)
      break
    case "qr":
      rangedInteger(
        element.quietModules,
        4,
        MAXIMUM_QR_QUIET_MODULES,
        "quietModules",
        element.id
      )
      if (
        typeof element.data !== "string" ||
        (element.correction !== "M" && element.correction !== "Q")
      ) {
        throw new LabelRenderError(
          "invalid_document",
          "QR element contains an unsupported value",
          element.id
        )
      }
      break
    case "barcode":
      if (
        typeof element.data !== "string" ||
        element.symbology !== "code128" ||
        typeof element.humanReadable !== "boolean"
      ) {
        throw new LabelRenderError(
          "invalid_document",
          "Barcode element contains an unsupported value",
          element.id
        )
      }
      break
    case "image":
      if (
        !/^[0-9a-f]{64}$/.test(element.artifactHash) ||
        (element.fit !== "contain" && element.fit !== "cover")
      ) {
        throw new LabelRenderError(
          "invalid_document",
          "Image element contains an unsupported value",
          element.id
        )
      }
      break
    case "line":
      validateInk(element.ink, element.id)
      break
    default:
      throw new LabelRenderError(
        "invalid_document",
        "Unknown label element kind",
        (element as { id?: string }).id
      )
  }
}

function validateFrame(
  element: LabelBoxElementBase,
  document: LabelDocument
): void {
  integer(element.frame.xUm, "frame.xUm", element.id)
  integer(element.frame.yUm, "frame.yUm", element.id)
  positiveInteger(element.frame.widthUm, "frame.widthUm", element.id)
  positiveInteger(element.frame.heightUm, "frame.heightUm", element.id)
  if (
    element.frame.xUm < 0 ||
    element.frame.yUm < 0 ||
    element.frame.xUm + element.frame.widthUm > document.widthUm ||
    element.frame.yUm + element.frame.heightUm > document.heightUm
  ) {
    throw new LabelRenderError(
      "invalid_geometry",
      "Element frame is outside label media",
      element.id
    )
  }
}

function validateStroke(stroke: SemanticStroke, elementId: string): void {
  validateInk(stroke.ink, elementId)
  positiveInteger(stroke.widthUm, "stroke.widthUm", elementId)
  if (stroke.dashUm !== undefined && !Array.isArray(stroke.dashUm)) {
    throw new LabelRenderError(
      "invalid_document",
      "Stroke dash pattern must be an array",
      elementId
    )
  }
  for (const dash of stroke.dashUm ?? [])
    positiveInteger(dash, "stroke.dashUm", elementId)
}

function validateInk(ink: SemanticInk, elementId?: string): void {
  if (!Object.hasOwn(INKS, ink)) {
    throw new LabelRenderError(
      "invalid_document",
      "Unknown semantic ink",
      elementId
    )
  }
}

function pointWithinMedia(
  xUm: number,
  yUm: number,
  document: LabelDocument,
  elementId: string
): void {
  integer(xUm, "point.xUm", elementId)
  integer(yUm, "point.yUm", elementId)
  if (xUm < 0 || yUm < 0 || xUm > document.widthUm || yUm > document.heightUm) {
    throw new LabelRenderError(
      "invalid_geometry",
      "Line point is outside label media",
      elementId
    )
  }
}

function rangedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
  elementId?: string
): void {
  integer(value, name, elementId)
  if (value < minimum || value > maximum) {
    throw new LabelRenderError(
      "invalid_geometry",
      `${name} must be from ${minimum} through ${maximum}`,
      elementId
    )
  }
}

function positiveInteger(
  value: number,
  name: string,
  elementId?: string
): void {
  rangedInteger(value, 1, Number.MAX_SAFE_INTEGER, name, elementId)
}

function nonNegativeInteger(
  value: number,
  name: string,
  elementId?: string
): void {
  rangedInteger(value, 0, Number.MAX_SAFE_INTEGER, name, elementId)
}

function integer(value: number, name: string, elementId?: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new LabelRenderError(
      "invalid_geometry",
      `${name} must be a safe integer`,
      elementId
    )
  }
}

function micrometresToMillimetres(value: number): string {
  return fixedIntegerRatio(value, 1_000, 3)
}

function millidegreesDecimal(value: number): string {
  return fixedIntegerRatio(value, 1_000, 3)
}

function basisPointsDecimal(value: number): string {
  return fixedIntegerRatio(value, 10_000, 4)
}

function divideBasisPoints(value: number, basisPoints: number): number {
  return Math.trunc((value * basisPoints) / 10_000)
}

function fixedIntegerRatio(
  value: number,
  divisor: number,
  digits: number
): string {
  const negative = value < 0
  const absolute = Math.abs(value)
  const whole = Math.trunc(absolute / divisor)
  const remainder = absolute % divisor
  if (remainder === 0) return `${negative ? "-" : ""}${whole}`
  const fraction = remainder.toString().padStart(digits, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}.${fraction}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function hasForbiddenXmlControl(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new LabelRenderError("cancelled", "Label rendering was cancelled")
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown encoder error"
}
