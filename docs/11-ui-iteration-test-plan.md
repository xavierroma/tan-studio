# UI iteration verification plan

## Scope

This plan covers the roast preparation, roast history, pantry, coffee, brew,
device, and roast-detail changes introduced in the July 2026 UI pass.

## Automated checks

1. Rust API integration tests create an undated completed roast and verify that
   pantry returns `state=unknown` with no age or suggested dates. The same test
   patches a user date and timezone, verifies provenance, and confirms that rest
   calculations become available.
2. TypeScript compilation verifies that every route supplies the complete typed
   URL state and that generated OpenAPI types are consumed by the UI.
3. Vitest covers components, API transport, navigation, and bridge setup logic.
4. Playwright desktop smoke tests verify:
   - roast search, sort, density, and pantry state survive reload through URL
     parameters;
   - Coffees and Brews use the same table controls and persist state;
   - profile/coffee pickers show human-readable labels;
   - the bridge Wi-Fi picker remains operable;
   - no browser warnings, errors, or unhandled page exceptions occur.
5. Playwright's 390 × 844 viewport verifies that Prepare Roast controls remain
   visible, roast rows use the mobile presentation, and neither screen creates
   horizontal document overflow.
6. The real-Nano opt-in test opens an imported roast, verifies a chart canvas at
   the expanded height, hovers it, and captures before/after screenshots to
   catch disappearing-series regressions.

## Manual acceptance

- Inspect roast #14: its date and rest state must say that a date is required;
  changing **Roasted at** must immediately produce a real rest window.
- The chart must reserve readable vertical space for both temperature and rate
  of rise. Only the lower x-axis is labelled when both panels are present.
- A native first-crack event must appear as a device milestone. If it is absent,
  an expected profile crossing may appear only with the word **Expected**.
- Devices must show one concise status card by default; technical details and
  setup for another bridge are disclosure controls.
- Verify Prepare Roast on an actual phone over LAN before release.
