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
| 01 | P1 | RAW field conflict resolution: original/server/draft per field; preserve independent changes; recheck on save; cancellation preserves draft. | Merged | [PR 85](https://github.com/jinbagi/apisix-dashboard/pull/85); 27 targeted tests, lint, tsc, build; desktop/narrow screenshots |
| 02 | P1 | Multi-tab RAW workspace: independent drafts, dirty state and editor position; protected close and navigation; usable narrow layout. | Merged | [PR 92](https://github.com/jinbagi/apisix-dashboard/pull/92); independent drafts, navigation, stale-read protection and narrow keyboard tests |
| 03 | P1 | Related-resource side inspection: view linked Service, Upstream and Plugin Config while keeping current RAW draft intact. | Merged | [PR 91](https://github.com/jinbagi/apisix-dashboard/pull/91); 16 production-preview tests, lint, tsc, build, desktop/narrow screenshots |
| 04 | P1 | History coverage: verified Form, Import and supported Console writes join existing RAW history with accurate before/after and failure behavior. | PR / CI pending | [PR 97](https://github.com/jinbagi/apisix-dashboard/pull/97); Forms, Import and supported Console history; exact-response identity and bounded readback verification |
| 05 | P1 | Change sets: stage related resource changes, inspect complete diff/dependencies/order, then show per-item verified application results. | Backlog | |
| 06 | P1 | Resumable import: preserve an execution journal, recheck destination after reconnect, resume remaining items without blindly replaying success. | Backlog | |
| 07 | P2 | Visual ID mapping: editable mapping table, Proto IDs and supported plugin refs, collision/unresolved-reference checks and preview. | Merged | [PR 90](https://github.com/jinbagi/apisix-dashboard/pull/90); 43 tests, lint, build, desktop/narrow screenshots; includes 22 |
| 08 | P2 | Snapshot comparison report: additions/removals/semantic changes, omit read-only/key-order noise without erasing meaningful array order. | Merged | [PR 96](https://github.com/jinbagi/apisix-dashboard/pull/96); full CI success; 24 fixtures, lint, build and screenshots |
| 09 | P2 | Plugin reference diagnostics: grpc-transcode Proto and traffic-split Upstream refs, uncertainty on incomplete reads, source RAW repair. | Merged | [PR 84](https://github.com/jinbagi/apisix-dashboard/pull/84); 10 local tests, lint, tsc, build; full CI success; merged 623bf557 |
| 10 | P2 | Overlap/shadow candidates: compare route host/URI/method/priority and explain supported overlap findings and unknown conditions. | Merged | [PR 94](https://github.com/jinbagi/apisix-dashboard/pull/94); 7 production-preview tests, lint, tsc, build, desktop/narrow screenshots |
| 11 | P2 | Request matching preview: inputs and router mode, candidate routes with reasons, explicit unsupported conditions; validate against APISIX 3.19. | Merged | [PR 98](https://github.com/jinbagi/apisix-dashboard/pull/98); full CI success; 23 production fixtures and 18 APISIX 3.19 radixtree golden cases |
| 12 | P2 | Consumer-aware configuration explanation: chosen Consumer/Group sources and whole-plugin precedence, runtime conditions distinguished. | Merged | [PR 87](https://github.com/jinbagi/apisix-dashboard/pull/87); 24 local tests, lint, tsc, build |
| 13 | P2 | Sharing redaction: preview masked sensitive fields for copy/export; mark redacted artifacts incomplete for restoration. | Merged | [PR 100](https://github.com/jinbagi/apisix-dashboard/pull/100); full CI success; sharing redaction and restore guards |
| 14 | P2 | Dependency clone: choose shared versus cloned dependencies, explicit new IDs, remap refs, collision checks and per-item outcome. | Backlog | |
| 15 | P2 | Plugin inventory/comparison: find configured instances, compare values and transition selected resources into existing bulk editing. | PR / CI pending | [PR 101](https://github.com/jinbagi/apisix-dashboard/pull/101); 10 inventory fixtures and 13 import identity fixtures; lint and build |
| 16 | P3 | Console collections: organize existing presets and substitute named non-secret variables with a reviewable request preview. | Backlog | |
| 17 | P3 | SSL replacement helper: inspect old/new names/validity and key match, review payload changes and verify save without exposing key material. | Backlog | |
| 18 | P3 | Table layout: configurable optional column order/width/pinning, keyboard controls, saved views migration and narrow screen behavior. | Merged | [PR 86](https://github.com/jinbagi/apisix-dashboard/pull/86); 33 production-preview tests, lint, tsc, build |
| 19 | P3 | Consistent actions/status/accessibility: Add/RAW/Save hierarchy, loading/success/error feedback, keyboard/focus and zoom/narrow screen verification. | Connection and footer merged; mobile PR / CI pending | [PR 89](https://github.com/jinbagi/apisix-dashboard/pull/89), [PR 99](https://github.com/jinbagi/apisix-dashboard/pull/99), [PR 104](https://github.com/jinbagi/apisix-dashboard/pull/104) |
| 20 | P3 | Large data performance: measure thousands of rows and large JSON; improve observed table/diff/editor load bottlenecks and large Global Rule impact lists; retain behavior. | Implementing after measured bottlenecks | 5000 Routes, 527KB JSON and 20 RAW tabs profiled; reduce inactive editor widgets and bound Global Rule affected-route lists |

## Discovered follow-up work

| ID | Priority | Evidence / user impact | Acceptance criteria | State |
| --- | --- | --- | --- | --- |
| 21 | P1 | RAW/shared JSON helpers assign keys through ordinary objects. Audit special own keys before expanding JSON operations. | Adversarial keys cannot mutate prototypes or disappear silently; relevant payload tests. | Merged [PR 88](https://github.com/jinbagi/apisix-dashboard/pull/88); 5 fail-before/pass-after reproductions, 46 production-preview tests, lint, tsc, build |
| 22 | P2 | Known plugin reference paths are duplicated between dependency export and diagnostics. Mapping could diverge. | Share a tested reference extractor with explicit source scope across export, diagnostics and mapping. | Merged in PR 90 |
| 23 | P1 | Initial Settings applies every typed Admin Key immediately, replacing a working connection before validation; input lacks associated label/help/error and narrow error page overflows. Source and current unauthenticated UI evidence. | Draft key isolated until successful explicit connection check; previous key preserved on cancel/failure; accessible labelled errors and no horizontal overflow at narrow widths. | PR 89 / CI pending |
| 24 | P1 | Route configuration explanation accepts incomplete Global Rule totals and does not verify returned detail identities. | Fail incomplete/duplicate/identity-mismatched reads without claiming complete explanation; retry supported. | Merged in PR 87 |
| 25 | P3 | Ant Design 6 console warns about old Space/Alert/Modal props. | Migrate supported props in touched/shared UI and verify behavior; no broad cosmetic churn. | Backlog with 19 |
| 26 | P3 | New connection screen exposes a full commit hash that wraps at narrow widths. | Move detailed build identity into diagnostics/About and keep primary connection task clear. | PR 89 / CI pending |
| 27 | P2 | Per-table presentation storage errors are silently ignored; users can believe a layout was saved when browser storage failed. | Show persistence failure without discarding active layout; report successful save only when confirmed; storage failure fixture. | Merged in PR 95 |
| 28 | P2 | Vite watches generated Playwright report HTML and can reload active local test pages. | Use production preview for fixture tests or narrowly exclude generated report/output directories; confirm normal source reload still works. | Backlog |
| 29 | P1 | Import preview injects the expected identity into returned detail payloads, hiding wrong-resource responses. | Reject mismatched detail identity/path before preview or mutation; test wrong-ID responses and no writes. | Merged in PR 93 |
| 30 | P1 | A delayed RAW initial GET can overwrite a verified saved draft once dirty clears; inactive tabs can open foreground conflict modals. | Revision-aware reads and active-tab modal gating; late-response and background-save regression fixtures. | Merged in PR 92 |

| 31 | P2 | Combined RAW tabs and reference inspector can push Save Changes onto a separate toolbar row at 960px. | Keep Save Changes predictably positioned; group secondary tools; verify keyboard and narrow layouts without losing draft actions. | Implementing with 19 |

| 32 | P2 | Selected and dependency exports lack machine-readable coverage, so missing resources cannot prove whole-gateway removal. | Add explicit export scope and preserve legacy uncertainty in snapshot comparison. | Backlog |
| 33 | P2 | Saved views read the list only at mount and can overwrite another browser tab's later changes. | Fresh reads before writes, storage-event synchronization and concurrent add/delete fixtures. | Backlog |

| 34 | P2 | At 390px, RAW guidance and navigation consume much of the editing height even after footer repair. | Compact or collapsible phone navigation that retains shortcuts, validation guidance and draft controls. | Backlog with 19 |
| 35 | P1 | Selected export detail reads overwrite response identity with the requested ID, allowing a wrong-resource response to be mislabeled. | Validate exact response identity before export normalization; mismatches prevent downloads; cover dependency detail reads too. | Assigned after 13 |

## Execution log

- Baseline: master 4b8216f5. Existing local changes remain preserved.
- First parallel units: 01, 09, 18; read-only UI audit supports 19 and follow-up discovery.
- Local Docker was stopped at first inspection; restarted existing containers without deleting data. Full local data remains outside test cleanup scope.

- PR 84 merged after complete E2E/security/license checks; source branch automatically deleted.
- PRs 85, 86 and 87 merged after complete CI. JSON key safety was integrated with RAW field conflicts and 37 combined fixtures passed; PR 88 checks restarted for the updated head.
- Multi-tab RAW and related inspector combined: 40 fixtures, lint and build passed; separate integration fixture retained for landing after PRs 91/92.

- PRs 91, 92 and 88 merged after complete CI. Connection PR 89 failed shared live-gateway setup and remains unmerged while the cause is repaired.
- Archiving managed worktrees with shared node_modules junctions removed shared dependency files. Restored the original frozen lockfile; subsequent cleanup must detach verified junctions nonrecursively before archive. Source changes and the original checkout were preserved.

- PRs 90, 93, 94 and 95 merged after complete CI. Connection probe failure reproduced from page_size=1 (HTTP400); PR89 now uses the existing minimum10 and stricter fixtures, with CI restarted.
- Task15 adds a configured-plugin inventory and semantic comparison with existing bulk RAW handoff. Production browser fixtures verify paginated lists, malformed/partial reads, child identities, read-only comparison and explicit writes.
