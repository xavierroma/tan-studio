import { describe, expect, test } from "bun:test"

import {
  DeterministicSvgLabelRenderer,
  LabelRenderError,
  renderLabelToSvg,
} from "../src"
import type { LabelDocument, ResolvedLabelElement } from "../src"

function documentWith(elements: ResolvedLabelElement[]): LabelDocument {
  return {
    schemaVersion: 1,
    widthUm: 50_000,
    heightUm: 30_000,
    bleedUm: 0,
    safeInsetUm: 1_500,
    background: "paper",
    elements,
  }
}

describe("deterministic SVG label renderer", () => {
  test("renders exact physical dimensions and stable paint order", async () => {
    const document = documentWith([
      {
        kind: "rect",
        id: "panel",
        frame: { xUm: 1_000, yUm: 1_000, widthUm: 48_000, heightUm: 28_000 },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        radiusUm: 1_500,
        fill: "white",
        stroke: { ink: "accent", widthUm: 200, dashUm: [800, 400] },
      },
      {
        kind: "line",
        id: "rule",
        from: { xUm: 4_000, yUm: 20_000 },
        to: { xUm: 46_000, yUm: 20_000 },
        rotationMdeg: 0,
        opacityBasisPoints: 7_500,
        strokeUm: 180,
        ink: "muted",
      },
      {
        kind: "text",
        id: "coffee-name",
        frame: { xUm: 4_000, yUm: 4_000, widthUm: 42_000, heightUm: 12_000 },
        rotationMdeg: -1_500,
        opacityBasisPoints: 10_000,
        content: "Bali & Flores <Lot 7>",
        font: { family: "geist_sans", style: "normal" },
        sizeUm: 3_200,
        weight: 650,
        lineHeightBasisPoints: 12_000,
        horizontalAlign: "center",
        verticalAlign: "center",
        maxLines: 2,
        overflow: "error",
      },
    ])

    const renderer = new DeterministicSvgLabelRenderer()
    const first = await renderer.render(document)
    const second = await renderer.render(document)
    const svg = new TextDecoder().decode(first.bytes)

    expect(first).toEqual(second)
    expect(first.widthUm).toBe(50_000)
    expect(first.heightUm).toBe(30_000)
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(svg).toContain(
      'width="50mm" height="30mm" viewBox="0 0 50000 30000"'
    )
    expect(svg).toContain("Bali &amp; Flores &lt;Lot 7&gt;")
    expect(svg).toContain('transform="rotate(-1.5 25000 10000)"')
    expect(svg).toContain('opacity="0.75"')
    expect(svg.indexOf('id="panel"')).toBeLessThan(svg.indexOf('id="rule"'))
    expect(svg.indexOf('id="rule"')).toBeLessThan(
      svg.indexOf('id="coffee-name"')
    )
  })

  test("uses deterministic integer formatting instead of floating-point units", () => {
    const document = {
      ...documentWith([]),
      widthUm: 12_345,
      heightUm: 6_001,
    }
    const svg = renderLabelToSvg(document)
    expect(svg).toContain('width="12.345mm" height="6.001mm"')
    expect(svg).not.toContain("12.345000")
  })

  test("embeds only explicitly supplied validated image artifacts", () => {
    const hash = "a".repeat(64)
    const document = documentWith([
      {
        kind: "image",
        id: "mark",
        frame: { xUm: 2_000, yUm: 2_000, widthUm: 8_000, heightUm: 8_000 },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        artifactHash: hash,
        fit: "contain",
      },
    ])

    expect(() => renderLabelToSvg(document)).toThrow(
      expect.objectContaining({ code: "missing_image", elementId: "mark" })
    )
    const svg = renderLabelToSvg(document, {
      imageAssets: new Map([
        [hash, { mimeType: "image/png", base64: "iVBORw==" }],
      ]),
    })
    expect(svg).toContain("data:image/png;base64,iVBORw==")
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"')

    const hostileAssets = new Map([
      [
        hash,
        {
          mimeType: 'image/svg+xml" onload="alert(1)',
          base64: "iVBORw==",
        },
      ],
    ])
    expect(() =>
      renderLabelToSvg(document, {
        imageAssets: hostileAssets as never,
      })
    ).toThrow(expect.objectContaining({ code: "invalid_image" }))
  })

  test("rejects duplicate IDs and geometry outside the media", () => {
    const rect: ResolvedLabelElement = {
      kind: "rect",
      id: "same",
      frame: { xUm: 0, yUm: 0, widthUm: 10_000, heightUm: 10_000 },
      rotationMdeg: 0,
      opacityBasisPoints: 10_000,
      radiusUm: 0,
      fill: "primary",
    }
    expect(() => renderLabelToSvg(documentWith([rect, rect]))).toThrow(
      expect.objectContaining({ code: "duplicate_element_id" })
    )

    const outside: ResolvedLabelElement = {
      ...rect,
      id: "outside",
      frame: { xUm: 49_000, yUm: 0, widthUm: 2_000, heightUm: 1_000 },
    }
    expect(() => renderLabelToSvg(documentWith([outside]))).toThrow(
      expect.objectContaining({
        code: "invalid_geometry",
        elementId: "outside",
      })
    )
  })

  test("handles explicit text overflow deterministically", () => {
    const text: ResolvedLabelElement = {
      kind: "text",
      id: "notes",
      frame: { xUm: 1_000, yUm: 1_000, widthUm: 20_000, heightUm: 20_000 },
      rotationMdeg: 0,
      opacityBasisPoints: 10_000,
      content: "one\ntwo\nthree",
      font: { family: "noto_sans", style: "italic" },
      sizeUm: 2_000,
      weight: 400,
      lineHeightBasisPoints: 10_000,
      horizontalAlign: "start",
      verticalAlign: "start",
      maxLines: 2,
      overflow: "error",
    }
    expect(() => renderLabelToSvg(documentWith([text]))).toThrow(
      expect.objectContaining({ code: "text_overflow" })
    )

    const svg = renderLabelToSvg(
      documentWith([{ ...text, overflow: "ellipsis" }])
    )
    expect(svg).toContain(">two…</tspan>")
    expect(svg).not.toContain(">three</tspan>")

    const physicallyTooTall = {
      ...text,
      content: "one\ntwo",
      frame: { ...text.frame, heightUm: 2_500 },
      maxLines: 2,
    } satisfies ResolvedLabelElement
    expect(() => renderLabelToSvg(documentWith([physicallyTooTall]))).toThrow(
      expect.objectContaining({ code: "text_overflow" })
    )
  })

  test("renders a pinned QR matrix with exact physical module geometry", async () => {
    const qr: ResolvedLabelElement = {
      kind: "qr",
      id: "roast-code",
      frame: { xUm: 1_000, yUm: 1_000, widthUm: 10_000, heightUm: 10_000 },
      rotationMdeg: 0,
      opacityBasisPoints: 10_000,
      data: "opaque-roast-id",
      correction: "M",
      quietModules: 4,
    }

    const artifact = await new DeterministicSvgLabelRenderer().render(
      documentWith([qr])
    )
    const svg = new TextDecoder().decode(artifact.bytes)

    // Strong golden: pins qrcode 1.5.4 segmentation, mask selection, and matrix.
    expect(artifact.sha256).toBe(
      "e6cf9dae7910b5343a8f7ec833ab5a638f4737e053bced6323673edb373f9c92"
    )
    expect(svg).toContain(
      'data-qr-version="2" data-qr-mask="2" data-qr-module-count="25" data-qr-module-um="303" data-qr-quiet-modules="4"'
    )
    expect(svg).toContain(
      '<rect x="1000" y="1000" width="9999" height="9999" fill="#FFFFFF"/>'
    )
    // Four quiet modules consume 4 * 303 um before the first dark finder module.
    expect(svg).toContain('d="M2212 2212h2121v303h-2121z')
  })

  test("rejects QR payload and physical module sizes outside safe bounds", () => {
    const qr: ResolvedLabelElement = {
      kind: "qr",
      id: "roast-code",
      frame: { xUm: 1_000, yUm: 1_000, widthUm: 4_000, heightUm: 4_000 },
      rotationMdeg: 0,
      opacityBasisPoints: 10_000,
      data: "opaque-roast-id",
      correction: "Q",
      quietModules: 4,
    }
    expect(() => renderLabelToSvg(documentWith([qr]))).toThrow(
      expect.objectContaining({ code: "qr_geometry" })
    )
    expect(() =>
      renderLabelToSvg(
        documentWith([
          {
            ...qr,
            frame: {
              xUm: 1_000,
              yUm: 1_000,
              widthUm: 28_000,
              heightUm: 28_000,
            },
            data: "x".repeat(2_049),
          },
        ])
      )
    ).toThrow(expect.objectContaining({ code: "qr_payload_too_large" }))
  })

  test("keeps barcode rendering fail-closed pending a maintained encoder", () => {
    const barcode: ResolvedLabelElement = {
      kind: "barcode",
      id: "lot-code",
      frame: { xUm: 1_000, yUm: 1_000, widthUm: 20_000, heightUm: 8_000 },
      rotationMdeg: 0,
      opacityBasisPoints: 10_000,
      data: "LOT-2026-07",
      symbology: "code128",
      humanReadable: true,
    }
    expect(() => renderLabelToSvg(documentWith([barcode]))).toThrow(
      expect.objectContaining({ code: "symbol_renderer_unavailable" })
    )
  })

  test("observes cancellation without producing an artifact", async () => {
    const controller = new AbortController()
    controller.abort()
    const renderer = new DeterministicSvgLabelRenderer()
    try {
      await renderer.render(documentWith([]), {}, controller.signal)
      throw new Error("expected rendering to be cancelled")
    } catch (error) {
      expect(error).toBeInstanceOf(LabelRenderError)
      expect(error).toMatchObject({ code: "cancelled" })
    }
  })
})
