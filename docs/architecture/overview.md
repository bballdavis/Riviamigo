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
compose/        compose, nginx, postgres, object-storage runtime files
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
