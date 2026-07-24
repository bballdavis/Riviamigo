# Architecture Overview

## Audience

Engineering contributors making structural changes across the monorepo.

## Source Of Truth

This document is canonical for the repo-level architecture map. Update it when ownership, package boundaries, or major seams change.

## Repo Shape

```text
apps/
  api/          Rust API, ingestion, auth, database access, operational routes
  web/          React SPA, routes, layout, page composition
  docs/         Docusaurus site built directly from the canonical docs tree
packages/
  dashboards/   dashboard schema, defaults, renderer, widget registry
  hooks/        API client, auth store, React Query hooks
  types/        shared TypeScript contracts
  ui/           design system primitives, charts, tables, tokens
  config/       shared TS, ESLint, Tailwind config
compose/        production image, Compose topology, nginx, and development infrastructure
docs/           canonical documentation published through Docusaurus
scripts/        dev/build/docs utilities
```

## Structural Seams

- `apps/api` owns runtime truth, persistence, ingestion, and HTTP contracts.
- `packages/types` owns shared TypeScript API shapes consumed by the web app and packages.
- `packages/hooks` is the frontend data-access seam. Route and component code should not duplicate transport logic.
- `packages/dashboards` owns dashboard rendering and widget registration, not route-level page concerns.
- `packages/ui` owns shared visual primitives and tokens.
- `apps/web` owns route composition, page-specific UX, and integration of shared packages.
- `compose/Dockerfile` owns the unified production image containing the API, built SPA, nginx, backup tools, and the local restore supervisor. During an in-app restore nginx and the supervisor remain available while the API/ingestion process is replaced; development keeps infrastructure in `compose/docker-compose.dev.yml` while `scripts/dev.mjs` runs the API and restore supervisor as managed host processes.
- The container `TZ` setting is limited to runtime/container behavior. Riviamigo stores a separate global IANA application timezone in `system_config`; it drives user-facing date formatting, local-day grouping, and backup scheduling.
- Runtime logs use the common `[riviamigo][LEVEL]` key-value prefix. Docker supplies the outer timestamp; nginx emits only failed edge requests so successful health, static, and proxied traffic is not duplicated.

## Change Triggers

Update this doc when:

- a new package/app is added
- a responsibility moves between packages
- a shared seam changes ownership
- a new canonical contributor entrypoint is introduced

## Adjacent Docs

- [`backend-data-flow.md`](./backend-data-flow.md)
- [`../frontend/dashboard-architecture.md`](../frontend/dashboard-architecture.md)
- [`../branding.md`](../branding.md)
- [`../contributing.md`](../contributing.md)
