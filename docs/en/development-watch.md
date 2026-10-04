# Development watcher and browser test reports

Vite watches application files for hot updates. Generated Playwright report HTML must not send full-reload messages while UI checks are running, because those messages can interrupt an open editor or invalidate a browser test. The development watcher now ignores `playwright-report` directories. Vite 8 already excludes `test-results`; source files retain normal watching. Production serving and Admin API proxy settings are unchanged.

A temporary probe ran the actual Vite server with this repository configuration. Before the change, editing a report HTML file produced a watcher change event and a `full-reload` WebSocket payload. After the change, the same report/result writes produced neither; editing an imported CSS source still produced its normal hot-update payload. The probe closed the server and removed its own temporary files. Repository lint, TypeScript and production build provide the static checks.

For fixture-based UI verification, a production build and `pnpm preview` remain useful: they exercise the served bundle without development transformations. Service-backed CRUD suites still require an isolated APISIX instance; generated reports are not application source.
