# Tan public site

Independent static HTML at https://tan.coffee, hosted in the `tan-studio-share` Vercel project in team `xroma`. The homepage contains the approved Tan Studio artwork and two brewing recipes. The fictional gift example lives at `/123-karl-roast` and is excluded from search indexing. `share.tan.coffee` redirects to `tan.coffee`, retaining the requested path and query.

This directory has no notebook imports, credentials, runtime requests, client scripts, or Studio publishing controls. Individually authored gift pages may be added as static directories containing an `index.html`. Only publish content deliberately chosen for public sharing. Store the resulting HTTPS URL on a roast through its existing gift-page link field.

## Build

From the repository root run `bun script/build_public_site.tsx`. Commit the generated `index.html` alongside its source. The build renders the existing shared shadcn Card and Separator components to HTML; the public host needs no Node runtime or install step. Edit recipe values and steps in `recipes.json`, then rebuild. `landing.css` supplies the approved paper-and-ink theme and A5 print layout. The grind scale is a static diagram, not an interactive control.

Special Elite is self-hosted with its license in `assets/fonts`. Stamp illustrations are generated artwork; the Tan logo is the existing brand asset.

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
