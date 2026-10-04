# Preserve SSL hostname tags during keyboard navigation (follow-up 50)

## Reproduction and cause

In Add SSL, enter `first.example` in SNI, clear it, enter `fixture.example` in SNIs and press Enter. The tag is visible and SNI becomes disabled. Press Tab: the original implementation removes the tag, keeps focus in SNIs, re-enables SNI and displays “A server certificate requires SNI or SNIs”. This was reproduced with synthetic local fixtures and zero Admin API writes. The desktop and 390px regressions both fail against the unchanged component before this fix.

The installed `@rc-component/select` 1.7.1 handles Tab and Enter through the same option-selection branch in `OptionList`. With the popup open, Tab toggles the selected tag and calls `preventDefault`, so the value disappears before the blur handler runs. A temporary fixture trace of event names and array lengths confirmed `change(1 tag → 0 tags)` without `blur`; all trace code was removed. No dependency code was changed.

A second regression exposed that the dashboard's manual blur handler appended text after Select had already submitted it. Re-entering an existing hostname then blurring produced a duplicate tag. The Select's own submit path already trims and deduplicates the displayed values before `onChange`.

## Change

- A typed wrapper handles Tab in the capture phase. It invokes the caller's capture handler first, stops only Tab propagation into Select, and does not prevent the browser's default forward/backward focus movement. The handler is separated from the spread props so a caller cannot silently overwrite it. Other keys keep the existing Select behavior.
- Blur now clears the controlled search text and marks the React Hook Form field touched. The existing Select `onChange` is the single commit/conversion path, retaining numeric `from`/`to` behavior without the duplicate manual append.
- SNI and SNIs declare each other as validation dependencies so changing either refreshes cross-field errors and disabled state accurately.

No Admin API wrapper, payload normalization, request interceptor, schema, or dependency is changed.

## Acceptance and evidence

Fixture coverage checks Enter followed by Tab/Shift+Tab, actual focus movement, tag retention, uncommitted text on Tab and pointer blur, duplicate input, multiple tags, pointer removal and Backspace, SNI/SNIs validation and disabled transitions, exact Payload JSON, numeric HTTP status tags in Upstream health checks, and an exact custom-ID SSL PUT followed by verified detail state. The capture callback ordering is independently source-reviewed; no production page currently supplies that optional callback.

All non-save scenarios assert zero write attempts. The save test intercepts every Admin API request and checks one PUT containing the intended hostname array, omitting ID and empty SNI from its body. It uses synthetic certificate/key strings and a matching exact read-back fixture. This is local frontend/contract evidence, not a service-backed APISIX result.

Full repository ESLint, TypeScript and production build pass (the existing large-chunk advisory remains). The final production suite passes **57/57** in 53.7 seconds: `ssl-tag-keyboard.spec.ts`, `ssl-upstream.validation-parity.spec.ts`, and `resource-create.ids.spec.ts`. The six new keyboard/blur/conversion scenarios also passed during development. The original desktop and narrow Enter/Tab fixtures both failed before the fix; the duplicate-blur case separately failed with a duplicated hostname before removing the redundant append.

## Screenshots

[Before: Tab removes the hostname and leaves an error](before-tab.png).

[After: desktop hostname retained](after-1440.png) · [After: 390px hostname retained](after-390.png).
