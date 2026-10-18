# Tan brand source

- [Brand guide](brand-guide.md): editable rules, examples and reusable art-direction prompts.
- [HTML reading copy](guide.html): generated from the same source.
- [PDF](../../output/pdf/Tan-Brand-Guide.pdf): the illustrated, reviewed handoff.
- [Component specimen](components.html): actual shared shadcn primitives with fictional records.
- [Tokens](tokens.css): opt-in brand aliases for future UI work; not imported by Studio automatically.
- [Palette proof](palette-proof.json): exact output states and source fingerprint.

The original plant in `source/coffee-branch-original.png` is immutable. Palette updates use deterministic pixel mapping. Do not regenerate the logo with an image model; the earlier white-filled recoloring and sun studies are not the adopted identity.

## Rebuild

From the repository root:

```sh
python3 script/build_brand_assets.py
python3 script/build_brand_assets.py --check
bun script/build_brand_components.tsx
```

Render `docs/brand/components.html` at a 720 px viewport and 2x pixel density to `docs/brand/assets/component-specimen.png` using a browser. Then run:

```sh
python3 script/build_brand_guide.py
```

The asset script needs Pillow; the guide builder needs ReportLab. Keep the Courier Prime license with the fonts. Render the PDF with Poppler and inspect every page after substantive changes. The generated HTML and PDF are reading copies; edit `brand-guide.md` and rebuild.
