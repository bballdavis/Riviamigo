# Wiki Drafts

This directory contains the repo-owned source for Riviamigo user-facing documentation.

## Canonical Model

- These files are authored and reviewed in the main repo.
- The GitHub Wiki is a published mirror only.
- Do not edit wiki pages directly in the GitHub UI.

## Validation And Publishing

- Validate draft naming and publishability:
  `scripts/publish-wiki.sh --validate-only`
- Run repo-level documentation checks:
  `pnpm docs:check`
- Publish reviewed drafts to the Wiki:
  `scripts/publish-wiki.sh`

## Waves

- Wave 1: developer and contributor onboarding
- Wave 2: self-hosting and operational setup
- Later waves: additional product, auth, security, and maintenance guidance as the canonical repo docs evolve
