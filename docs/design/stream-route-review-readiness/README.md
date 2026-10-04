# Stream Route review confirmation readiness (follow-up 60)

The Stream Route fixture now waits for the JSON diff to mount and finite entry
motion to finish before clicking **Confirm & Save**. It still uses a genuine
pointer click, then requires the dialog to close, the exact PUT to arrive and the
saved value to be read back. Application code, animation behavior, payload
handling, timeouts and retries are unchanged.

## Evidence and limits

[CI run 37210907223](https://github.com/jinbagi/apisix-dashboard/actions/runs/37210907223)
reported 908 passed and one flaky Stream Route PUT case. Its first failure had
`writes.length === 0` after the existing 5-second assertion and left the review
dialog open with Confirm & Save focused. The artifact contains an error context
for this attempt, but a trace only for the successful retry. Therefore the exact
first-failure pointer sequence is **not proven** by CI evidence.

Locally, the unchanged production build at
`2246c68b6ceb5778109c1661a0989e6dc7aab1d3` was served by a static server on port
19242. Every Admin API call was mocked; the diagnostic also blocked other
origins. Normal clicks passed in 20 fresh contexts (10 normal, 10 CPU-throttled).
Slowing only the real Ant entry animation also passed 20 ordinary clicks.

A controlled 200 ms held pointer with a 150 ms delay and 1 second duration on
Ant's real modal animation reproduced the missing write. No transform, opacity,
position, click target or handler was injected:

| Event | Before readiness | After readiness |
| --- | --- | --- |
| Pointer down target | Confirm & Save | Confirm & Save |
| Pointer down transform | `matrix(0.2, 0, 0, 0.2, 0, 0)` | `none` |
| Pointer up target | Modal wrapper | Confirm & Save |
| Pointer up transform | `matrix(0.579404, 0, 0, 0.579404, 0, 0)` | `none` |
| Click target | Modal wrapper | Confirm & Save |
| PUT count | 0 | 1 |

The browser correctly does not click a moving button when pointer down and up
land on different targets. This proves a fixture readiness gap under controlled
motion; it is consistent with, but does not conclusively identify, the CI cause.
The new checked-in stress case failed before the fix with the original 5-second
`writes.length` assertion, and passes with the readiness guard.

A transform-none assertion **alone also failed**: it can pass before Ant attaches
the entry animation. The final order is diff visible, the existing
`settledLayout` helper (fonts, two animation frames, finite animation completion),
strict dialog transform `none`, genuine pointer click and dialog hidden. There is
no arbitrary sleep, force click, click retry or increased timeout.

The checked-in JSON contains synthetic pointer targets, geometry and request
payloads. Full original CI artifacts and local diagnostic traces remain ignored.
Local CLI `--trace=on` attempts separately encountered artifact teardown timeouts;
standard no-retry fixtures and a manual context trace were used for this work.
Those teardown timeouts are not evidence of the CI application's failure.

## Verification

All browser checks used the unchanged production build and mocked Admin API at
`E2E_TARGET_URL=http://127.0.0.1:19242/ui/`, one worker and zero retries.

- `pnpm lint`, `pnpm exec tsc -b --pretty false`, `pnpm build`: passed.
- `pnpm exec playwright test e2e/tests/stream_routes.apisix-319.spec.ts --grep 'PUT retains explicit false|held pointer' --repeat-each=10 --workers=1 --retries=0 --reporter=list`: **20/20 passed**. This verifies the final readiness order and existing read-back checks.
- `pnpm exec playwright test e2e/tests/stream_routes.apisix-319.spec.ts e2e/tests/stream_routes.show-disabled-error.spec.ts e2e/tests/form-json-parity.spec.ts e2e/tests/history-coverage.spec.ts --workers=1 --retries=0 --reporter=list`: **52/52 passed** after strengthening the stress case to compare the entire PUT body.
- `pnpm exec playwright test e2e/tests/stream_routes.apisix-319.spec.ts --grep 'held pointer' --repeat-each=10 --workers=1 --retries=0 --reporter=list`: **10/10 passed** with the final complete-body assertion.

The original test still checks both saves: explicit `false`, then removal of
cleared SNIs and TLS passthrough without sending system fields. The stress case
checks the complete request body, the closed review, saved/reloaded feedback and
the read-back switch value. Independent source and before/after evidence review
found no blocker.

## Captures

- [Before: held pointer missed the moving button](before-held-pointer.png)
- [Ready: diff mounted and real entry motion finished](ready-before-click.png)
- [After: one mock PUT followed by successful read-back](saved-after-click.png)
- [Before pointer event log](before-pointer-events.json)
- [After pointer event log and exact synthetic request](after-pointer-events.json)

The screenshots show the unchanged UI at 1920 by 1080. They are evidence of this
mocked confirmation flow, not a live gateway or overall release validation.
