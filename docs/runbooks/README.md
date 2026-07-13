# Runbooks

## Audience

Maintainers and agents handling recurring maintenance, publishing, or troubleshooting work.

## Source Of Truth

This directory is canonical for operational and process runbooks. Update it when a recurring task needs stable step-by-step guidance.

## Current Runbooks

- [`documentation-maintenance.md`](./documentation-maintenance.md)
  How to keep repo docs and wiki drafts live, validate them, and publish safely.
- [`vehicle-history-rebuild.md`](./vehicle-history-rebuild.md)
  How the one-off vehicle history rebuild works, what it replays, and how post-replay trip enrichment is restored.
- [`secure-deployment.md`](./secure-deployment.md)
  Required authenticated-gateway posture, production secret requirements, and verification steps for shared instances.
- [`release-images.md`](./release-images.md)
  Calendar Version releases, public GHCR images, development-image retention, and recovery steps.

## When To Add A Runbook

Add a runbook when:

- a maintainer task is repeated often enough to justify stable steps
- an operational workflow is easy to forget or easy to do inconsistently
- a change introduces new recovery, publishing, or verification steps
