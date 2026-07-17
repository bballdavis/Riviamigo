# Riviamigo Agent Guide

This is the primary bootstrap for Codex and other repo-aware agents working in Riviamigo.

## What Riviamigo Is

Riviamigo is a self-hosted Rivian telemetry dashboard:

- `apps/api`: Rust + Axum API, ingestion, auth, TimescaleDB access, operational routes
- `apps/web`: React + TanStack app
- `packages/dashboards`: dashboard schema, widget registry, renderer, defaults
- `packages/ui`: shared primitives, charts, tables, tokens
- `packages/hooks`: API client, auth state, React Query hooks
- `packages/types`: shared TypeScript contracts

## Canonical Document Hierarchy

Use these entrypoints in this order:

1. `AGENTS.md`
   Codex-first operating rules, repo map, workflow expectations, and doc-update triggers.
2. `CLAUDE.md`
   Companion guide for Claude-specific workflow and command detail. If guidance overlaps, prefer this file for repo policy and `CLAUDE.md` for tool-oriented execution detail.
3. `README.md`
   Human-facing project overview and quick start.
4. `docs/index.md`
   Routing hub for deeper documentation by audience and subsystem.

## Mandatory Working Rules

### Shared seams first

- Preserve shared page and dashboard behavior by changing the shared seam before patching route-local code.
- For dashboard pages, audit `DashboardPageShell`, `DashboardRenderer`, `WidgetHost`, sensor widgets, shared tables, and hooks before adding one-off behavior.
- Route files stay thin. Put reusable or page-specific composition in components, hooks, definitions, or widgets rather than route conditionals.

### Visual consistency is not optional

- `docs/branding.md` is the canonical visual system reference.
- Reuse existing primitives before inventing route-local UI chrome.
- Preserve icon family, spacing rhythm, empty/loading/error treatments, control ordering, and copy tone.
- Do not add raw colors. Use design tokens only.
- If a UI change alters a reusable pattern, update `docs/branding.md` in the same change.
- New or changed shared UI/app surfaces must be mobile-friendly by default and validated at small-screen breakpoints in the same change.

### Backend and API discipline

- New routes, config knobs, env vars, migrations, or auth flows must update the relevant docs in the same PR unless a tracked doc-debt follow-up is explicitly created.
- Keep docs aligned with actual runtime behavior; do not document intended behavior as if it is already shipped.
- Prefer compile-time-checked and typed seams over ad hoc shape widening.

### Testing expectations

- Prefer targeted verification close to the changed seam.
- Frontend: use `pnpm -C apps/web exec vitest run ...` for focused tests.
- Backend: use focused `cargo test` when full workspace validation is noisy.
- If you touch shared seams, ingestion, routing, or any other significant runtime path, run the relevant build check before handing off. In practice that means `pnpm build` for workspace-wide TypeScript/Vite changes and the relevant backend build/test command for Rust changes.
- If a behavior change affects shared UX or repo workflow, add or update verification where practical.
- For shared UI changes, include mobile breakpoint verification alongside desktop behavior instead of leaving responsive follow-up work for later.

## Documentation System

Repo docs are canonical. The [Riviamigo documentation site](https://bballdavis.github.io/Riviamigo/) is built directly from `docs/` and published to GitHub Pages after relevant changes reach `main`.

### Doc ownership

- `README.md`
  Audience: new contributors, evaluators, self-hosters landing in the repo.
- `AGENTS.md`
  Audience: Codex and other agents.
- `CLAUDE.md`
  Audience: Claude and human contributors who need command and architecture detail.
- `docs/index.md`
  Audience: anyone routing into deeper docs.
- `docs/branding.md`
  Audience: frontend contributors and reviewers.
- `docs/architecture/*`
  Audience: engineering contributors making structural changes.
- `docs/runbooks/*`
  Audience: maintainers troubleshooting or updating operations/process.
- `docs/guides/*`
  Audience: self-hosters and end users. These pages are authored in-repo and published directly through Docusaurus.

### When docs must be updated

Update docs in the same change when you modify:

- shared UI patterns, page shell behavior, spacing/icon/copy conventions
- routes, endpoints, auth flows, config, env vars, migrations, or publishing workflow
- dashboard architecture, widget authoring, or package boundaries
- troubleshooting steps, deployment behavior, backup behavior, or operational expectations

### Acceptable scope by document

- `README.md`: overview, quick start, links out
- `AGENTS.md`: agent operating model and repo workflow
- `CLAUDE.md`: companion execution guide, commands, conventions
- `docs/branding.md`: canonical visual language and UI rules
- `docs/architecture/*`: stable architecture and data-flow guidance
- `docs/runbooks/*`: operational playbooks and recurring maintenance
- `docs/guides/*`: curated user-facing material only

## Living Docs Workflow

Documentation updates are part of feature work, not cleanup.

### Documentation impact classification

Every non-trivial change should classify itself as one of:

- `No doc impact`
- `Internal doc update required`
- `Documentation site update required`
- `Both internal and user-facing docs required`

This classification belongs in the PR template and should be reflected in the changed files.

### Doc debt rule

If implementation must land before final docs:

- leave a tracked follow-up in-repo
- name the missing docs explicitly
- do not rely on chat history or implied future cleanup

### Publishing model

- Author all documentation in `docs/`; keep user installation and operation pages in `docs/guides/`.
- Run `pnpm docs:check` and `pnpm docs:build` before merging documentation-site changes.
- Relevant commits to `main` are built and published automatically to GitHub Pages.
- Do not maintain a separate hosted or generated documentation copy.

## Useful Commands

```bash
pnpm run dev:stack
pnpm typecheck
pnpm lint
pnpm test
pnpm docs:check
pnpm docs:build
pnpm -C apps/web exec vitest run src/test/<file>.test.tsx
```

## Key Links

- Contributor quick start: `README.md`
- Companion execution guide: `CLAUDE.md`
- Docs hub: `docs/index.md`
- Visual system: `docs/branding.md`
- Dashboard docs: `docs/frontend/dashboard-architecture.md`, `docs/frontend/dashboard-authoring.md`
- User-facing docs source: `docs/guides/README.md`
