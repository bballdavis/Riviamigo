# CLAUDE.md

This is the Claude companion guide for Riviamigo. For repo policy and the canonical documentation workflow, start with [`AGENTS.md`](./AGENTS.md).

## Canonical Source Of Truth

- Repo operating rules, doc-update triggers, and workflow policy live in [`AGENTS.md`](./AGENTS.md).
- Human-facing repo onboarding lives in [`README.md`](./README.md).
- Deeper documentation routing lives in [`docs/index.md`](./docs/index.md).

Use this file for command references, architecture reminders, and Claude-oriented execution detail.

## Commands

### Full dev stack

```bash
pnpm run dev:stack
```

### Workspace

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm docs:check
pnpm storybook
```

### Frontend

```bash
pnpm --filter @riviamigo/web test
pnpm --filter @riviamigo/web test:coverage
pnpm --filter @riviamigo/web test:e2e
pnpm --filter @riviamigo/web exec vitest run src/routes/__tests__/battery.test.tsx
```

### Backend

From `apps/api/`:

```bash
cargo run
cargo test
cargo test -- --ignored
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all --check
```

### Database

```bash
pnpm db:migrate
pnpm db:reset
pnpm db:rebaseline
```

## Architecture Reminders

### Monorepo layout

```text
apps/api/          Rust API, ingestion, auth, storage
apps/web/          React app
packages/
  dashboards/      dashboard schema, renderer, widgets, defaults
  hooks/           API client, auth store, React Query hooks
  types/           shared TypeScript contracts
  ui/              primitives, charts, tables, tokens
  config/          shared tool configuration
```

### Key frontend seams

- Route files should stay thin.
- `DashboardPageShell` owns shared page shell behavior.
- `DashboardRenderer` is layout-only.
- Widget registry lives in `packages/dashboards`.
- Shared UI patterns should route through `packages/ui` and the branding doc.

### Key backend seams

- `apps/api/src/routes` owns the HTTP surface.
- `apps/api/src/ingestion` owns Rivian connectivity and telemetry flow.
- `apps/api/src/services` owns shared backend business logic.
- `apps/api/migrations` owns schema evolution.

## Critical Conventions

- Prefer shared seams before local patches.
- Use design tokens only; no raw colors.
- If UI behavior changes a reusable pattern, update [`docs/branding.md`](./docs/branding.md).
- New or changed shared UI/app surfaces must be mobile-friendly by default and checked at small-screen breakpoints in the same change.
- If routes, env vars, auth flows, or operational behavior change, update the relevant canonical docs in the same change.
- If a change touches shared seams, ingestion, routing, or other significant runtime behavior, run `pnpm build` before handing it off.
- User-facing documentation belongs in `docs/guides/`, not directly in the GitHub Wiki UI.

## References

- Primary agent guide: [`AGENTS.md`](./AGENTS.md)
- Docs hub: [`docs/index.md`](./docs/index.md)
- Visual system: [`docs/branding.md`](./docs/branding.md)
- Architecture: [`docs/architecture/overview.md`](./docs/architecture/overview.md)
- Backend data flow: [`docs/architecture/backend-data-flow.md`](./docs/architecture/backend-data-flow.md)
