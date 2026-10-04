# Console method contrast (follow-up 58)

The Console reused one accent for method text, custom-color badges and the Send button background. This made normal-size text hard to read: the light PUT label/Send text measured 1.90:1 and its translucent shortcut 1.58:1. Custom-color tags generated pale backgrounds in both themes, so their dark-theme text also failed.

## Measured baseline

The baseline is canonical master `af26a5e575efeafd40c67b3a60e26c6f2bb209d3` with production index SHA256 `cb0387464e9bf6768da87a6f1a54039af9761b409b9dc5d877379d290b94e257`. All five methods were measured in both themes with synthetic data, a static preview and blocked Admin writes/off-origin requests. [Before measurements](before.json), [light](light-before.png) and [dark](dark-before.png) captures preserve the evidence. History was sampled only after the Drawer finished its actual motion. Shortcut measurements composite its observed 0.72 opacity over the observed button background; final regression checks retain the shared strict opaque-surface helper.

| Method | Light selected label / Send | Summary/history badge, both themes | Send shortcut, both themes |
| --- | ---: | ---: | ---: |
| GET | 2.21 | 2.09 | 1.75 |
| PUT | 1.90 | 1.77 | 1.58 |
| PATCH | 2.27 | 2.13 | 1.80 |
| POST | 4.10 | 3.56 | 2.84 |
| DELETE | 3.27 | 2.74 | 2.32 |

Dark selected labels already met 4.5 except POST (4.49); the Send values matched light. The new strict test failed on the unchanged light GET label (2.21) and dark GET badge (2.09) before the fix.

## Scoped correction

Only `raw_api/index.tsx` presentation bindings and its CSS module change. GET remains teal, PUT amber, PATCH green, POST blue and DELETE red, with a method name present on every surface. Selected labels and badges use a darker foreground in light mode and lighter foreground in dark mode. Badges use a local tint of the actual container background. Solid Send actions use dark method colors with white labels; their hover and pressed states darken that local background. The enabled shortcut is opaque and uses the same readable foreground.

The existing accent fallback remains on disabled/loading Send actions, and disabled selectors retain their prior accent. Global palette, response status tags, API-key handling, request serialization, confirmations, shortcuts and session/history behavior are unchanged. The separate preset-keyboard fix from PR123 is now included through a normal master merge; it is unchanged by the color correction.

## Verification and evidence

The new regression uses the existing `textContrast`, finite-animation readiness and real Chromium zoom helpers; it does not weaken the 4.5 threshold, inject foreground colors or treat a narrow viewport as browser zoom. All new requests are mocked; unexpected writes or off-origin requests abort and fail the fixture. Held-loading coverage permits exactly one synthetic GET and verifies that a repeated send shortcut adds none.


Full `pnpm lint` and `pnpm build` (TypeScript included) passed. On the resulting production bundle, **41/41** related scenarios passed with retries disabled in **2.5 minutes**:

```text
pnpm exec playwright test e2e/tests/console-method-contrast.spec.ts e2e/tests/console-drafts.spec.ts e2e/tests/console-collections.spec.ts e2e/tests/action-contrast.spec.ts e2e/tests/secondary-text-contrast.spec.ts e2e/tests/placeholder-contrast.spec.ts --workers=1 --retries=0 --reporter=list
```

The new eight scenarios verify five method colors in both themes; selected controls, history rows and Send actions across actual default/hover/active/keyboard-focus states; shortcut text; 390px layouts and actual native 200% Chromium zoom; unchanged disabled PUT and held-loading GET colors; duplicate-shortcut suppression while loading; PUT review/cancel with focus return; DELETE confirmation/cancel; and no page overflow or unexpected writes. Existing Console draft, preset/variable, primary action, secondary text and placeholder regressions also passed. The new narrow/native tests cancel the write reviews; they do not claim live gateway writes.

All **212 recorded enabled foreground/background color pairs** meet 4.5:1; the minimum is **4.853347:1**. [Light measurements](light-measurements.json) and [dark measurements](dark-measurements.json) include every method/state. [Light native zoom](light-native200-measurements.json) and [dark native zoom](dark-native200-measurements.json) preserve `getZoom=2`, unchanged outer window size, halved inner width, doubled DPR and unchanged CSS/visual zoom scales, plus full physical PNG dimensions. Build index SHA256: `64e3ce4b6f574a662c2b5b76b42d7284b783546c593bcfb9ec1871b730ed00f7` (master af26a5e5 plus this scoped change).

| Surface | Light | Dark |
| --- | --- | --- |
| Desktop request | [Capture](light-desktop.png) | [Capture](dark-desktop.png) |
| Method history badges | [Capture](light-history.png) | [Capture](dark-history.png) |
| 390px colors/action bounds (child fit pending 59) | [Capture](light-390.png) | [Capture](dark-390.png) |
| Actual native 200% | [Physical surface](light-native200.png) | [Physical surface](dark-native200.png) |
| Existing held-loading appearance | [Capture](light-held-loading.png) | [Capture](dark-held-loading.png) |

These measurements cover Console method colors. Other pre-existing warning/advisory/status colors are not relabeled as verified by this focused change.


## Separate responsive finding (follow-up 59)

The 390px screenshots expose an existing layout problem that page-level overflow and action-box visibility do not detect: Send label/shortcut glyphs extend outside their button and the Request JSON title is clipped next to Format Request JSON. The computed color-pair assertions are not proof that every glyph remains over its intended background. The 390px evidence therefore confirms computed colors, visible action boxes and keyboard review/cancel behavior; it does **not** claim that child text fits or that the complete narrow layout is fixed.

[Measured child geometry](narrow-clipping.json) records a 390px document with no page overflow, a 102.938px Send button and text extending about 30px beyond each horizontal edge. The existing two-column narrow action grid and `min-width: 0` allow this compression. The workspace title receives only 75.047px for 111.969px of text beside a 164.953px extra action. Its header lacks the existing request-card stacking rule. Follow-up 59 owns the responsive CSS and child-text containment/overlap regressions; this color-only change leaves those rules untouched.


## Master integration verification

The first PR124 CI run on the original `064033eb` head reported 909 passed and
one failed old preset Ctrl+Enter case (three attempts). That branch preceded the
already-merged follow-up 56 fix; this was the same known shortcut propagation
failure, not a newly discovered color regression.

A normal merge of master `2246c68b6ceb5778109c1661a0989e6dc7aab1d3` produced
`a73d7838b674d73cab862a97464a1148ef30d488`. The PR123 `preventDefault` /
`stopPropagation` / save sequence and stronger Enter, Ctrl+Enter, Meta+Enter and
storage-failure tests are preserved. Compared with that master, the runtime diff
is still only the original method presentation bindings and scoped CSS. The
method-contrast spec and CSS are byte-identical to their original feature versions.

Full lint, explicit TypeScript and production build passed on the merged tree.
The new index SHA256 is
`e9c05559b463bbe89fd951dcbff1b7b46c710c9c5a2dea437aa454387a9e248e`.
The same six-spec mock-only command above passed **44/44** scenarios with zero
retries in **3.1 minutes**, including all three preset-save key variants and
storage failure. Fresh method measurements again contain **212** enabled color
pairs, none below 4.5, with minimum **4.853347:1**. These checks include both themes,
native 200% zoom, disabled/loading fallbacks and confirmation/cancellation gates.
The original images and measured baseline remain labeled with their original
af26-based provenance above. This local result does not claim the fresh full CI
run has completed.
