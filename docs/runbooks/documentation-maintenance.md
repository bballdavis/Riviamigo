# Documentation Maintenance Runbook

## Audience

Maintainers and agents updating canonical docs or publishing wiki content.

## Source Of Truth

This document is canonical for the documentation upkeep workflow.

## Canonical Model

- Repo docs are canonical.
- `docs/guides/` is the source for user-facing wiki pages.
- The GitHub Wiki is a publish target only.

## Update Procedure

1. Update the relevant canonical docs in the repo.
2. If the change is user-facing, update the corresponding page in `docs/guides/`.
3. Run `pnpm docs:check`.
4. If publishability is the only thing you need to verify, run:
   `scripts/publish-wiki.sh --validate-only`
5. After review and merge, publish with:
   `scripts/publish-wiki.sh`

## When Docs Must Change

- visual pattern changes: update `docs/branding.md`
- repo structure or seam changes: update `docs/index.md` and relevant architecture docs
- env vars, routes, or operational behavior: update relevant canonical docs and wiki drafts if user-visible
- publishing workflow changes: update this runbook and `docs/guides/README.md`

## Failure Modes

- `pnpm docs:check` fails on a missing file link
  Fix the link or restore the referenced file.
- `pnpm docs:check` fails on env vars
  Add the missing env var to `.env.example` or remove the stale doc reference.
- `pnpm docs:check` fails on route or API contracts
  Update the contract in `scripts/check-docs.mjs` or bring docs/code back into alignment.
- `scripts/publish-wiki.sh --validate-only` fails
  Resolve filename collisions or missing wiki draft files before publishing.
