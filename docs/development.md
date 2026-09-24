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
pnpm verify:migration-integrity
```

The development and production Compose stacks both use PostgreSQL 18 with
TimescaleDB 2.28.3, but they use separate volumes and data layouts. Keep the
development volume separate from production data.

The development launcher uses the existing `riviamigo` Compose project by
default for the infrastructure services it starts: TimescaleDB, Redis, and
Garage. Active bindings are preserved. The API, web app, and restore agent run
on the host and use independently allocated ports. To isolate a checkout deliberately, set
`DEV_COMPOSE_PROJECT_NAME` (or `COMPOSE_PROJECT_NAME`) to a unique project name
before starting it. Isolated projects use separate volumes; sharing a project
also shares its migration ledger and data, so do not point incompatible schema
revisions at the same project.

Before allocation, the launcher verifies that an existing selected project was
created from this repository's `compose/docker-compose.dev.yml`. Missing,
mixed, or production Compose identity metadata fails closed; set
`DEV_COMPOSE_PROJECT_NAME` to a unique isolated name to avoid a same-named
production project.

`pnpm dev:stack` also starts the local restore supervisor alongside the
host-run API. Its capability key is generated under the ignored `data/`
directory, while backup artifacts continue to use the local `/backups` path.
This keeps the in-app restore path testable without putting development
credentials or restore data in Git.
Vite proxies restore-runtime status requests directly to that supervisor so
the status poll can survive the API process restart.

Before allocating ports, the launcher reads the selected Compose project's
existing service metadata. Sharing a project still makes migration and
data/schema compatibility the caller's responsibility.

The local stack is HTTP-only, so `compose/docker-compose.dev.yml` and the
launcher set `RIVIAMIGO_ENV=development` and `COOKIE_INSECURE=true`. The latter
omits the cookie `Secure` attribute; without it, a browser will discard the
refresh cookie on an HTTP origin and a page reload will look like a logout.
This setting is intentionally absent from the standard production Compose
file. Production must use HTTPS and leave `COOKIE_INSECURE` unset.

The launcher builds only the API and restore-supervisor binaries that it runs;
maintenance binaries remain available through their explicit Cargo commands.
The build uses the checked-in SQLx query metadata so a brand-new development
database can compile before the API process applies its embedded migrations.
When a compile-time query changes, refresh and commit the SQLx metadata before
expecting a clean `pnpm dev:stack` startup to pass.
On Windows it limits that build to four concurrent Cargo jobs to keep the host
responsive. Set `DEV_CARGO_BUILD_JOBS` to a positive integer when a different
limit is appropriate for the machine.

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

Database migration changes also require the migration-integrity check and the
restore compatibility contract checks. Add only immutable LF/UTF-8 migrations
after the public baseline; use the explicit adoption runbook for an intentional
chain cutover.
