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

## Review Process

Every non-trivial change follows the same review path, whether it was written by a person, an AI assistant, or both:

1. Trace the owning seam before editing. Shared dashboard, ingestion, auth, storage, and API behavior belongs at its shared boundary rather than in a route-local exception.
2. Describe the behavior change, risks, documentation impact, and verification in the pull request.
3. Run the smallest focused checks first, then the broader build or backend checks required by the touched seam.
4. Have a human reviewer inspect the diff and the resulting behavior. Auth, Rivian credentials, vehicle controls, migrations, backups, infrastructure, and privacy-sensitive telemetry require explicit security and failure-mode review.
5. Do not merge with unexplained failing checks, untracked documentation debt, or generated files in the commit.

AI assistants may help with repository exploration, code, tests, documentation, or review preparation. They do not replace human ownership or approval. Never share secrets, tokens, private keys, production telemetry, or precise vehicle locations with an assistant. Use redacted or synthetic fixtures and record the human verification that supports the change.

### Demo fixture workflow

The checked-in demo profile is aggregate-only and versioned under `apps/api/fixtures/demo/`. A human may regenerate it with `export_demo_history_fixture`, selecting one reviewed development vehicle and a 14-day window. The exporter writes the sanitized fixture directly and must never create a raw intermediate file. Review the allowlisted JSON diff before accepting it; identifiers, absolute timestamps, addresses, coordinates, route geometry, raw payloads, and non-aggregate sensor values are prohibited.

The API embeds the reviewed profile and owns all demo generation. Do not add parallel SQL seed scripts or make demo creation depend on web assets, external geocoding, weather providers, or a live Rivian session. Changes to fixture schema, public routes, model capability profiles, or density bounds require privacy review and the focused exporter/seeder tests.

## CI Coverage

CI is organized into independently visible workflows so contributors can rerun
the evidence closest to their change:

The full validation suite runs on pull requests targeting `dev` or `main`, not
on every push to either protected branch. Container images are published only
by intentional release workflows: stable images from a validated `main` tag
and pre-release images from an approved `dev` candidate.

The normal PR gate is six checks: frontend validation, browser E2E, backend,
runtime/deployment, quality, and security. Fresh-install acceptance remains
available through manual workflow dispatch for release or installation changes;
vehicle-artwork validation remains path-filtered.

| Area | Current checks |
| --- | --- |
| Quality | Repository hygiene, linting, design-token guard, docs check, and dashboard-default drift |
| Frontend | Typecheck, unit tests with coverage, Storybook build, and Playwright browser tests |
| Backend | `cargo fmt --check`, SQLx offline metadata, Clippy with warnings denied, all non-ignored Rust tests and isolated integration suites, and coverage |
| Runtime/deployment | Fresh TimescaleDB migrations, migration idempotency, API health probe, production Compose validation, and container build |
| Security | `cargo audit`, production `pnpm audit` at high severity, Gitleaks, Semgrep, and Trivy |

Dependency and secret failures are release blockers. High-risk Semgrep
findings and critical/high Trivy findings are also blocking. Any reviewed
exception must be time-bounded, recorded in the PR, and linked to remediation;
it must not be silently waived. CI provides repeatable evidence, not a security
certification or a replacement for human review. Release and exposure decisions
should also consult [`SECURITY.md`](../SECURITY.md), [`security.md`](./security.md),
and [`security-audit.md`](./security-audit.md).

## Review Expectations

- Review shared UX against [`branding.md`](./branding.md), not only local page intent.
- Review structural changes against [`architecture/overview.md`](./architecture/overview.md).
- Reject docs that describe intended behavior which the code does not yet implement.
- Prefer small, durable documents over ad hoc notes in PRs or chat.

## Required Checks

- Run `pnpm docs:check` when docs, env vars, routes, or publishing workflow changes.
- Run the focused tests closest to the changed seam.
- Keep user-facing docs in `docs/guides/`; do not author in the GitHub Wiki UI.

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
