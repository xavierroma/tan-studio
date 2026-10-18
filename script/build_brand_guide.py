"""Render the editable Tan Markdown guide to an illustrated PDF and HTML."""

from pathlib import Path
import html
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Image, Flowable, KeepTogether,
)

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "docs/brand"
ASSETS = ROOT / "sites/share/assets"
OUT = ROOT / "output/pdf/Tan-Brand-Guide.pdf"
INK = colors.HexColor("#000000")
RED = colors.HexColor("#B6151B")
RAW_STOCK = colors.HexColor("#E8E5DC")
STOCK = colors.HexColor("#FFF9EE")
WIDTH = A4[0] - 104
pdfmetrics.registerFont(TTFont("TanMono", str(ASSETS / "fonts/CourierPrime-Regular.ttf")))

BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10.1, leading=14.2,
                      spaceAfter=9, textColor=INK, splitLongWords=True)
H1 = ParagraphStyle("h1", fontName="TanMono", fontSize=25, leading=29,
                    spaceAfter=19, textColor=INK, keepWithNext=True)
H2 = ParagraphStyle("h2", fontName="TanMono", fontSize=15, leading=19,
                    spaceBefore=13, spaceAfter=7, textColor=RED, keepWithNext=True)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8.2, leading=11)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.8, leading=12, spaceAfter=0)
QUOTE = ParagraphStyle("quote", parent=BODY, fontName="TanMono", fontSize=9.6,
                       leading=13.4, leftIndent=13, rightIndent=8, spaceBefore=3, spaceAfter=12)


def normalize(s):
    return s.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")


def inline(s):
    s = html.escape(normalize(s))
    s = re.sub(r"`([^`]+)`", r'<font name="TanMono" size="8.4">\1</font>', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2" color="#B6151B">\1</link>', s)
    return s


class BrandFigure(Flowable):
    def __init__(self, kind):
        Flowable.__init__(self)
        self.kind = kind
        self.width = WIDTH
        self.height = {"cover": 220, "logo-panels": 156, "swatches": 94, "type-specimen": 146}[kind]

    def logo(self, x, y, w):
        self.canv.drawImage(str(ASSETS / "tan-logo.png"), x, y, width=w,
                            height=w * 1132 / 1389, mask="auto")

    def draw(self):
        c = self.canv
        if self.kind == "cover":
            self.logo(0, 22, 230)
            c.setFont("TanMono", 9)
            c.setFillColor(INK)
            c.drawString(0, 5, "Original plant / black + red / transparent cutouts")
        elif self.kind == "logo-panels":
            w = (WIDTH - 18) / 2
            for x, col, label in [(0, colors.white, "White label stock"), (w + 18, RAW_STOCK, "Raw stock")]:
                c.setFillColor(col)
                c.rect(x, 21, w, 133, fill=1, stroke=0)
                self.logo(x + (w - 135) / 2, 31, 135)
                c.setFont("TanMono", 9)
                c.setFillColor(INK)
                c.drawString(x, 6, label)
        elif self.kind == "swatches":
            w = (WIDTH - 27) / 4
            for i, (col, name, value) in enumerate([
                (INK, "Ink black", "#000000"), (RED, "Tan Red", "#B6151B"),
                (RAW_STOCK, "Raw stock", "#E8E5DC"), (colors.white, "White stock", "No printing"),
            ]):
                x = i * (w + 9)
                c.setFillColor(col)
                c.rect(x, 38, w, 54, fill=1, stroke=0)
                c.setFillColor(INK)
                c.setFont("TanMono", 9)
                c.drawString(x, 22, name)
                c.setFont("TanMono", 8)
                c.drawString(x, 8, value)
        elif self.kind == "type-specimen":
            for text, y, col in [("Vibed", 105, INK), ("Tan", 63, RED), ("Coffee", 21, INK)]:
                c.setFont("TanMono", 38)
                c.setFillColor(col)
                c.drawString(0, y, text)
            c.setFont("TanMono", 9)
            c.setFillColor(INK)
            for i, line in enumerate(["Courier Prime Regular", "Left aligned", "No artificial bold", "Real, selectable text"]):
                c.drawString(245, 113 - i * 18, line)


def web_inline(s):
    s = html.escape(normalize(s))
    s = re.sub(r"`([^`]+)`", r'<code>\1</code>', s)
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)


def parse_page(text, cover=False):
    lines = text.strip().splitlines()
    flow, web, i = [], [], 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line == "<!--references-->":
            flow.append(Spacer(1, 7))
            web.append('<h2>Sources</h2>')
            i += 1
            continue
        if line.startswith("[["):
            kind = line[2:-2]
            if kind == "ui-specimen":
                from PIL import Image as PillowImage
                file = BRAND / "assets/component-specimen.png"
                with PillowImage.open(file) as im:
                    height = WIDTH * im.height / im.width
                flow += [Image(str(file), width=WIDTH, height=height), Spacer(1, 15)]
                web.append('<img class="component-sheet" src="assets/component-specimen.png" alt="Actual shadcn component specimen with fictional coffee and roast records">')
            else:
                flow += [BrandFigure(kind), Spacer(1, 9)]
                if kind == "logo-panels":
                    web.append('<div class="logo-panels"><figure class="white"><img src="../../sites/share/assets/tan-logo.png" alt="Tan logo on white"></figure><figure class="raw-stock"><img src="../../sites/share/assets/tan-logo.png" alt="Tan logo on raw stock"></figure></div>')
                elif kind == "swatches":
                    web.append('<div class="swatches"><div class="black">Black<br>#000000</div><div class="red">Tan Red<br>#B6151B</div><div class="raw-stock">Raw stock<br>#E8E5DC</div><div class="white">White stock<br>Unprinted</div></div>')
                elif kind == "type-specimen":
                    web.append('<div class="type-specimen">Vibed<br><span>Tan</span><br>Coffee</div>')
                else:
                    web.append('<img class="cover-logo" src="../../sites/share/assets/tan-logo.png" alt="Original Tan coffee branch, with red cherries and black leaves">')
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = [s.strip() for s in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[-: ]+", s) for s in row):
                    rows.append(row)
                i += 1
            cols = len(rows[0])
            widths = ([WIDTH * .28, WIDTH * .23, WIDTH * .49] if cols == 3
                      else [WIDTH * .32, WIDTH * .68])
            data = [[Paragraph(inline(cell), CELL) for cell in row] for row in rows]
            table = Table(data, colWidths=widths, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("VALIGN", (0,0), (-1,-1), "TOP"), ("LEFTPADDING", (0,0), (-1,-1), 0),
                ("RIGHTPADDING", (0,0), (-1,-1), 10), ("TOPPADDING", (0,0), (-1,-1), 7),
                ("BOTTOMPADDING", (0,0), (-1,-1), 7),
                ("LINEBELOW", (0,0), (-1,0), .7, INK),
                ("LINEBELOW", (0,1), (-1,-1), .25, colors.HexColor("#bbb4a8")),
            ]))
            flow += [table, Spacer(1, 9)]
            web.append('<table>' + ''.join('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in row) + '</tr>' for row in rows) + '</table>')
            continue
        if line.startswith("# "):
            title = line[2:]
            flow.append(Paragraph(inline(title), H1))
            web.append(f'<h1>{html.escape(title)}</h1>')
            i += 1
            continue
        if line.startswith("## "):
            style = ParagraphStyle("cover-h2", parent=H2, textColor=INK) if cover else H2
            flow.append(Paragraph(inline(line[3:]), style))
            web.append(f'<h2>{html.escape(line[3:])}</h2>')
            i += 1
            continue
        parts = [line]
        while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"^(#|\[\[|\||<!--|- |\d+\. |>)", lines[i+1].strip()):
            i += 1
            parts.append(lines[i].strip())
        para = " ".join(parts)
        if para.startswith("> "):
            flow.append(Paragraph(inline(para[2:]), QUOTE))
            web.append(f'<blockquote>{html.escape(para[2:])}</blockquote>')
        else:
            flow.append(Paragraph(inline(para), SMALL if "https://" in para else BODY))
            web.append(f'<p>{web_inline(para)}</p>')
        i += 1
    return flow, '\n'.join(web)


def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(RAW_STOCK if doc.page == 1 else STOCK)
    canvas.rect(0, 0, *A4, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.setFont("TanMono", 8)
    canvas.drawString(52, A4[1] - 30, "TAN / BRAND GUIDE")
    canvas.drawString(52, 28, "18 OCT 2026 / v1.1")
    canvas.setFillColor(RED)
    canvas.drawRightString(A4[0] - 52, 28, f"{doc.page:02d}")
    canvas.restoreState()


def main():
    pages = (BRAND / "brand-guide.md").read_text().split("<!--page-->")
    story, web = [], []
    for i, page in enumerate(pages):
        flow, markup = parse_page(page, cover=i == 0)
        if i:
            story.append(PageBreak())
        story.extend(flow)
        web.append(f'<section class="sheet">{markup}<footer>Tan / Brand guide / {i+1:02d}</footer></section>')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=52, rightMargin=52,
                            topMargin=61, bottomMargin=53,
                            title="Tan / Brand guide", author="Tan")
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    css = '''@font-face{font-family:TanMono;src:url(../../sites/share/assets/fonts/CourierPrime-Regular.ttf)}
*{box-sizing:border-box}body{margin:0;background:#dedbd2;color:#000;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.sheet{background:#fff9ee;max-width:900px;margin:24px auto;padding:60px;position:relative}.sheet:first-child{background:#e8e5dc}
h1,h2{font-family:TanMono,monospace;font-weight:400;line-height:1.2}h1{font-size:32px;margin:0 0 24px}h2{font-size:22px;color:#b6151b;margin:28px 0 12px}.sheet:first-child h2{color:#000}p{margin:0 0 14px;overflow-wrap:anywhere}a{color:#b6151b;text-underline-offset:3px}code{font-family:TanMono,monospace;font-size:.88em}
.cover-logo{width:300px;max-width:100%;height:auto;margin:24px 0 36px}.logo-panels{display:flex;gap:16px}.logo-panels figure{margin:0;padding:20px;flex:1;min-width:0}.logo-panels img{width:170px;max-width:100%;display:block;margin:auto}.white{background:#fff}.raw-stock{background:#e8e5dc}
.swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0}.swatches div{padding:24px 10px;font-family:TanMono,monospace}.black{background:#000;color:#fff9ee}.red{background:#b6151b;color:#fff9ee}
table{border-collapse:collapse;width:100%;margin:18px 0 24px;font-size:13px}td{padding:10px 12px 10px 0;vertical-align:top;border-bottom:1px solid #0003}tr:first-child{font-family:TanMono,monospace;border-bottom:1px solid #000}
blockquote{font-family:TanMono,monospace;border-left:2px solid #b6151b;margin:20px 0;padding:0 20px}.type-specimen{font:50px/1.12 TanMono,monospace;margin:24px 0}.type-specimen span{color:#b6151b}.component-sheet{width:100%;height:auto}footer{font:11px TanMono,monospace;margin-top:36px}
@media(max-width:600px){.sheet{margin:0 0 16px;padding:30px 24px}h1{font-size:27px}.swatches{grid-template-columns:repeat(2,1fr)}}@media print{body{background:white}.sheet{margin:0;break-after:page;max-width:none;padding:0;box-shadow:none}@page{size:A4;margin:20mm}}
'''
    (BRAND / "guide.html").write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tan / Brand guide</title><style>' + css + '</style></head><body>' + '\n'.join(web) + '</body></html>\n')
    print(f"Built {OUT} from {len(pages)} source sections, plus docs/brand/guide.html")


if __name__ == "__main__":
    main()
