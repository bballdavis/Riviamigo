# Contributing

## Audience

Human contributors, reviewers, and agents making code or documentation changes.

## Source Of Truth

This document is canonical for repo workflow and documentation expectations. Update it when review policy, required checks, or doc workflow changes.

## Default Workflow

1. Start from the canonical entrypoints:
   `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/index.md`
2. Change the shared seam before patching a route-local symptom.
3. Verify close to the changed seam.
4. Update docs in the same change when behavior, structure, or operational guidance changes.

## Documentation Impact Classification

Every non-trivial PR should declare one of:

- `No doc impact`
- `Internal doc update required`
- `User-facing doc/wiki update required`
- `Both internal and user-facing docs required`

If the classification is not `No doc impact`, the PR should either include the docs change or explicitly track doc debt.

## Documentation Triggers

Update docs when you change:

- shared UI patterns, branding, tokens, spacing, icon rules, or page shell behavior
- routes, endpoints, env vars, config knobs, migrations, or auth/backup behavior
- dashboard architecture, widget authoring flow, or package boundaries
- troubleshooting guidance or maintainer procedures

## Review Expectations

- Review shared UX against [`branding.md`](./branding.md), not only local page intent.
- Review structural changes against [`architecture/overview.md`](./architecture/overview.md).
- Reject docs that describe intended behavior which the code does not yet implement.
- Prefer small, durable documents over ad hoc notes in PRs or chat.

## Required Checks

- Run `pnpm docs:check` when docs, env vars, routes, or publishing workflow changes.
- Run the focused tests closest to the changed seam.
- Keep user-facing docs in `docs/wiki-drafts/`; do not author in the GitHub Wiki UI.

## Doc Debt

If docs cannot land immediately:

- create a tracked follow-up in-repo
- state exactly which docs are missing
- avoid vague “update docs later” notes

## Adjacent Docs

- [`../AGENTS.md`](../AGENTS.md)
- [`../CLAUDE.md`](../CLAUDE.md)
- [`branding.md`](./branding.md)
- [`runbooks/documentation-maintenance.md`](./runbooks/documentation-maintenance.md)
