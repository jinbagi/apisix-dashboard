# Readable enabled placeholders (follow-up 48)

## Evidence and scope

Baseline: `5afbc4a4094cfd1dcc5a99dc4e83531fe9dd7857` (secondary text contrast, item 46).
This follow-up is recorded here while the shared recursive backlog snapshot is frozen.

At 1440px and 390px, fixture-only Chromium measurements found that enabled Input (SSL SNI), TextArea (sharing copy custom field names), Search (Routes), and Select (saved views) all use the same 25% foreground opacity as disabled controls. Actual text/background ratios are 1.83399:1 in light mode and 2.24025:1 in dark mode. All four new theme/viewport regression tests fail against this baseline on their first enabled placeholder assertion.

[WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) includes placeholder text in the 4.5:1 requirement for normal text; disabled controls are exempt. Measurements composite the actual computed foreground and ancestor backgrounds, use linearized sRGB luminance, and wait for finite CSS transitions to finish. They reject opacity masks and image backgrounds instead of claiming measurements through those effects.

## Change

A dedicated `--app-color-text-placeholder` uses black at 60% in light mode and white at 60% in dark mode. It applies only to enabled `.ant-input::placeholder` (including Input.TextArea and Input.Search) and the placeholder element of enabled Ant Design Selects. Entered values, labels, disabled controls, global Ant Design tokens, masks, primary/action colors, and all payload behavior retain their existing styles and behavior.

Keeping this override separate from Ant Design's component `colorTextPlaceholder` token avoids recoloring disabled placeholders and the Select's temporary selected-content style while its popup is open. Read-only but enabled fields retain readable hints. Placeholder text remains an example or input hint, not a substitute for the control's accessible name or visible label.

| Measured role | Light ratio | Dark ratio |
| --- | ---: | ---: |
| Baseline enabled placeholder | 1.83399 | 2.24025 |
| Updated enabled placeholder | 5.74184 | 7.13040 |
| Routes Search label (unchanged) | 6.97760 | 8.18567 |
| Entered input value (unchanged) | 16.55845 | 13.40213 |
| Disabled SNI/SNIs placeholder (unchanged; actual disabled background) | 1.82430 | 2.26935 |

The updated hint remains less prominent than the label and entered value. The preceding item 46 test's enabled-placeholder color expectation is updated for this deliberate change; its global description token, disabled Save button, and drawer mask assertions are retained.

## Acceptance and verification

- Light and dark themes, each at 1440px and 390px: actual enabled Input, TextArea, Search, and Select placeholders meet at least 4.5:1.
- Routes Search retains its visible label and accessible name. SNI/SNIs and the sharing TextArea retain their visible labels and accessible names; the saved view Select retains its accessible name.
- Search, SNI, SNIs, and TextArea accept keyboard input and focus. Values remain more prominent than hints.
- Filling SNI disables empty SNIs; clearing it restores the readable enabled placeholder. Creating an SNIs tag disables the empty SNI field. Both disabled placeholders keep their original color and background treatment.
- All Admin API requests use synthetic fixtures; unexpected writes are blocked and asserted absent. No local session credentials or populated gateway data are used.
- Screenshot review checks both widths and themes. This is focused frontend evidence, not a service-backed release result.

Validation:

- Full repository ESLint with zero warnings: passed.
- `tsc -b --pretty false` and production Vite build: passed (the existing large-chunk advisory remains).
- `placeholder-contrast.spec.ts` + `secondary-text-contrast.spec.ts`: **8/8 passed** on the final production build, 27.8 seconds. Baseline run: **4/4 failed** on actual insufficient placeholder contrast.
- After the final test-only assertions were strengthened, targeted ESLint and TypeScript also passed; no further runtime edits were made.

## Screenshots

| Theme / viewport | Before | After |
| --- | --- | --- |
| Light / 1440px | [Routes](before-light-1440-routes.png) | [Routes](after-light-1440-routes.png) |
| Light / 390px | [Routes](before-light-390-routes.png) | [Routes](after-light-390-routes.png) |
| Dark / 1440px | [Routes](before-dark-1440-routes.png) | [Routes](after-dark-1440-routes.png) |
| Dark / 390px | [Routes](before-dark-390-routes.png) | [Routes](after-dark-390-routes.png) |

Additional 390px states: [light TextArea](after-light-390-textarea.png), [dark TextArea](after-dark-390-textarea.png), [light disabled SNI](after-light-390-disabled-input.png), [dark disabled SNI](after-dark-390-disabled-input.png).

