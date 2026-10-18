"""Add Courier Prime Regular outlines to the jar-label print fonts.

Label artwork outlines every glyph so SVG, PNG and PDF exports never depend on
installed fonts. This adds (or replaces) the "typewriter" entry in
apps/web/src/lib/labels/fonts.ts from the brand's Courier Prime Regular, using
the same character set as the existing "detail" face. Regular only: the brand
forbids simulated bold.

Requires fontTools (`pip install fonttools`). Run from any directory.
"""

from pathlib import Path
import json

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "sites/share/assets/fonts/CourierPrime-Regular.ttf"
TARGET = ROOT / "apps/web/src/lib/labels/fonts.ts"
LICENSE = ROOT / "apps/web/src/lib/labels/licenses/courier-prime-OFL.txt"
PREFIX = "export const TanPrintFonts: Record<string,PrintFont> = "


def outline(font, glyph_set, char):
    name = font.getBestCmap().get(ord(char))
    if name is None:
        return None
    pen = SVGPathPen(glyph_set, ntos=lambda n: f"{n:g}")
    glyph_set[name].draw(pen)
    return {"a": glyph_set[name].width, "d": pen.getCommands()}


def main():
    lines = TARGET.read_text().split("\n")
    index = next(i for i, line in enumerate(lines) if line.startswith(PREFIX))
    fonts = json.loads(lines[index][len(PREFIX):])
    font = TTFont(FONT)
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for char in fonts["detail"]["glyphs"]:
        g = outline(font, glyph_set, char)
        if g is not None:
            glyphs[char] = g
    fonts["typewriter"] = {
        "units": font["head"].unitsPerEm,
        "glyphs": glyphs,
        "source": FONT.name,
        "axes": {},
    }
    lines[index] = PREFIX + json.dumps(fonts, separators=(",", ":"), ensure_ascii=False)
    TARGET.write_text("\n".join(lines))
    LICENSE.write_text((FONT.parent / "LICENSE-CourierPrime.txt").read_text())
    missing = sorted(set(fonts["detail"]["glyphs"]) - set(glyphs))
    print(f"typewriter: {len(glyphs)} glyphs; not in Courier Prime: {''.join(missing) or 'none'}")


if __name__ == "__main__":
    main()
