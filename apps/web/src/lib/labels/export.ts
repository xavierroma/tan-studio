import type { LabelArtwork } from "./artwork"
export type PrintInput = LabelArtwork & {
  widthMicrometers: number
  heightMicrometers: number
  companionSvg?: string | undefined
}
export type RasterArtwork = {
  png: Uint8Array
  rgb: Uint8Array
  width: number
  height: number
  widthMm: number
  heightMm: number
  blackPixels: number
  redPixels: number
  dpi: number
  side: string
}
function proColorPlanes(svg: string) {
  const p = new DOMParser().parseFromString(svg, "image/svg+xml"),
    root = p.documentElement
  const isRed = (e: Element) =>
    e.getAttribute("fill") === "#a32225" ||
    e.getAttribute("stroke") === "#a32225"
  const black = root.cloneNode(true) as Element,
    red = root.cloneNode(true) as Element
  for (const c of [...black.children]) if (isRed(c)) c.remove()
  for (const c of [...red.children])
    if (!["defs", "title", "desc"].includes(c.tagName) && !isRed(c)) c.remove()
  for (const e of red.querySelectorAll('[fill="#a32225"],[stroke="#a32225"]')) {
    if (e.getAttribute("fill") === "#a32225") e.setAttribute("fill", "#000")
    if (e.getAttribute("stroke") === "#a32225") e.setAttribute("stroke", "#000")
  }
  const serializer = new XMLSerializer()
  return {
    black: serializer.serializeToString(black),
    red: serializer.serializeToString(red),
  }
}
async function proRasterPlane(svg: string, w: number, h: number) {
  const img = new Image()
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}
function proCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const v of bytes) {
    crc ^= v
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function proUint32(n: number) {
  return new Uint8Array([
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ])
}
function proJoin(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0))
  let offset = 0
  for (const b of chunks) {
    out.set(b, offset)
    offset += b.length
  }
  return out
}
export function proPngDpi(bytes: Uint8Array, dpi = 300) {
  const signature = bytes.slice(0, 8),
    chunks = [signature],
    type = new TextEncoder().encode("pHYs"),
    ppm = Math.round(dpi / 0.0254),
    payload = proJoin([
      type,
      proUint32(ppm),
      proUint32(ppm),
      new Uint8Array([1]),
    ]),
    phys = proJoin([proUint32(9), payload, proUint32(proCrc32(payload))])
  let pos = 8,
    added = false
  while (pos < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + pos, 4).getUint32(
        0
      ),
      tag = new TextDecoder().decode(bytes.slice(pos + 4, pos + 8))
    if (tag !== "pHYs") chunks.push(bytes.slice(pos, pos + len + 12))
    if (tag === "IHDR" && !added) {
      chunks.push(phys)
      added = true
    }
    pos += len + 12
  }
  return proJoin(chunks)
}
export async function proExportArtwork(
  data: PrintInput,
  side = "front"
): Promise<RasterArtwork> {
  if (!data) throw Error("Choose valid label geometry and copy first.")
  if (data.warnings.length)
    throw Error("Resolve the label fit warning before exporting a print file.")
  const svg = side === "details" ? data.companionSvg : data.svg
  if (!svg) throw Error("No companion surface is required for this format.")
  const w = Math.round((data.widthMicrometers / 1000 / 25.4) * 300),
    h = Math.round((data.heightMicrometers / 1000 / 25.4) * 300),
    planes = proColorPlanes(svg),
    black = await proRasterPlane(planes.black, w, h),
    red = await proRasterPlane(planes.red, w, h),
    canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!,
    image = ctx.createImageData(w, h),
    rgb = new Uint8Array(w * h * 3)
  let blackPixels = 0,
    redPixels = 0
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4,
      hasRed = red.data[idx]! < 160,
      hasBlack = black.data[idx]! < 160
    const color = hasRed ? [255, 0, 0] : hasBlack ? [0, 0, 0] : [255, 255, 255]
    if (hasRed) redPixels++
    else if (hasBlack) blackPixels++
    image.data.set([...color, 255], idx)
    rgb.set(color, i * 3)
  }
  ctx.putImageData(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("PNG export failed."))),
      "image/png"
    )
  )
  const png = proPngDpi(new Uint8Array(await blob.arrayBuffer()))
  return {
    png,
    rgb,
    width: w,
    height: h,
    widthMm: data.widthMicrometers / 1000,
    heightMm: data.heightMicrometers / 1000,
    blackPixels,
    redPixels,
    dpi: 300,
    side,
  }
}
export async function proPdf(art: RasterArtwork) {
  if (!globalThis.CompressionStream)
    throw Error(
      "This browser cannot build the PDF. Download PNG or SVG instead."
    )
  const stream = new Blob([new Uint8Array(art.rgb)])
      .stream()
      .pipeThrough(new CompressionStream("deflate")),
    compressed = new Uint8Array(await new Response(stream).arrayBuffer()),
    enc = new TextEncoder(),
    str = (s: string) => enc.encode(s),
    pw = ((art.widthMm * 72) / 25.4).toFixed(5),
    ph = ((art.heightMm * 72) / 25.4).toFixed(5),
    content = str(`q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`),
    objects = [
      str("<< /Type /Catalog /Pages 2 0 R >>"),
      str("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      str(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
      ),
      proJoin([
        str(
          `<< /Type /XObject /Subtype /Image /Width ${art.width} /Height ${art.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`
        ),
        compressed,
        str("\nendstream"),
      ]),
      proJoin([
        str(`<< /Length ${content.length} >>\nstream\n`),
        content,
        str("endstream"),
      ]),
    ],
    chunks = [str("%PDF-1.4\n% Tan Studio; export is not a printed job\n")],
    offsets = [0]
  let offset = chunks[0]!.length
  objects.forEach((o, i) => {
    const block = proJoin([str(`${i + 1} 0 obj\n`), o, str("\nendobj\n")])
    offsets.push(offset)
    chunks.push(block)
    offset += block.length
  })
  chunks.push(
    str(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
          .join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    )
  )
  return proJoin(chunks)
}
export function proDownload(
  bytes: Uint8Array | string,
  mime: string,
  filename: string
) {
  const url = URL.createObjectURL(
      new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], {
        type: mime,
      })
    ),
    a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
