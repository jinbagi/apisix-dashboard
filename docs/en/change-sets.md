# Change sets

Use **Stage change** in a RAW editor or **Stage for resumable import** in an Import preview to collect related changes. Staging copies the draft into memory and sends no write request. The RAW editor keeps its draft. Open **Tools → Change sets** to review all destinations together.

Change sets support native Admin API resources already supported by Import, including Consumer Credentials and Service GraphQL Cost Decorations. Every staged change has an explicit resource ID and uses **PUT**: create a missing resource or replace an existing writable configuration. Fields absent from the replacement may be removed. Generated-ID POSTs, arbitrary Console subpaths and deletion are not part of this workflow.

## Review and apply

1. Select **Preview destinations**. Each exact resource is fetched and its identity checked before comparison. Compare JSON shows the entire current writable payload and proposed replacement.
2. Review **Create only** labels, resource order and required resources. A draft staged against a missing resource (`baseline: null`) remains create-only: another resource taking that ID blocks it. RAW and Import drafts retain their original writable baseline; an observed later change blocks the draft.
3. Apply the reviewed changes. The target is freshly checked again, including the same exact snapshot used for history, immediately before PUT. Accepted writes are read back and verified. Only readable fields can be checked for protected values, and the result explicitly says so.
4. Inspect every outcome. Execution stops at the first failure. Earlier verified changes remain applied, and later items remain untouched. Re-preview can continue items whose prerequisite failed before a write was sent. Previously verified items are never sent again. If a write was sent but its result is uncertain, inspect the actual resource before discarding or restaging it; there is no automatic retry.

The dependency order covers native Service, Upstream, Plugin Config, Consumer Group and child-owner references, plus grpc-transcode Proto and traffic-split Upstream IDs. Unsupported plugin relationships are not guessed. External referenced resources are checked, and missing, blocked or cyclic dependencies prevent application.

This is sequential execution with conflict detection from fresh reads, not atomic compare-and-swap, a transaction, or automatic rollback. Another writer can still act between the final read and PUT.

## Lifetime and privacy

Drafts and outcomes are kept in this browser tab's memory and survive navigation within the app. Closing or reloading the tab removes them unless an encrypted journal has been enabled; a browser unload prompt helps prevent accidental loss. See [Resumable import journals](resumable-import.md) for opt-in encrypted checkpoints and reconnection checks. Configuration payloads may include secrets, so the workspace does not log them or include session credentials.

## Validation evidence

Fixture-only tests cover RAW/Import staging without writes, exact identities, native custom IDs, create-only collisions, complete payload comparison, reference ordering, concurrent changes at both preflight reads, partial failure, no replay of successful or uncertain writes, and a 390 px viewport. These tests do not claim live gateway or CI validation.

### Follow-up 52: stable preview action name

Integration validation reproduced an enabled retry button whose accessible name remained `loading Preview destinations` after a prerequisite failed. The execution result was available, but the spinner's accessible name made the exact action name unstable. Preview now keeps its visible name as its explicit accessible label and exposes progress separately through `aria-busy`; its text, loading behavior and executor are unchanged.

A held destination GET reproduces the missing exact name before the fix. The regression checks the same action while busy, after the response, and on explicit re-preview, with no gateway writes. The existing partial-failure case still requires exact action names and verifies that re-preview never replays the successful item.

Local validation passed lint, TypeScript/production build, 96 affected fixture tests, and five repetitions of both the pending-name and failed-prerequisite retry cases (10/10). This follow-up changes no visible layout.
