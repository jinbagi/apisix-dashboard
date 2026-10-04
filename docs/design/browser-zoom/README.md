# Native browser zoom: acceptance follow-up 54

The approved accessibility work included zoom verification, but earlier narrow-viewport checks did not establish real browser zoom. This follow-up adds reproducible native **200%** Chromium checks without changing application code.

## What is measured

A new test-owned persistent Chromium profile loads a minimal local Manifest V3 extension. The extension worker calls `chrome.tabs.setZoom(tabId, 2)` and reads `chrome.tabs.getZoom(tabId)`. The browser window stays fixed; the test does not apply CSS zoom, a device scale factor, mobile emulation or pinch zoom. The Desktop Chrome project's inherited scale/mobile settings are explicitly cleared for the native window.

Observed Windows headless Chromium 143.0.7499.4 / Playwright build 1200 measurements:

| Reading | 100% | 200% |
| --- | --- | --- |
| tabs.getZoom | 1 | 2 |
| outerWidth / outerHeight | 1440 / 1080 | 1440 / 1080 |
| innerWidth / innerHeight | 1424 / 985 | 712 / 492 |
| devicePixelRatio | 1 | 2 |
| visualViewport.scale | 1 | 1 |
| root CSS zoom | 1 | 1 |

The isolated prototype also retains a 100 CSS-pixel element's bounding width at 100: [prototype measurements](prototype-result.json). Measurements are taken afresh on each operating system; the test checks the relationships rather than hard-coding Windows chrome dimensions.

## Rendering and interaction evidence

Playwright's default screenshot path applies a CSS-sized clip that truncates a natively zoomed surface in this environment. Evidence uses `Page.captureScreenshot` with **no clip**, `fromSurface: true`, and `captureBeyondViewport: false`. PNG IHDR width/height must match `innerWidth/innerHeight × devicePixelRatio` within two pixels for fractional-height rounding. The final images are **1424×985 physical pixels**, not the incorrect 712×492 clip. Screenshot dimensions, DOM overflow and action bounding boxes are checked together.

Both themes verify:

- Routes header/table reflow without document horizontal overflow; the row's RAW action remains fully reachable, and Enter opens the intended editor.
- A RAW draft enables Save Changes; the complete button remains in view and Tab moves focus without submitting it.
- Add Route retains explicit-ID and URI input, keyboard movement and the visible enabled Add action.
- Import's pointer-driven Compare JSON action reaches the actual intended button, verified by its captured pointer target. A 64-character Route ID and 60 changed labels exercise the shared comparison dialog.
- Both review actions stay fully visible. Ctrl+End reaches the final changed JSON field. Keyboard cancellation returns focus to the invoking Compare JSON button without writes.

All Admin API reads use synthetic intercepted fixtures. Every attempted non-GET Admin request and off-origin request is aborted and makes the test fail. No user profile, key, gateway configuration or live traffic is used. Each temporary browser/profile/extension is closed and removed with an explicit test-directory path guard.

## Build and run provenance

1. Read-only integrated build **1f6e0419a2c1ccdd49fc95306dd4b0f151dae286**: the committed test's initial light/dark cases passed **2/2** in 21.3 seconds. Its measurements are retained separately as [integrated light](integrated-light-native-zoom.json) and [integrated dark](integrated-dark-native-zoom.json). This run preceded the additional table-row capture.
2. Focused PR base **135dabe2addb8983571a7248988c93a5c86a7743**, with only test/document changes: final production build, full ESLint and TypeScript passed. `dist/index.html` SHA-256: `028d4d9be74ecce14beb4bcbdfc989aeede096dc553d8a9591d5bcb4446d9e0d`. The final two theme cases were repeated three times: **6/6 passed** in 1.2 minutes. The screenshots below and [light](light-native-zoom.json)/[dark](dark-native-zoom.json) measurements come from the final repeat of this focused build.

The local target was a separate static-only localhost port with no gateway proxy. The local browser installer stalled while extracting the full browser; the same official Playwright archive was extracted into an ignored fixture directory, and only the test-only executable override pointed there. This machine-specific path is not in the test source. The isolated prototype first confirmed that the installed headless-shell browser was insufficient for extension loading.

One exploratory comparison attempt sent Ctrl+End before the modal finished opening. The final test follows the existing comparison fixture's transition/font readiness checks; the complete repeated run passed. No product behavior was changed to make the checks pass.

This is mocked frontend/interaction evidence. It does not assert service-backed CRUD, every browser/OS combination, every zoom level or a completed global accessibility audit. CI still runs the submitted test through the normal PR checks.

## Final full-surface screenshots

| Flow | Light | Dark |
| --- | --- | --- |
| Routes header | [Light](light-200-routes.png) | [Dark](dark-200-routes.png) |
| Table row and RAW | [Light](light-200-table-row.png) | [Dark](dark-200-table-row.png) |
| RAW draft and actions | [Light](light-200-raw.png) | [Dark](dark-200-raw.png) |
| Add action and keyboard focus | [Light](light-200-add.png) | [Dark](dark-200-add.png) |
| Full JSON tail and review actions | [Light](light-200-review.png) | [Dark](dark-200-review.png) |

## Reproduction

Use Playwright's full bundled Chromium; the existing CI step `pnpm exec playwright install --with-deps` already installs it. A headless-shell-only local setup can install it with `pnpm exec playwright install --no-shell chromium`.

Set `E2E_TARGET_URL` to the dashboard build under test, then run:

```text
pnpm exec playwright test e2e/tests/native-browser-zoom.spec.ts --workers=1
```

Optional test-only environment variables are `E2E_NATIVE_ZOOM_EXECUTABLE` for an explicitly installed Playwright-compatible Chromium binary and `E2E_BUILD_REF` for artifact provenance. Neither changes the application. Missing Chromium fails the test; the native-zoom checks are not silently skipped.

API references: [Chrome tabs.setZoom / getZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom) and [Playwright Chromium extension testing](https://playwright.dev/docs/chrome-extensions).
