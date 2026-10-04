# Export coverage and complete reads

Export format version 3 now carries optional `coverage` metadata with its own `version: 1`. Existing resource payloads and import compatibility are unchanged. The metadata records `mode` (`full`, `selected`, or `dependencies`), `selectedResources`, canonical `rootUrls`, and a coverage entry for every collection.

Each collection records `count`, `state` (`complete`, `incomplete`, or `excluded`) and its scope: all resources, exact canonical resource IDs, or exact Service/Consumer owner URLs. Child collections also record requested owners, completed owners, and whether the entire owner catalog was read. Dependency exports list the reference paths included by the chosen options. Empty but successfully read collections are distinct from endpoints that could not be read.

## Reads and failures

Full exports page through every top-level and child collection with bounded requests, verify stable totals, reject duplicate canonical identities, and require the exact final count. Each value and any returned envelope key must match its resource path before owner metadata is attached. An empty child collection reported as 404 is accepted only after a fresh detail read verifies its owner. Plugin Metadata validates the returned plugin catalog and each returned metadata identity. Even a full export declares only the exact Plugin Metadata IDs enumerated from that catalog, including names whose detail returns 404. It does not claim coverage for metadata belonging to plugins outside that catalog; different catalogs cannot establish removal.

An endpoint unavailable on its first page may still produce the existing partial export, with both `skippedResources` and `coverage.state: incomplete`. Successful owner reads remain listed explicitly. A later page failure, changing total, duplicate, truncated list, wrong identity or wrong child owner blocks the entire download. No ambiguous collection is silently represented as an empty or complete snapshot.

## Snapshot comparison

Shared resource IDs can still be compared for semantic changes. Added and Removed are inferred only when both snapshots declare the same complete collection scope. Different selected IDs, different dependency/owner scopes, excluded or incomplete collections, and legacy files without coverage metadata yield **Not comparable** for absent resources. The collection coverage panel exposes exact scope and owner records, and the downloadable comparison report preserves them.

A legacy array being present, even empty, does not prove collection completeness. Sharing artifacts remain incomplete for absence comparison even if their source carried complete coverage. Their existing import/restore block remains in force. Coverage is descriptive metadata supplied by the file, not a signature or evidence of an atomic gateway snapshot; sequential reads can still observe concurrent changes.

The implementation does not change normal list wrappers or the import/change-set executor. Tests use fixture-only Admin API responses and cover pagination failure, duplicate IDs, wrong owners, partial first-page failures, full/selected/dependency scopes, malformed metadata, legacy behavior, sharing guards and narrow-screen inspection.
