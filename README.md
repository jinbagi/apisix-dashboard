# APISIX Dashboard (Next-Gen)

A static React admin console for operating Apache APISIX through the APISIX
Admin API. The dashboard focuses on practical resource management: visual forms,
schema-guided JSON editors, topology inspection, import/export, and a direct
Admin API console without a separate dashboard backend.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](package.json)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](package.json)
[![Ant Design](https://img.shields.io/badge/Ant%20Design-6-0170FE?logo=antdesign)](package.json)
[![TanStack](https://img.shields.io/badge/TanStack-Router%20%26%20Query-FF4154?logo=reactquery)](package.json)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright)](package.json)

---

> [!IMPORTANT]
> **Zero Dashboard Backend**  
> This dashboard runs in the browser and communicates with APISIX through the
> Admin API. It does not run `manager-api`, keep a dashboard database, or sync
> APISIX state through a separate service.

---

## Product Preview

![APISIX Dashboard overview](docs/en/assets/screenshots/dashboard-overview-16x9.png)

This is not a mockup. The dashboard above is a static React SPA connected
directly to an APISIX Admin API, rendering live Routes, Services, Upstreams,
plugin usage, operational status, and recent configuration changes without a custom
backend.

What usually surprises people:

*   No `manager-api`: the browser talks to APISIX through the Admin API.
*   No dashboard database: state lives in APISIX and local browser settings.
*   Visual forms, topology, Payload JSON, Admin API JSON, and a direct API
    console are available in one UI.

Start with the [Getting Started guide](docs/en/getting-started.md) for a guided
walkthrough of connection setup, route management, topology, and the API
console.

| Route list | Route detail |
| :---: | :---: |
| ![Routes list](docs/en/assets/screenshots/routes-list-16x9.png) | ![Route detail](docs/en/assets/screenshots/route-detail-overview-16x9.png) |

| Interactive topology | Direct Admin API console |
| :---: | :---: |
| ![Topology map](docs/en/assets/screenshots/topology-map-16x9.png) | ![API console](docs/en/assets/screenshots/raw-api-console-16x9.png) |

---

## Architecture

The dashboard is deployed as static files. At runtime, the browser sends Admin
API requests through the same-origin `/apisix/admin` path, usually served by
APISIX itself or by a reverse proxy in front of the Admin API.

```
[ Browser (Static SPA) ] --/apisix/admin--> [ APISIX Admin API ] --> [ etcd ]
```

The UI does not write dashboard-only resource shapes. Resource forms, tables,
JSON editors, import/export, and topology views are built around APISIX Admin
API payloads.

## Project Shape

| Area | Current implementation |
| :--- | :--- |
| **Runtime** | Static React SPA served from `/ui/` |
| **Admin API access** | Same-origin `/apisix/admin` requests with `X-API-KEY` |
| **Frontend stack** | React 19, Vite 8, TypeScript, Ant Design 6 |
| **Routing and data** | TanStack Router and TanStack Query |
| **Forms and validation** | React Hook Form and Zod schemas |
| **JSON editing** | Monaco-based Payload JSON, Admin API JSON, Plugin JSON, and Request/Response JSON |
| **Topology** | `@xyflow/react` and `dagre` |
| **Testing** | Playwright E2E coverage |

---

## Key Features

See the [APISIX 3.19.0 guide](docs/en/apisix-3.19.md) for native WebSocket
upstreams, TLS trust, slow start, stream TLS passthrough, new plugins and
service-owned GraphQL query cost controls.

*   **Resource-first UI**: Manage Routes, Stream Routes, Services, Upstreams,
    Consumers, Consumer Groups, SSLs, Global Rules, Plugin Configs, Plugin
    Metadata, Secrets, and Protos from one static console.
*   **Interactive Topology Map**: Built with `@xyflow/react` and `dagre` to show
    the live relationship between Routes, Services, Upstreams, and backend
    targets.
*   **Schema-guided JSON Editing**: Use Payload JSON while creating resources,
    Admin API JSON while patching saved resources, Plugin JSON inside plugin
    drawers, and Request/Response JSON in the API Console.
*   **Plugin Configuration Help**: Plugin forms and JSON templates prefill
    required fields from APISIX schemas, with extra guidance for AI Gateway
    plugins such as `ai-proxy` and `ai-proxy-multi`.
*   **Direct API Integration**: Admin API keys are stored in local browser
    storage, and API traffic uses the same-origin `/apisix/admin` path.
*   **Backup & Migration Engine**: Export and import gateway resources in a
    unified JSON format.
*   **Direct Admin API Console**: Build, send, save, and inspect APISIX Admin API
    requests without leaving the dashboard.

---

## Integration & Hosting

> [!TIP]
> **CORS-Free Deployment**  
> Serving the built static files directly from the APISIX gateway (Option A) automatically avoids cross-origin requests, as the dashboard shares the same origin and port with the Admin API.

### Option A: Embedded inside APISIX Gateway (Recommended)
You can serve this dashboard directly from your running APISIX gateway instance.

1. **Build the production static assets**:
   ```bash
   pnpm install
   pnpm build
   ```
2. **Copy the build folder** into your APISIX gateway instance:
   ```bash
   # Copy the static dist contents to APISIX's UI folder
   cp -r dist/* /usr/local/apisix/ui/
   ```
3. **Enable the UI** in your APISIX `conf/config.yaml` and restart the gateway:
   ```yaml
   deployment:
     admin:
       enable_admin_ui: true
   ```
4. Access the dashboard at `http://<your-apisix-host>:9180/ui/`.

---

### Option B: Standalone Static Hosting
Because the project is compiled into static assets, it can be hosted on any static file server or CDN.

1. Build the project using `pnpm build`.
2. Upload the generated `dist/` directory to Nginx, S3, Vercel, Netlify, or Cloudflare Pages.
3. Configure the host or edge proxy to forward `/apisix/admin` to the APISIX Admin API.
4. Access the hosted URL, click the **Settings** icon, and input your APISIX Admin Key.

---

## Local Development & Testing

### Prerequisites
*   Node.js 22+
*   PNPM 10+

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/jinbagi/apisix-dashboard.git
   cd apisix-dashboard
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the development server:
   ```bash
   pnpm dev
   ```
   The development server runs at `http://localhost:5173/ui/` and proxies `/apisix/admin` requests to `http://localhost:9180` by default. Override the target gateway endpoint if needed:
   ```bash
   VITE_APISIX_API_TARGET=http://your-apisix-host:9180 pnpm dev
   ```

### Dev Container Integration
A fully configured `.devcontainer` configuration is included. Opening the repository in VS Code with the Dev Containers extension will automatically spin up APISIX, etcd, Node.js, and pnpm.

### Code Quality & E2E Testing
Run the codebase test suites to verify compilation, lint rules, and CRUD functionality:

*   **Lint Check**:
    ```bash
    pnpm lint
    ```
*   **Type Compilation**:
    ```bash
    pnpm build
    ```
*   **Playwright E2E Tests** (Requires the gateway container to be running):
    ```bash
    pnpm e2e
    ```

---

## Contributing

Contributions are welcome. Please read our [Contributing Guide](CONTRIBUTING.md) for details on submitting bug reports, feature requests, and pull requests.

## License

Licensed under the [Apache License 2.0](LICENSE).
