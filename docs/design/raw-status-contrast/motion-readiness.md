# Native contrast measurement readiness (follow-up 57)

[CI run 37207254524](https://github.com/jinbagi/apisix-dashboard/actions/runs/37207254524) passed overall but retried the native 200% dark case: `textContrast` rejected a surface that was still masked. The contrast threshold did not fail. The original attempt did not include a trace attachment; the log alone does not identify the offending ancestor.

The installed Ant Drawer motion fades its panel from opacity 0.7 to 1 while translating it. Being fully in the viewport does not prove that its last opacity frame is complete. The native test measured status contrast immediately after the viewport assertion, whereas its later screenshot path already awaited completed motion.

## Local reproduction

An isolated dark/native 200% fixture used the same production code and original assertion order, changing only the real Drawer transition duration to 5 seconds to widen the race. No opacity or color was injected. Once Save Changes was fully in the viewport, `.ant-drawer-content-wrapper` still had opacity **0.998568** and running finite transitions (one observation 4540.497/5000 ms). The unchanged strict contrast helper threw the same solid/unmasked-surface error. After the existing `settledLayout` helper completed, every ancestor passed the original opacity/background-image guard and the dark text measured **7.274643:1**.

[Recorded reproduction](motion-reproduction.json) preserves the before state, original error and after measurement. Its complete local Playwright trace is retained outside version control at `.local-raw-motion.local/reproduction-trace.zip`. All Admin API reads were mocked; no gateway write or off-origin request occurred.

## Test correction

Only the native browser test changes. After confirming the edited Save action is enabled, it records the panel's current opacity and calls the existing readiness helper, which waits for fonts, rendering frames and finite animations to finish. It then checks the unchanged full-viewport requirement, exact opacity 1 and the unchanged `textContrast` guard/4.5 minimum. It records the observed before/after values; the before value is not required to be below 1 because a fast/slow platform may have completed the transition already.

A third native case stretches the real dark Drawer transition to 5 seconds and retains the entire Routes/RAW/Add/review flow. This controls a transition under test, not a fixed sleep. Persistent masks, gradients, insufficient contrast or missing actions still fail. The original two theme cases and all six RAW status scenarios remain.

An initial stress run reached the existing 5-second viewport assertion before the 5-second transition ended (viewport ratios 0.9866/0.9985); 25 cases passed and two slow cases failed. Moving that same geometry assertion after transition completion fixes the ordering without increasing its timeout or weakening its ratio. No application CSS, opacity rule, color, payload or history logic changes in this follow-up.

## Final verification

Full lint and production build (TypeScript included) passed. The final readiness order passed **27/27** affected cases in **3.1 minutes**, with three repeats per scenario and **retries disabled**:

```text
pnpm exec playwright test e2e/tests/native-browser-zoom.spec.ts e2e/tests/raw-status-contrast.spec.ts --workers=1 --repeat-each=3 --retries=0 --reporter=list
```

The nine native runs cover light, dark and slow dark; the eighteen status runs cover both themes at 1440px, 390px and native 200%, including held saving. [Native measurements](motion-final-measurements.json) retain all observed before/after opacity values and unchanged contrast ratios; every after value is exactly 1. The [final slow-Drawer capture](motion-slow-drawer-final.png) shows the complete physical surface after motion. The runtime/test baseline is PR122 head 97f12142, with only this readiness test correction applied. No other feature branch or gateway was used.
