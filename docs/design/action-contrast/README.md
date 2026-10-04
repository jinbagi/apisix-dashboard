# Readable action and success text (task 47)

RAW actions, selected RAW tabs/sidebar entries, enabled primary buttons and dashboard success numbers now use colors chosen for their actual text surfaces. The global Ant Design primary and success seeds are unchanged. Dedicated action foreground values are separate from solid button backgrounds, so solid buttons retain white labels through hover and pressed states. This also fixes the light theme's pale RAW and primary-button hover states.

The changes are limited to five existing CSS files. Typography/helper colors from task 46, placeholders, disabled controls, danger colors, status icons and Monaco syntax are outside this change. The disabled RAW selector retains its original primary color; only enabled RAW controls receive the new foreground.

## Measurements and scope

The target is [WCAG 2.2 SC 1.4.3 normal-text contrast of at least 4.5:1](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The dashboard metrics also use that conservative target because they shrink from 26px to 20px on narrow screens. The tests use unrounded ratios; values below are rounded only for display.

| Surface | Light minimum | Dark minimum |
| --- | ---: | ---: |
| RAW action and selected RAW tab | 4.78789 | 4.71700 |
| Selected sidebar item | 4.85062 | 5.31320 |
| Enabled solid primary / actual Save Changes | 5.16856 | 4.95234 |
| Filled primary | 4.78789 | 4.71700 |
| Outlined, dashed and link primary | 5.16856 | 8.19471 |
| Text primary | 5.16856 | 4.71700 |
| Neutral outlined / actual Review changes | 7.68523 | 8.19471 |
| Success metrics at 1440px and 390px | 5.58539 | 6.18227 |

Each action minimum includes default, pointer hover, pressed `:active` and keyboard `:focus-visible` states. [Raw measurements](measurements.json) include text, computed foreground, alpha-composited ancestor background, font size/weight and focus state. The helper rejects gradients and opacity-masked ancestors rather than claiming an inaccurate ratio. Fixtures disable transitions only to measure their completed state; no test colors are injected.

Before this fix, dark RAW/tab text was 3.18473 and selected sidebar text 3.58726; light dashboard success text was 2.26546. Separate read-only fixture measurements also found enabled Save Changes at 3.3297 in dark default, 2.2481 in dark hover and 3.3276 in light hover. A black label alone would fail the original dark active background, so the foreground and solid fill have separate semantic values.

## Verification

- `pnpm lint`, `pnpm exec tsc -b --pretty false` and `pnpm build` pass. The build retains the existing large-chunk warning.
- 62 combined action/secondary contrast, RAW actions/tabs and table experience fixtures pass. After the disabled RAW selector was tightened, the rebuilt production bundle passes all 10 action/secondary contrast fixtures again.
- Real RAW Save Changes, Review changes, table RAW, selected tab and sidebar controls are sampled. Additional native button fixtures clone the installed Ant Design classes to exercise solid/filled/outlined/dashed/text/link variants without adding product UI.
- Disabled Save Changes and disabled RAW colors, danger default styling, global primary/success seeds, global description/placeholder values and the drawer mask are asserted unchanged.
- All requests use synthetic fixture resources. Contrast tests abort and reject any Admin API write attempts. No gateway credentials, user data or authenticated user browser session are used.
- This demonstrates the stated surfaces and states, not a full accessibility audit. Placeholder and syntax-palette reviews remain separate work.

## Screenshots

| Surface | Light | Dark |
| --- | --- | --- |
| Routes 1440px | [View](light-1440-routes.png) | [View](dark-1440-routes.png) |
| RAW 1440px | [View](light-1440-raw.png) | [View](dark-1440-raw.png) |
| RAW 390px | [View](light-390-raw.png) | [View](dark-390-raw.png) |
| Dashboard 390px | [View](light-390-dashboard.png) | [View](dark-390-dashboard.png) |
| Button variant fixture | [View](light-button-variants.png) | [View](dark-button-variants.png) |

Solid and filled fixture button crops are saved for each theme in `*-contrast-{solid,filled}-{default,hover,active,focus}.png`. They show actual browser pointer/focus states, not an illustrated palette.

## Integration status

Prepared as a focused local task 47 change on task 46 base `5afbc4a4094cfd1dcc5a99dc4e83531fe9dd7857`. Publication waits for task 46's canonical master merge and coordinator approval. The central backlog is deliberately untouched; this document records task 47's local evidence.
