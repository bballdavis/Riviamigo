# Riviamigo

Riviamigo is a self-hosted Rivian telemetry dashboard built with Rust, React, and TimescaleDB. It ingests vehicle telemetry, stores it locally, and exposes battery, charging, trip, and efficiency views through a typed web app.

## Quick Start

1. Install prerequisites:
   - Node 20+
   - pnpm 9+
   - Rust stable
   - Docker Desktop
2. Install dependencies:

```bash
pnpm install
```

3. Start the full dev stack:

```bash
pnpm run dev:stack
```

Primary local services:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Database: `postgresql://localhost:5432`

## Repo Shape

```text
apps/
  api/          Rust API, ingestion, auth, storage
  web/          React app
packages/
  dashboards/   dashboard system
  hooks/        frontend data access
  types/        shared contracts
  ui/           shared design system
infra/          compose and deployment runtime files
docs/           canonical docs and wiki-source drafts
```

## Contributor Entry Points

- [`AGENTS.md`](./AGENTS.md)
  Primary Codex/bootstrap guide for workflow, shared seams, and documentation policy.
- [`CLAUDE.md`](./CLAUDE.md)
  Companion execution guide with commands and architecture detail.
- [`docs/index.md`](./docs/index.md)
  Canonical routing hub for architecture, branding, operations, and user-facing docs.

## Common Commands

```bash
pnpm run dev:stack
pnpm typecheck
pnpm lint
pnpm test
pnpm docs:check
```

Focused frontend test example:

```bash
pnpm -C apps/web exec vitest run src/test/<file>.test.tsx
```

## Documentation Model

- Repo docs are canonical.
- User-facing docs are authored in [`docs/wiki-drafts/`](./docs/wiki-drafts/README.md).
- The GitHub Wiki is a published mirror, not the authoring source.

## Further Reading

- Visual system: [`docs/branding.md`](./docs/branding.md)
- Architecture: [`docs/architecture/overview.md`](./docs/architecture/overview.md)
- Dashboard internals: [`docs/frontend/dashboard-architecture.md`](./docs/frontend/dashboard-architecture.md)
- Rivian auth flow: [`docs/rivian-auth.md`](./docs/rivian-auth.md)
- API access: [`docs/api-access.md`](./docs/api-access.md)
