# Resumable import journals

From an Import preview, choose **Stage for resumable import** to open Change sets. Direct **Import** still runs immediately after confirmation and does not keep a resumable journal. RAW drafts and dependency clones can use the same staged workflow.

## Save and resume

1. Review the staged resources, then open **Encrypted journal**. Enter and confirm a password of at least 12 characters. **Encrypt and enable checkpoints** stores an encrypted snapshot on this browser. Configuration can contain secrets; the password stays only in memory and is never persisted.
2. Preview destinations and explicitly apply the reviewed changes. Before each PUT, the executor must save an encrypted uncertain checkpoint. After a successful exact-identity read-back it saves the actual observed configuration and verified outcome. Encryption, storage quota, or another tab changing the archive stops execution before the next PUT.
3. After a reload, reconnect or interruption, unlock the journal and choose **Reconcile and preview**. Unlocking replaces current staged drafts but never sends a write. Every exact destination is freshly fetched before any continuation can be confirmed.
4. Review the outcomes and explicitly apply remaining changes. Previously verified items whose actual configuration still matches are skipped. An uncertain write that already matches its intended replacement is also skipped; this observation does not fabricate a historical write. When its original baseline still matches, a retry requires a fresh preview and explicit confirmation. Conflicts, failed reads, or uncertain protected values stay blocked for manual inspection.

A PUT may have succeeded even when its response, read-back or final checkpoint failed. The pre-write uncertain checkpoint preserves that ambiguity. The dashboard never blindly replays that operation. SSL private keys, Secret values and other known protected fields cannot establish exact success through readable fields; uncertain writes containing them remain blocked even when visible values match.

## Scope and limits

The journal stores supported explicit-ID PUT creates and replacements from Change sets, including child resources with exact owner identities. A null baseline is create-only. Generated-ID POSTs, deletion and arbitrary API Console writes are outside this resumable workflow. Dependency ordering and the full JSON comparison remain available before applying. Fresh reads detect observed conflicts, but this is sequential execution, not an atomic transaction, compare-and-swap or automatic rollback.

Only one journal is stored per browser origin. Persisted execution requires browser Web Locks to serialize archive compare-and-write operations across tabs; without that facility it stops before sending a write. Encryption runs outside the short archive lock. If another tab holds the lock, the operation returns a retry message immediately instead of queuing; staged drafts and the stored archive are preserved. It uses the existing AES-GCM encrypted draft format with an origin and journal-context binding, a 500-item limit and a 2 MiB payload limit. Unlocked archives are validated for supported kinds, exact IDs and owners, duplicate destinations, valid states and writable snapshots before use. Browser clearing removes the archive; a forgotten password cannot be recovered. No Admin key or session settings are stored in it.

**Lock and clear staged changes** clears plaintext drafts and the in-memory password while keeping the encrypted archive. **Remove encrypted journal** deletes the archive and disables checkpoints while keeping current in-memory drafts. Newly staged drafts and removals are included when you next preview or apply; enabling checkpoints is not a general autosave for every local draft edit.

## Verification

Fixture-based tests exercise real encryption and decryption, wrong passwords and malformed archives, own special JSON keys, accepted-but-unverified writes, explicit retries only after unchanged-baseline reads, changed verified destinations, protected-value ambiguity, storage and cross-tab failures, and desktop/narrow-screen controls. These checks do not claim service-backed CI or a live gateway test.

### Follow-up 45: concurrent-checkpoint evidence

The original same-module concurrency fixture expected one executor Promise to reject. The executor can instead preserve a Blocked or Uncertain result through its update callback and return normally, so that assertion depended on encryption scheduling. The strengthened fixture requires exactly one PUT and one history entry, a blocked competing attempt, a verified or uncertain encrypted outcome, and no duplicate write after decrypting and reconciling it. A separate browser fixture uses independent tabs against shared mock destination records: the stale archive is rejected, each destination is written once, and reopening the winning archive in the stale tab reconciles completed items without replay. This follow-up changes test coverage only; the executor and archive-locking behavior are unchanged.

### Follow-up 49: direct Import selection in the combined workflow

The complete integrated APISIX 3.19 run exposed one legacy fixture using a substring match for the Import button. The new Stage for resumable import action also matched that selector, so Playwright stopped before any import with a strict locator error. The fixture now targets the exact Import action inside Confirm Import. It retains the complete assertions for three sanitized PUT payloads; no application behavior, payload contract or validation is weakened.


### Follow-up 51: distinguish enabled checkpoints from saved drafts

An enabled journal does not automatically persist later staging or removal. The page banner and journal dialog now state that only checkpointed drafts survive reload, and explain that the next Preview/Apply or an explicit Encrypt and enable checkpoints action saves the current drafts. The Change sets lifetime documentation uses the same rule. No autosave, storage, execution or retry behavior changes.

A browser fixture removes one saved draft and stages a new one, checks that the archive is still unchanged and no write was sent, then explicitly encrypts and reopens the exact updated draft set. The new scope notice failed before the copy change. A 390px capture checks that the notice is readable in the scrollable dialog and Done remains available: [checkpoint scope](../design/change-journal/checkpoint-scope-narrow.png).

Full ESLint, TypeScript and production build pass. The journal core/UI, staged UI and direct Import suites pass **41/41** against the production build; the final toast-free capture fixture also passes separately. All Admin API calls in this evidence are mocked.

When all staged drafts have been removed, Preview, Apply and Encrypt are disabled. The empty-state notice instead explains that the last stored checkpoint remains and directs users to **Remove encrypted journal**. Removing local drafts alone does not erase the archive. An additional regression fails before this conditional notice, proves that all local removals leave the archive unchanged with zero PUTs, then explicitly removes the archive and reloads to an empty workspace. The existing removal action and storage behavior are unchanged. [Empty checkpoint notice at 390px](../design/change-journal/empty-checkpoint-narrow.png).

The empty-state follow-up passes full lint, TypeScript and production build, plus **11/11** journal UI/direct Import cases. The new notice and explicit deletion flow were checked at 390px.
