# Browser zoom verification

Follow-up 54 closes the approved accessibility work's missing native-zoom evidence. Routes/table RAW, Add Route and JSON comparison actions have automated light/dark checks at actual **200% Chromium tab zoom**. A fixed browser window, `tabs.getZoom`, halved layout width and doubled pixel ratio prove this is browser zoom rather than a resized viewport or CSS transform.

The tests use an isolated test profile and mocked Admin API responses. They check visible actions, keyboard movement/return, actual pointer targeting, document overflow and complete physical-screen captures. Application behavior is unchanged.

See [measurements, reproducible command, build-specific results and final screenshots](../design/browser-zoom/README.md) for the exact evidence and its limits.
