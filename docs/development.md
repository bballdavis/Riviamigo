---
title: Development
description: Review Riviamigo architecture, implementation guidance, and contribution expectations.
slug: /development/
sidebar_label: Development
pagination_prev: null
pagination_next: contributing
---

# Development

This section is the reviewable source for how Riviamigo is structured, implemented, and reviewed. Start with contributor orientation, then follow the subsystem or governance path that owns the work. Deployment and recovery procedures live in [Operations](./operations.md); lookup-oriented contracts live in [Reference](./reference.md).

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

## Implementation guidance

- [Dashboard authoring](./frontend/dashboard-authoring.md)
- [Brand and visual system](./branding.md)
- [Security](./security.md)

## Governance and review

- [Documentation maintenance](./runbooks/documentation-maintenance.md) defines the publication and documentation-impact contract.
- [Security audit](./security-audit.md) records security review scope and current evidence.
- [Decision log](./decision-log.md) captures durable architectural and workflow choices.
- [Roadmap](./roadmap.md) records project direction and parity goals.

## Exact references

Use [Reference](./reference.md) for API access, metric definitions, and the dashboard data map. Keeping these lookup pages separate prevents architecture and contributor guidance from becoming dense contract inventories.

Every non-trivial change declares documentation impact, updates the owning docs with the implementation, and records focused verification close to the changed seam.
