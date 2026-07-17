---
title: Development
description: Review Riviamigo architecture, implementation contracts, runbooks, and contribution expectations.
slug: /development/
sidebar_label: Development
pagination_prev: roadmap
pagination_next: contributing
---

# Development

This section is the reviewable source for how Riviamigo is structured, implemented, maintained, and released. Start with contributor orientation, then follow the subsystem or operational path that owns the work.

## Contributor orientation

- [Contributing](./contributing.md) defines review, documentation, testing, security, and pull-request expectations.
- [`AGENTS.md`](../AGENTS.md) is the primary bootstrap and repository policy for repo-aware agents.
- [`CLAUDE.md`](../CLAUDE.md) is the concise command and execution companion.
- [Architecture overview](./architecture/overview.md) maps application and package ownership.

The usual local entrypoints are:

```bash
pnpm run dev:stack
pnpm typecheck
pnpm lint
pnpm test
pnpm docs:check
pnpm docs:build
```

## Architecture

- [Backend data flow](./architecture/backend-data-flow.md) follows Rivian connectivity, ingestion, storage, and API delivery.
- [Dashboard architecture](./frontend/dashboard-architecture.md) explains shared page shells, renderers, widgets, and editor ownership.
- [Rivian authentication](./rivian-auth.md) documents connection and upstream-auth behavior.

## Implementation references

- [Dashboard authoring](./frontend/dashboard-authoring.md)
- [Dashboard data map](./dashboard-data-map.md)
- [Metrics reference](./metrics-reference.md)
- [API access](./api-access.md)
- [Brand and visual system](./branding.md)
- [Security](./security.md)

## Operations and runbooks

The [runbook index](./runbooks/README.md) owns repeatable procedures for documentation publishing, backup and restore, secure deployment, releases, database cutovers, history repair, and diagnostic capture.

Use a runbook when an operation needs repeatable commands, recovery steps, or acceptance evidence. Keep durable procedures in the repository rather than in chat history or release notes.

## Governance and review

- [Security audit](./security-audit.md) records security review scope and current evidence.
- [Decision log](./decision-log.md) captures durable architectural and workflow choices.
- [Roadmap](./roadmap.md) records project direction and parity goals.

Every non-trivial change declares documentation impact, updates the owning docs with the implementation, and records focused verification close to the changed seam.
