# Approved notebook redesign

Status: ready-for-human

Implement the approved v7 mockup from ../tan-studio-mockup against the existing typed backend. Warm #f8f6f0 paper, #28251e text, #706b61 secondary text, #ded9cf rules, #a64b29 links; Georgia headings and system sans data; rectangular controls and open sections. Actual Tan logo, no fixture photos/data in production. Top navigation, coffee rail on record pages, breadcrumbs and reciprocal relationships. Coffee history immediately exposes roasts, notes and brew tasting. Preserve existing forms, saved table URL/preferences, complete chart/native channels, import/sync, attachments, single-operator auth and revision checks. Real notes/descriptions remain; generic helper copy goes.

Labels: approved Estate first and Broadside comparison, B21 Pro 300dpi, red/black on50×80white, complete single surface and50×30black front/details fallback; outlined SVG, color PNG and exact-size PDF; generated≠printed. No hardware/firmware changes. Gift page association is an explicit nullable HTTPS URL, never overloaded native metadata; no Studio authoring/publishing. DNS and share hosting require separate authorization.

Implementation and regression gates: bun run check; relevant browser journeys on a disposable fixture notebook, desktop/mobile and minimum320px; preserve backend records and native evidence. Commit/push/deploy authorized directly by Xavier. Retain0a9816b disk-backed staging/cleanup. Re-fetch main and coordinate release ownership before activation.

Implemented with official shadcn Base Nova primitives. Full check passes with CARGO_PROFILE_RELEASE_STRIP=none on this macOS host (LLVM203678). Browser QA uses a disposable SQLite notebook and simulated Nano; no fixture data or photos are shipped.
