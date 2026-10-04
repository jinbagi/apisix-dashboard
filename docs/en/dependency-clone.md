# Clone a resource with its dependencies

Select Routes, Stream Routes or Services and choose **Clone with dependencies**. The Dashboard reads each selected resource and follows supported Service, Upstream and Plugin Config references. It also includes Service GraphQL cost decorations, grpc-transcode Proto IDs and traffic-split Upstream IDs. Shared resources are included once.

The clone dialog suggests new IDs, lets you edit them in a visual table or mapping JSON, and previews the original and clone JSON. Resource IDs, supported references and child owners are remapped together. Unknown JSON properties and array order are retained. Unsupported plugin references, Secrets, Consumers, SSLs, Global Rules and Plugin Metadata are outside this scope; embedded endpoints and unknown plugin IDs stay unchanged.

HTTP Routes are disabled by default (`status: 0`), with an explicit option to enable the copies when applied. Stream Routes retain their matching conditions and have no disabled state added by this flow. Review addresses, ports, SNI, URI and priority before applying any clone, especially when choosing to activate HTTP Routes.

Every included resource must target a different canonical URL. Existing destinations, malformed responses, unreadable dependencies and incomplete child collections block the whole clone. Changing a mapping or activation choice invalidates the previous review. **Check destinations** refreshes the comparison; **Reload source and reset clone** rereads source resources and resets mappings.

**Stage clone** repeats the destination checks and adds the complete bundle to Change sets with a create-only baseline. It sends no writes. Open **Change sets** from the sidebar to inspect dependency order, preview destinations again and explicitly apply. A duplicate already-staged URL is rejected without replacing existing drafts. Drafts stay in this tab's memory; reloading clears them.

The executor checks each create-only destination again before its PUT and verifies the result with a fresh GET. Reads are sequential observations, not an atomic snapshot or lock: APISIX does not make this multi-resource operation transactional. Execution can partially succeed and stops on a failure; review per-resource results before any further action. Source resources are not modified by clone preparation or staging.

## Verification

Fixture-backed contracts cover ID/ref/child remapping, unknown JSON and own `__proto__` keys, collisions, wrong identity responses, a destination appearing after preview, and HTTP/Stream status semantics. Browser fixtures exercise the complete clone → staged create-only → ordered verified apply workflow, no-write staging/failure paths, duplicate staging, stale response dismissal and bounded modal footers at 390px width. No populated local gateway is used by these tests.
