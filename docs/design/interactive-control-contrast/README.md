# Interactive control contrast: combined tasks 47 and 48

Enabled action labels and empty-field hints now remain readable in light and dark themes. Action foregrounds are separate from solid button fills, preserving white solid-button labels through default, hover, pressed and keyboard focus states. Enabled Input, TextArea, Search and Select placeholders use a dedicated 60% foreground, distinct from entered values and labels. Dashboard success numbers use a text-specific green at both desktop and narrow sizes.

Only five product CSS files change. Global Ant Design seeds, normal Typography tokens, disabled controls, danger styling, drawer masks, entered input values and all API behavior are preserved. The earlier task 46 description/sidebar-caption improvements remain intact. No runtime fix for the separately discovered SSL hostname Tab issue 50 is included.

## Integration and evidence boundaries

The combined change starts from canonical master `cd2e9a3c5a5c4328a71ad0dc8fc3a7e4661895f7`, after task 46 merged. It combines the 47 feature commit and 48 feature/documentation commits; the only CSS conflict was the dark semantic variable block, where both sets were retained. All three contrast suites use the same alpha-compositing/luminance helper. Placeholder measurements retain their finite animation wait and use the `::placeholder` foreground.

The [task 47 standalone report](../action-contrast/README.md) and [task 48 standalone report](../placeholder-contrast/README.md) retain their original baseline and before/after evidence. Screenshots and [action measurements](action-measurements.json) in this directory are newly captured from the combined production bundle. The central backlog is unchanged.

## Combined verification

- Full `pnpm lint` and `pnpm build` pass; the build includes `tsc -b` and retains the existing large-chunk advisory.
- **99/99 fixtures pass** on the combined production bundle in 2.1 minutes, including all 14 contrast fixtures and related RAW, form controls/draft navigation, saved views, global keyboard navigation and shared resource tables.
- The 128 actual action state measurements and 8 dashboard metric samples all meet 4.5:1. The lowest recorded ratio is 4.717000499262874. The 32 keyboard-focus action samples assert `:focus-visible`, and all 32 pressed samples assert native `:active` before measurement.
- Enabled Input, TextArea, Search and Select placeholders meet 4.5:1; focused Routes Search is measured again. The tests compare them with unchanged labels and entered values, then exercise actual SNI/SNIs disabled transitions and verify the original disabled foreground/background.
- The action fixtures verify disabled Save Changes/RAW, danger styling and global primary/success seeds. The existing secondary-text suite continues checking global description tokens, disabled Save and drawer masks; its enabled-placeholder expectation intentionally reflects 48.
- Contrast requests are synthetic GET fixtures and reject unexpected writes. Related CRUD/navigation fixtures also use mocked endpoints. The preview proxy targets a closed loopback port so no populated gateway can be reached accidentally. No user credentials or authenticated session are used.
- Independent source and final screenshot review found no blocker in the enabled-only selectors, preserved exclusions, helper extraction or interaction-state assertions. This is scoped frontend verification, not a full accessibility compliance claim or service-backed release result.

```powershell
pnpm lint
pnpm build
$env:VITE_APISIX_API_TARGET='http://127.0.0.1:1'
pnpm preview --host 127.0.0.1 --port 19182 --strictPort
# In another terminal:
$env:E2E_TARGET_URL='http://127.0.0.1:19182/ui/'
pnpm exec playwright test e2e/tests/action-contrast.spec.ts e2e/tests/placeholder-contrast.spec.ts e2e/tests/secondary-text-contrast.spec.ts e2e/tests/raw-actions.spec.ts e2e/tests/raw-tabs.spec.ts e2e/tests/schema-form-controls.spec.ts e2e/tests/saved-view-concurrency.spec.ts e2e/tests/global-navigation.spec.ts e2e/tests/editor-navigation-drafts.spec.ts e2e/tests/table-experience.spec.ts --workers=2 --reporter=list
```

## Final combined screenshots

| Surface | Light | Dark |
| --- | --- | --- |
| Routes: action, selected sidebar and search hints | [1440px](light-1440-routes.png) | [1440px](dark-1440-routes.png) |
| RAW: selected tab and enabled Save | [390px](light-390-raw.png) | [390px](dark-390-raw.png) |
| Dashboard success numbers | [390px](light-390-dashboard.png) | [390px](dark-390-dashboard.png) |
| Sharing: enabled TextArea/Search hints | [390px](light-390-textarea.png) | [390px](dark-390-textarea.png) |
| SSL: disabled SNI beside entered SNIs | [390px](light-390-disabled-input.png) | [390px](dark-390-disabled-input.png) |

SSL screenshots deliberately preserve the known issue 50 draft-validation state; see its reproduction and acceptance notes in the standalone 48 report. That independent form issue is not hidden or repaired by changing placeholder colors.
