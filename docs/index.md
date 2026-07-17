---
title: Documentation overview
description: Choose the Riviamigo documentation path for installing, operating, or developing the project.
slug: /
sidebar_label: Overview
pagination_next: guides/README
---

# Riviamigo documentation

Riviamigo's repository documentation is the source of truth for the application, its operation, and its implementation. This site is built directly from `docs/` whenever a relevant change reaches `main`.

## Choose your path

### Install and operate Riviamigo

Follow [Getting Started](./guides/README.md) for a sequential path from host prerequisites to a verified, secure, and recoverable installation.

The path covers:

1. Preparing a host with Docker Compose and persistent storage.
2. Configuring secrets and the production environment.
3. Starting Riviamigo and connecting a Rivian account.
4. Verifying health, securing access, and learning normal operations.
5. Customizing dashboards and protecting the installation with backups.

### Understand or contribute to Riviamigo

Open the [Development documentation](./development.md) for contributor orientation, system architecture, implementation references, operational runbooks, and review expectations.

Start there when you need to answer questions such as:

- Which package or shared seam owns a behavior?
- How do telemetry, authentication, storage, and dashboards fit together?
- How should a widget, API integration, or reusable UI pattern be implemented?
- Which runbook governs releases, database changes, backups, or repairs?
- What evidence is expected before a change is merged or released?

## Popular references

| Need | Start here |
|---|---|
| See what Riviamigo currently supports | [Features](./guides/features.md) |
| Understand privacy and external requests | [Privacy](./privacy.md) |
| Review deployment security | [Security](./security.md) |
| Understand the repository structure | [Architecture overview](./architecture/overview.md) |
| Build or change dashboards | [Dashboard architecture](./frontend/dashboard-architecture.md) |
| Find a recurring maintenance procedure | [Runbooks](./runbooks/README.md) |
| Review project direction | [Roadmap](./roadmap.md) |

## Canonical entry points

- `README.md` introduces the project and provides the shortest installation summary.
- `AGENTS.md` defines repository policy for Codex and other repo-aware agents.
- `CLAUDE.md` provides companion command and execution guidance.
- `docs/branding.md` defines the shared visual system.
- This documentation site renders the complete `docs/` tree for easy navigation and review.

If behavior, structure, operations, or shared visual language changes, update its canonical document in the same pull request or create explicit tracked documentation debt.
