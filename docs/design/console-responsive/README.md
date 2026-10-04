# Console captions and controls at narrow widths

Follow-up 59 fixes a reproduced layout defect in API Console. At 390 CSS pixels, the page had no horizontal scroll, but the Send PUT caption and shortcut extended about 30 pixels beyond each side of their 102.94-pixel button. The Request JSON title needed 111.97 pixels inside a 75.05-pixel title box and overlapped the Format Request JSON action.

The narrow request actions now use one column. The Send button grows and wraps its shortcut when necessary. Request and response card headers wrap their title, status, timing, view switch and actions without clipping captions. Desktop headers remain on one row when space allows. Changes are confined to Console CSS; request execution, keyboard handling, theme colors, payloads and history are unchanged.

## Before and after

The same text-range containment assertions failed before the CSS change and passed afterward. Page width alone was not used as proof: the fixture checks every visible caption inside its own button/title/header bounds and checks that title and action regions do not overlap.

| View | Request actions and title | Error response actions |
| --- | --- | --- |
| Before, light 390 | [Clipped Send and title](before-light-390.png) | — |
| Light 320 | [Actions](light-320-actions.png) | [Status, timing, retry and restore](light-320-error.png) |
| Dark 320 | [Actions](dark-320-actions.png) | [Response](dark-320-error.png) |
| Light 390 | [Actions](light-390-actions.png) | [Response](light-390-error.png) |
| Dark 390 | [Actions](dark-390-actions.png) | [Response](dark-390-error.png) |
| Light 1440 | [Actions](light-1440-actions.png) | [Response](light-1440-error.png) |
| Dark 1440 | [Actions](dark-1440-actions.png) | [Response](dark-1440-error.png) |
| Light native 200% | [Actions](light-native200-actions.png) | [Response](light-native200-error.png) |
| Dark native 200% | [Actions](dark-native200-actions.png) | [Response](dark-native200-error.png) |

Full measured rectangles are in [before-geometry.json](before-geometry.json) and [geometry.json](geometry.json). These screenshots use the branch baseline colors; follow-up 58 handles method color contrast independently.

## Verification

- Full ESLint with zero warnings, `tsc -b --pretty false`, and Vite production build passed. The existing bundle-size advisory remains.
- `console-responsive.spec.ts`, `console-drafts.spec.ts`, and `history-coverage.spec.ts`: **27/27 passed**, no retries, against the production build and synthetic Admin API fixtures.
- Eight layout scenarios cover light/dark at 320, 390 and 1440 CSS pixels, plus actual native 200% Chromium zoom. Tests wait for fonts and finite layout animations before reading text rectangles.
- Each layout case verifies Send/Load captions, the keyboard Enter → PUT review → Cancel focus return, keyboard Format Request JSON, successful GET status/timing, Body/Headers and Copy headers, error status with Restore request/Retry/Clear/Copy body, successful retry and restoring the original path. Four exact fixture GETs are required; unexpected network access or Admin writes fail the case.
- Native zoom uses the existing test-owned temporary Chromium profile and extension: `chrome.tabs.setZoom(2)` preserves the 1440×1080 outer window, changes the content width from 1424 to 712 CSS pixels and doubles DPR from 1 to 2. CSS zoom and visual viewport scale remain 1. CDP captures the complete 1424×985 physical viewport. This is browser zoom, not CSS zoom or a narrow viewport labeled as zoom.
- All credentials and resources are fixture values. No real gateway, operator browser profile, or stored Admin key was used. These checks establish local layout and mocked interaction behavior; service-backed CI remains separate.

Command (with `E2E_TARGET_URL` pointing to the isolated production preview):

```text
pnpm exec playwright test e2e/tests/console-responsive.spec.ts e2e/tests/console-drafts.spec.ts e2e/tests/history-coverage.spec.ts --workers=1 --reporter=line
```

For local native zoom, `E2E_NATIVE_ZOOM_EXECUTABLE` may point to an installed test-owned full Chromium binary as supported by the existing helper. CI configuration and the shared zoom helper were not changed.
