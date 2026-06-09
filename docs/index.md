# Riviamigo Docs Index

This is the routing hub for repo documentation. Repo docs are canonical; the GitHub Wiki is a published mirror for selected user-facing pages sourced from `docs/wiki-drafts/`.

## Canonical Entry Points

| Document | Audience | Source of truth | Update when | Scope |
|---|---|---|---|---|
| `README.md` | New contributors, evaluators, self-hosters | Repo root | onboarding, quick-start, top-level architecture changes | concise overview and links out |
| `AGENTS.md` | Codex and repo-aware agents | Repo root | workflow, documentation policy, shared engineering expectations change | agent bootstrap |
| `CLAUDE.md` | Claude and human contributors | Repo root | command workflows or companion guidance change | execution-focused companion |
| `docs/branding.md` | Frontend contributors and reviewers | `docs/branding.md` | shared visual patterns, tokens, icon rules, spacing, copy patterns change | canonical visual system |

## Engineering Internals

| Document | Audience | Update when | Adjacent docs |
|---|---|---|---|
| [`docs/architecture/overview.md`](./architecture/overview.md) | contributors changing repo structure | package boundaries, ownership, or architectural seams shift | frontend architecture, backend data flow |
| [`docs/architecture/backend-data-flow.md`](./architecture/backend-data-flow.md) | backend contributors | ingestion, auth, storage, or API flow changes | API access, Rivian auth, security |
| [`docs/frontend/dashboard-architecture.md`](./frontend/dashboard-architecture.md) | frontend/dashboard contributors | dashboard shell, renderer, registry, widget seam changes | dashboard authoring, branding |
| [`docs/frontend/dashboard-authoring.md`](./frontend/dashboard-authoring.md) | widget/dashboard authors | widget authoring flow changes | dashboard architecture, branding |
| [`docs/rivian-auth.md`](./rivian-auth.md) | auth/connection contributors | Rivian auth flow or upstream drift changes local behavior | API access, backend data flow |
| [`docs/api-access.md`](./api-access.md) | API consumers and maintainers | auth headers, API-key flow, or local testing access changes | security, README |
| [`docs/security.md`](./security.md) | maintainers | auth, headers, secrets, or operational security expectations change | backend data flow, runbooks |
| [`docs/dashboard-data-map.md`](./dashboard-data-map.md) | telemetry and dashboard contributors | field mapping, parity targets, or dashboard contract changes | metrics reference |
| [`docs/metrics-reference.md`](./metrics-reference.md) | backend and dashboard contributors | metrics catalog or meaning changes | dashboard data map |

## Visual System

| Document | Audience | Update when | Adjacent docs |
|---|---|---|---|
| [`docs/branding.md`](./branding.md) | designers, frontend contributors, reviewers | shared visual language or reusable patterns change | dashboard architecture, contributing |

## Operations and Maintenance

| Document | Audience | Update when | Adjacent docs |
|---|---|---|---|
| [`docs/contributing.md`](./contributing.md) | contributors and reviewers | workflow, review rules, testing expectations, or doc policy changes | AGENTS, CLAUDE |
| [`docs/runbooks/README.md`](./runbooks/README.md) | maintainers | runbook taxonomy or recurring maintenance surface changes | documentation maintenance |
| [`docs/runbooks/documentation-maintenance.md`](./runbooks/documentation-maintenance.md) | maintainers and agents | doc publishing or drift-prevention workflow changes | wiki drafts, contributing |
| [`docs/decision-log.md`](./decision-log.md) | maintainers and future contributors | durable repo/process decisions are made | contributing, architecture |

## User-Facing Documentation

| Document | Audience | Source of truth | Update when | Scope |
|---|---|---|---|---|
| [`docs/wiki-drafts/README.md`](./wiki-drafts/README.md) | maintainers publishing docs | repo | wiki workflow changes | publishing rules |
| `docs/wiki-drafts/*.md` | self-hosters and end users | repo, mirrored to GitHub Wiki | user-visible setup, operations, or product behavior changes | curated user-facing subset |

## Documentation Rules

- Repo docs are canonical.
- The Wiki is a mirror, not an authoring surface.
- If a change affects shared behavior, update the relevant doc in the same PR or leave explicit tracked doc debt.
- Run `pnpm docs:check` before merging documentation-heavy changes.
