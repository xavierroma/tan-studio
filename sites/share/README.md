# Tan public site

Independent static HTML at https://tan.coffee, hosted in the `tan-studio-share` Vercel project in team `xroma`. The homepage uses the original coffee branch as the Tan logo, recolored in black and red, above the left-aligned three-line “Vibed / Tan / Coffee” title. The theme uses black and red ink on raw off-white stock with faint grain. The fictional gift example lives at `/123-karl-roast` and is excluded from search indexing. `share.tan.coffee` redirects to `tan.coffee`, retaining the requested path and query.

This directory has no notebook imports, credentials, runtime requests, client scripts, or Studio publishing controls. Individually authored gift pages may be added as static directories containing an `index.html`. Only publish content deliberately chosen for public sharing. Store the resulting HTTPS URL on a roast through its existing gift-page link field.

## Build

From the repository root run `bun script/build_public_site.tsx`. Commit the generated `index.html` alongside its source. The build renders the static image-and-heading layout to HTML; the public host needs no Node runtime or install step. `landing.css` supplies the approved paper-and-ink theme and responsive hero layout.

Courier Prime Regular is self-hosted with its SIL Open Font License in `assets/fonts`. The live title uses regular weight, left alignment, natural typewriter spacing and a subtle SVG ink mask; it remains selectable HTML text. `assets/tan-logo.png` is the transparent two-ink master; `tan-logo.webp` is a lossless export. The favicon and touch icon use the same botanical mark. The original plant pixels are mapped deterministically by `script/build_brand_assets.py` to black, red or transparency. No image generation is used to recolor or redraw the logo. Run the script with `--check` to verify the original geometry, exact palette, binary alpha and absence of white pixels. Source art and the palette proof are in `docs/brand/`. No sun is part of the adopted mark.

## Preview

From this directory run `python3 -m http.server 4321 --bind 127.0.0.1`. Open http://127.0.0.1:4321.

## Hosting

Project ID: `prj_s4f9lmcgHfvB43W64NDQOXlANAol`
Team ID: `team_laE6d17ajoVZePdzxrnc4vE0`
Vercel root directory: `sites/share`
Framework: Other (plain HTML); no install or build command.
Production domain: `tan.coffee`; legacy redirect: `share.tan.coffee`.

Deploy only this directory, or deploy the repository with this root directory. Validate the deployment URL before promoting or assigning the production domain. The notebook deployment on `studio.tan.coffee` is separate.

The verified legacy-domain redirect is a Vercel alias redirect (HTTP 307), set with the alias API using `alias: "share.tan.coffee"` and `redirect: "tan.coffee"` on the production deployment. Production auto-assignment can replace alias settings, so reapply and verify this redirect after each deployment. Check both `/` and `/123-karl-roast?from=gift` without following redirects. The host-conditioned 308 rule in `vercel.json` did not activate in the initial deployment; do not rely on that rule alone. No DNS change was necessary for this release.
