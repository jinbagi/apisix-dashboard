# Readable secondary text (task 46)

Normal helper text now uses the existing secondary color in both themes. Typography's component-local `colorTextDescription` maps to `var(--ant-color-text-secondary)`. Dashboard snapshot details and sidebar group headings use the same token through their two existing CSS rules. Global description, disabled, placeholder, mask, primary and status tokens are unchanged.

The initial problem was visible on three ordinary reading surfaces: Routes page descriptions, RAW resource identity/save status, and dashboard summaries. Ant Design Typography `type="secondary"` uses description opacity .45 rather than the existing secondary opacity .65. The sidebar captions separately used quaternary opacity .25. The fix changes those bounded semantic uses without replacing tertiary or quaternary globally.

## Measured contrast

Computed CSS colors are alpha-composited against actual ancestor backgrounds, including modern `color(srgb ...)` values. The table contains rendered measurements before/after, rather than pixel samples of antialiased text. The normal-text target is [WCAG 2.2 SC 1.4.3's 4.5:1 minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

| Normal text | Light before / after | Dark before / after |
| --- | ---: | ---: |
| PageHeader description | 3.30955 / 6.77469 | 4.52893 / 8.29103 |
| RAW API path | 3.35170 / 6.97760 | 4.39518 / 7.65204 |
| RAW no-pending-changes status | 3.35170 / 6.97760 | 4.52219 / 8.18567 |
| Dashboard Latest 10 / snapshot detail | 3.35170 / 6.97760 | 4.52219 / 8.18567 |
| Sidebar group heading | 1.83349 / 6.96567 | 2.23891 / 8.19277 |

## Verification

- Four production fixtures cover light/dark at 1440px and 390px across Routes, RAW and dashboard; all four fail against the baseline and pass after the fix.
- Assertions use actual rendered contrast >=4.5. They also preserve the global description token, input placeholder color, disabled Save Changes color/state, and drawer mask color.
- All 56 relevant contrast, dashboard, RAW actions, table and saved-view fixtures passed in 58.3 seconds. Full lint, TypeScript and production build passed.
- Fixtures use synthetic GET responses, abort unexpected writes and assert no mutation attempts. No user gateway or authenticated user session was used.
- Screenshots were opened and inspected. This verifies the stated normal-text scope, not full accessibility compliance.

| Surface | Light | Dark |
| --- | --- | --- |
| Routes | [Before](before-light-routes.png) / [After](after-light-routes.png) | [After](after-dark-routes.png) |
| RAW | [After](after-light-raw.png) | [Before](before-dark-raw.png) / [After](after-dark-raw.png) |
| Dashboard | [After](after-light-dashboard.png) | [After](after-dark-dashboard.png) |
| Narrow RAW | [390px](after-light-390-raw.png) | [390px](after-dark-390-raw.png) |

## Separate follow-up 47: active and success colors

These measured issues remain outside task46 and are not implemented here:

- In dark mode, the normal RAW button/active tab uses RGB(85,143,216) against RGB(43,64,89): contrast3.18473. The selected sidebar label is3.58726. These are active controls rather than disabled UI; inspect the relevant component/palette derivation before choosing a narrowly scoped fix.
- In light mode, dashboard success numbers use #52c41a on white: contrast2.26546. The numbers are26px and fail even the large-text3:1 target. Use a text-appropriate success color rather than changing the entire success palette.
- Placeholder text was measured separately from disabled controls. It retains the existing .25 opacity (approximately1.834 light /2.240 dark on the input surfaces), and requires a separate decision: WCAG does not exempt placeholders as inactive UI.
- Monaco syntax colors were outside this investigation. No editor-wide contrast claim is made.

The final screenshots retain the original active/status colors, providing a reproducible visual reference for follow-up47. Central backlog status is maintained separately by the coordinating thread.