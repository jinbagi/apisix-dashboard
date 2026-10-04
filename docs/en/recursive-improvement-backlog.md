# Recursive improvement backlog

Owner: this development thread. Scope approved by the user: implement all 20 proposals, record newly discovered problems and ideas, and continue prioritized improvements after current work completes. UI/UX and real Admin API behavior remain acceptance criteria throughout.

## Working agreement

- Preserve the original checkout and its uncommitted changes. Use isolated worktrees and focused codex/ branches based on current master.
- A task is done only after its behavior, failure paths, relevant checks, and visible UI have been verified and its PR has merged. CI pending means pending, not done.
- Read-only fixture tests may run locally. Destructive whole-suite CRUD tests run against an isolated gateway or CI, never populated user data.
- Prioritize regressions, data preservation, accessibility, and operator task completion. New ideas need a concrete user need and acceptance criteria before implementation.
- Record discoveries as new numbered items; do not silently replace or shrink the original 20. Keep partial implementations explicitly partial.

## Approved scope

| ID | Priority | Task and acceptance criteria | State | Evidence |
| --- | --- | --- | --- | --- |
| 01 | P1 | RAW field conflict resolution: original/server/draft per field; preserve independent changes; recheck on save; cancellation preserves draft. | Local verification complete; PR pending | 27 targeted tests, lint, tsc, build; desktop/narrow screenshots |
| 02 | P1 | Multi-tab RAW workspace: independent drafts, dirty state and editor position; protected close and navigation; usable narrow layout. | Backlog | |
| 03 | P1 | Related-resource side inspection: view linked Service, Upstream and Plugin Config while keeping current RAW draft intact. | Backlog | |
| 04 | P1 | History coverage: verified Form, Import and supported Console writes join existing RAW history with accurate before/after and failure behavior. | Backlog | |
| 05 | P1 | Change sets: stage related resource changes, inspect complete diff/dependencies/order, then show per-item verified application results. | Backlog | |
| 06 | P1 | Resumable import: preserve an execution journal, recheck destination after reconnect, resume remaining items without blindly replaying success. | Backlog | |
| 07 | P2 | Visual ID mapping: editable mapping table, Proto IDs and supported plugin refs, collision/unresolved-reference checks and preview. | Backlog | |
| 08 | P2 | Snapshot comparison report: additions/removals/semantic changes, omit read-only/key-order noise without erasing meaningful array order. | Backlog | |
| 09 | P2 | Plugin reference diagnostics: grpc-transcode Proto and traffic-split Upstream refs, uncertainty on incomplete reads, source RAW repair. | PR / CI pending | [PR 84](https://github.com/jinbagi/apisix-dashboard/pull/84); 10 local tests, lint, tsc, build |
| 10 | P2 | Overlap/shadow candidates: compare route host/URI/method/priority and explain supported overlap findings and unknown conditions. | Backlog | |
| 11 | P2 | Request matching preview: inputs and router mode, candidate routes with reasons, explicit unsupported conditions; validate against APISIX 3.19. | Backlog | |
| 12 | P2 | Consumer-aware configuration explanation: chosen Consumer/Group sources and whole-plugin precedence, runtime conditions distinguished. | Implementing | codex/recursive-consumer-explanation |
| 13 | P2 | Sharing redaction: preview masked sensitive fields for copy/export; mark redacted artifacts incomplete for restoration. | Backlog | |
| 14 | P2 | Dependency clone: choose shared versus cloned dependencies, explicit new IDs, remap refs, collision checks and per-item outcome. | Backlog | |
| 15 | P2 | Plugin inventory/comparison: find configured instances, compare values and transition selected resources into existing bulk editing. | Backlog | |
| 16 | P3 | Console collections: organize existing presets and substitute named non-secret variables with a reviewable request preview. | Backlog | |
| 17 | P3 | SSL replacement helper: inspect old/new names/validity and key match, review payload changes and verify save without exposing key material. | Backlog | |
| 18 | P3 | Table layout: configurable optional column order/width/pinning, keyboard controls, saved views migration and narrow screen behavior. | Implementing | codex/recursive-table-layout |
| 19 | P3 | Consistent actions/status/accessibility: Add/RAW/Save hierarchy, loading/success/error feedback, keyboard/focus and zoom/narrow screen verification. | Implementing (connection flow); remaining actions backlog | codex/recursive-connection-ux |
| 20 | P3 | Large data performance: measure thousands of rows and large JSON; improve observed table/diff/editor load bottlenecks and large Global Rule impact lists; retain behavior. | Backlog | |

## Discovered follow-up work

| ID | Priority | Evidence / user impact | Acceptance criteria | State |
| --- | --- | --- | --- | --- |
| 21 | P1 | RAW/shared JSON helpers assign keys through ordinary objects. Audit special own keys before expanding JSON operations. | Adversarial keys cannot mutate prototypes or disappear silently; relevant payload tests. | Investigating |
| 22 | P2 | Known plugin reference paths are duplicated between dependency export and diagnostics. Mapping could diverge. | Share a tested reference extractor with explicit source scope across export, diagnostics and mapping. | Backlog; coordinate with 07 |

| 23 | P1 | Initial Settings applies every typed Admin Key immediately, replacing a working connection before validation; input lacks associated label/help/error and narrow error page overflows. Source and current unauthenticated UI evidence. | Draft key isolated until successful explicit connection check; previous key preserved on cancel/failure; accessible labelled errors and no horizontal overflow at narrow widths. | Implementing with 19 |
| 24 | P1 | Route configuration explanation accepts incomplete Global Rule totals and does not verify returned detail identities. | Fail incomplete/duplicate/identity-mismatched reads without claiming complete explanation; retry supported. | Implementing with 12 |
| 25 | P3 | Ant Design 6 console warns about old Space/Alert/Modal props. | Migrate supported props in touched/shared UI and verify behavior; no broad cosmetic churn. | Backlog with 19 |
| 26 | P3 | New connection screen exposes a full commit hash that wraps at narrow widths. | Move detailed build identity into diagnostics/About and keep primary connection task clear. | Implementing with 23 |

## Execution log

- Baseline: master 4b8216f5. Existing local changes remain preserved.
- First parallel units: 01, 09, 18; read-only UI audit supports 19 and follow-up discovery.
- Local Docker was stopped at first inspection; restarted existing containers without deleting data. Full local data remains outside test cleanup scope.
