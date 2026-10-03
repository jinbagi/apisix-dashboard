# Quick navigation and resource search

Baseline: `835b413` (resource table experience, PR #62).

This change improves the header search as a gateway navigation surface, using
existing Ant Design components, theme tokens and resource route wrappers.
The review was grounded in the current source and existing interaction patterns.
Local cloud-browser navigation was blocked (`ERR_BLOCKED_BY_CLIENT`), so this is
not presented as a screenshot-based UX audit or a completed live interaction
review. CI result-list and narrow light/dark captures were inspected; that review
identified a mobile dialog height issue, now covered at both 844 px and 640 px
viewport heights.

## Behavior

| Previous behavior | Updated behavior |
| --- | --- |
| Opening search displays a blank result area. | Show labeled workspace shortcuts and actions that open creation drafts. |
| A readonly textbox acts as the trigger. | Use a labeled button, available from keyboard and as an icon on narrow screens. |
| All collections are fetched again for each query. | Search and select a resource type; reuse successful reads during the open session, and clear that cache on close. |
| Only the first 20 results are reachable. | Report the match count and reveal further results in batches. Exact IDs and names sort first. |
| Resource types use internal camel-case labels and identifying context is limited. | Show readable types, name, ID, URI/host and Secret manager when available. |
| Unavailable later pages are silently skipped. | Name incomplete collections, retain available matches and offer Retry. |
| A previous result can remain selectable during a new query debounce. | Cancel previous requests immediately and suppress previous results and keyboard selection. |

Search supports name, ID, URI, host, SNI, description, reference IDs, manager and
labels. All whitespace-separated query terms must match. It does not index
plugin or Secret provider configuration. Identity links encode path segments,
and Secret results distinguish manager plus ID.

Collection pages are read sequentially within each resource type, limiting the
number of outstanding reads to the number of requested types. A malformed
collection is reported as incomplete. Complete reads are reused only for this
open session; Retry refreshes incomplete reads. Closing and reopening starts
fresh reads so previous cached search data does not survive resource edits.

## Verification

- Full zero-warning ESLint, TypeScript and production build.
- Seven data tests: identity ranking, multi-term routing/label search, identity
  encoding, Secret managers, pagination/deduplication, missing pages,
  cancellation and malformed responses.
- Browser regressions cover shortcut focus, creation without writes, Escape
  focus return, context and additional results, scoped requests/session caching,
  exact resource navigation, previous-result suppression, unsaved editor drafts,
  partial/unavailable search and retry, manager identity and empty queries.
- Separate 390 px light/dark cases assert horizontal and vertical dialog bounds
  at 844 px and 640 px viewport heights and capture screenshots. The result-list
  case also captures a screenshot. Captures are in the E2E `test-results`
  artifact. CI capture inspection supplements automated checks; live manual
  interaction review is still outstanding.
- Existing gateway failure tests use the new semantic button/input controls.

This work does not change APISIX writes, resource schemas, authentication,
existing save confirmation or unsaved-change protection.
