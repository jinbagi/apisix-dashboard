# RAW save-status contrast: follow-up 55

The native-zoom review exposed a normal-text contrast gap in the RAW footer: `Unsaved changes. Ctrl+S saves changed fields.` used the light warning accent on white. At 14px/400 it measured **1.900052:1** at both 100% and actual 200% browser zoom. Dark measured **7.274644:1** and already passed. The text is live status information, not a disabled control.

The runtime correction is four lines in `AdminApiJsonEditor.module.css`: only the light-theme `.saveStatus.ant-typography-warning` uses a darker amber, `#874d00`. Dark warning text, clean/saved secondary text, disabled/danger controls, global palette/seed tokens, font, wording and `aria-live=polite` are unchanged. Saving continues to use the same dirty status class until the accepted write is verified. No request or history behavior changes.

`warningText` is the same `#faad14` as `warning` in the installed light theme, so swapping token names would not fix the gap. Another candidate, `#ad6800`, is only 4.414572:1 on white and fails the unrounded 4.5:1 threshold. The chosen amber is 6.792313:1 on the actual white surface. See [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Scope and evidence

- Before: unchanged production build `135dabe2addb8983571a7248988c93a5c86a7743`; [measurements](before-measurements.json), [light at 200%](before-light-200-raw.png), [dark at 200%](before-dark-200-raw.png). The new light/1440 regression failed on the actual 1.900052 ratio before the CSS change.
- Initial local integration baseline: `fcea604686f67ad4f797cd257cd0f1c34001e2b0` combines master `9aa9229a` and native-zoom PR120 `967d830f`. The follow-up's own change stays separate from that baseline.
- Final validation base: canonical master `a96daa93c8fa5d5b3eb21269a7008af16d1bdb54`, after native-zoom PR120 merged. The single follow-up feature was rebased without runtime/test changes and built at `f88940c04dd4aab83046cad53541e0eaa3b884b4`; only this evidence was updated afterward. Final production `dist/index.html` SHA-256: `b755aa725fb31b355317fbad2e5c4f483d5dc3bbbbd9a34749a60b23f562845d`.
- `raw-status-contrast.spec.ts` covers light/dark at 1440px, 390px and native 200%: clean → dirty → held saving → verified saved. It checks all four text contrasts, exact preserved colors/palette, live-region semantics, no horizontal overflow, and a single exact PATCH containing only the changed `desc` field.
- Saving is triggered through the editor's Ctrl/Command+S. A fully intercepted PATCH is held for the visible-state measurements and released before the exact-identity read-back. No request reaches a gateway; unexpected writes and off-origin requests fail the fixture.
- The existing native-zoom test also asserts the dirty footer text's contrast, preserving its table/Add/comparison keyboard and pointer checks. The shared helper proves actual tab zoom and captures complete physical surfaces through CDP.

An early fixture run omitted APISIX's read-only `create_time`/`update_time` fields, so schema validation prevented the mock save. The fixture was corrected to the actual response shape; application validation was not weakened.

This is a focused status-text fix and mocked UI evidence, not a claim that every warning-colored element in the application has been audited. Central backlog state is maintained separately.
## Final validation

Full `pnpm lint` and `pnpm build` (including TypeScript) passed. The existing large-chunk advisory remains. The initial integration passed **22/22** in **2.1 minutes**. After the canonical-master rebase, full lint/build passed again and the final production build passed the same **22/22** targeted fixtures in **2.3 minutes**:

```text
pnpm exec playwright test e2e/tests/raw-status-contrast.spec.ts e2e/tests/native-browser-zoom.spec.ts e2e/tests/secondary-text-contrast.spec.ts e2e/tests/action-contrast.spec.ts e2e/tests/raw-actions.spec.ts --workers=1 --reporter=list
```

The test target was a separate static-only localhost preview. Native zoom used the same test-only full-Chromium override documented in follow-up54; normal CI uses the bundled full Chromium. Existing action fixtures also confirmed actual danger buttons, disabled buttons, protected palette and pointer/keyboard action states retain their colors.

| Theme | Clean / saved | Dirty / held saving | Views verified |
| --- | --- | --- | --- |
| Light | 6.977601:1 | 6.792313:1 | 1440px, 390px, native200% |
| Dark | 8.185671:1 | 7.274644:1 | 1440px, 390px, native200% |

All six scenarios recorded exactly `{ "desc": "Prepared contrast change" }` as the intercepted PATCH. The fixture serves the updated resource at its exact URL for normal read-back, and the test waits for Saved at. No unexpected requests occurred.

| View | Measurements | Dirty capture | Held saving capture |
| --- | --- | --- | --- |
| Light1440 | [JSON](light-1440-measurements.json) | [PNG](light-1440-dirty.png) | [PNG](light-1440-saving.png) |
| Light390 | [JSON](light-390-measurements.json) | [PNG](light-390-dirty.png) | [PNG](light-390-saving.png) |
| Light native200% | [JSON](light-native200-measurements.json) | [PNG](light-native200-dirty.png) | [PNG](light-native200-saving.png) |
| Dark1440 | [JSON](dark-1440-measurements.json) | [PNG](dark-1440-dirty.png) | [PNG](dark-1440-saving.png) |
| Dark390 | [JSON](dark-390-measurements.json) | [PNG](dark-390-dirty.png) | [PNG](dark-390-saving.png) |
| Dark native200% | [JSON](dark-native200-measurements.json) | [PNG](dark-native200-dirty.png) | [PNG](dark-native200-saving.png) |

The light390 dirty, light native200 saving, dark native200 dirty and light1440 saving captures were directly visually inspected. The footer wording is readable and the actions remain visible; native zoom reduces the editor's CSS height while retaining its scroll area. These captures are unedited full surfaces.
Independent read-only review found no blocker in the scoped CSS, both specs, the state measurements and the selected narrow/native screenshots; the reviewer also confirmed the runtime/test diff stayed identical after rebase. Final measurement files and captures above were refreshed from the canonical-master run.
