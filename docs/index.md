---
title: Documentation overview
description: Choose the Riviamigo documentation path for installing, using, operating, or developing the project.
slug: /
sidebar_label: Overview
pagination_prev: null
pagination_next: guides/features
---

# Riviamigo documentation

Riviamigo's repository documentation is the source of truth for the application, its operation, and its implementation. This site is built directly from `docs/` whenever a relevant change reaches `main`.

## Choose your path

| If you want to... | Start here |
|---|---|
| Understand the project, privacy model, security posture, or roadmap | **Overview** — continue through this section |
| Prepare, install, connect, and verify a new installation | [Getting Started](./guides/README.md) |
| Customize dashboards or control optional external services | [Using Riviamigo](./using-riviamigo.md) |
| Update, secure, back up, recover, or troubleshoot an installation | [Operations](./operations.md) |
| Understand architecture or contribute code and documentation | [Development](./development.md) |
| Look up APIs, metrics, or dashboard data contracts | [Reference](./reference.md) |

## Common tasks

| Need | Start here |
|---|---|
| See what Riviamigo currently supports | [Features](./guides/features.md) |
| Understand privacy and external requests | [Privacy](./privacy.md) |
| Review deployment security | [Security](./security.md) |
| Customize an installed dashboard | [Using Riviamigo](./using-riviamigo.md) |
| Update or recover an installation | [Operations](./operations.md) |
| Understand the repository structure | [Architecture overview](./architecture/overview.md) |
| Build or change dashboards | [Dashboard architecture](./frontend/dashboard-architecture.md) |
| Look up APIs, metrics, or dashboard data | [Reference](./reference.md) |

## Canonical entry points

- `README.md` introduces the project and provides the shortest installation summary.
- `AGENTS.md` defines repository policy for Codex and other repo-aware agents.
- `CLAUDE.md` provides companion command and execution guidance.
- `docs/branding.md` defines the shared visual system.
- This documentation site renders the complete `docs/` tree for easy navigation and review.

If behavior, structure, operations, or shared visual language changes, update its canonical document in the same pull request or create explicit tracked documentation debt.
