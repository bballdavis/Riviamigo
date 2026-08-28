# Release Images

This runbook owns Riviamigo's public container-image release process. The API, web application, nginx configuration, and backup tooling ship together as `ghcr.io/bballdavis/riviamigo`.

## One-time GitHub setup

Before the first release, configure both generated GHCR packages as public and confirm anonymous `docker pull` works. The publishing workflows add the OCI source label that links each package to this repository; keep inherited repository permissions enabled and grant this repository Actions admin access to each package.

Enable immutable releases in repository settings. Add a tag ruleset for `YYYY.MM.PATCH` tags that prevents deletion and force-moves, while allowing the release workflow to create tags. Protect `main` and `dev` and require the pull-request validation checks before merging. The release workflow requires repository Actions permission to write contents, packages, attestations, and OIDC tokens; do not replace its `GITHUB_TOKEN` with a long-lived personal token.

## Stable releases

Stable releases use bare Calendar Versions: `YYYY.MM.PATCH`. The first release in July 2026 is `2026.07.0`; a later July release is `2026.07.1`.

1. Ensure `main` is the intended, validated release commit.
2. Run **Release prep** from Actions. It calculates the next UTC monthly patch number and pushes the protected tag.
3. **Release image** builds the unified image for `linux/amd64` and `linux/arm64`, pushes the exact version plus `latest`, records its provenance attestation, verifies the manifest, and creates the GitHub release with `images.lock`.
4. Treat the `images.lock` digests as the immutable release identifiers. `latest` is a moving convenience tag; self-hosters who require exact repeatability should set `RIVIAMIGO_IMAGE` to the digest-qualified reference from `images.lock`. Pinning `IMAGE_TAG` to the Calendar Version is stable for normal use but is not as strong as a digest.

Before pushing a release tag, run `pnpm verify:release-image -- --no-cache`. It
builds the same `linux/amd64,linux/arm64` image locally without pushing it and
fails after 45 minutes instead of leaving a release check running indefinitely.
In GitHub Actions, AMD64 and ARM64 build independently on native runners and
push digest-addressed platform images. A final job verifies that both digests
exist, assembles the version manifest (and `latest` for stable releases), and
attests that merged multi-architecture digest before any release checks begin.
The smoke and populated-upgrade gates both pull that exact digest rather than a
mutable version tag, so release approval is bound to the manifest written to
`images.lock`.

Each platform has a durable GHCR BuildKit cache at
`buildcache-amd64` or `buildcache-arm64`, with a small platform-scoped GitHub
Actions cache as a fallback. The registry cache retains intermediate Rust
layers across release tags; the fallback intentionally uses the minimal cache
mode to avoid uploading the full Rust target directory to Actions storage.
Platform build duration and manifest assembly duration are written to the
workflow summary. Treat the first run after this cache layout changes as the
cold-cache baseline and compare the following run to measure warm-cache gains.
The published-image smoke verifier prints the app container's last 200 log lines
when startup or endpoint verification fails, so runtime failures are visible in
the Actions job instead of only appearing as a health-check timeout.

If image publication or manifest verification fails, no GitHub release is created. Correct the failure before creating another release tag; immutable releases intentionally make published release tags non-reusable.

## Pre-release images from dev

Pre-release publishing is manual and does not run for ordinary commits or
merges into `dev`. After the candidate has passed its pull-request checks,
run **Preview image** from Actions and provide a version such as
`2026.07.0-rc.1`, `2026.07.0-beta.1`, or `2026.07.0-alpha.1`.

The workflow builds the current `dev` commit on separate native AMD64 and ARM64
runners, merges their digest-addressed outputs, pushes only the exact
pre-release image tag, records provenance for the merged digest, runs the
published-image smoke test, and creates a GitHub pre-release. It never updates
`latest`.
The GitHub pre-release tag is created at the exact `dev` commit used for the
build.

## Source and image verification

- Normal self-hosted deployments use `compose/docker-compose.yml` and pull published images.
- Source candidates use the `compose/docker-compose.build.yml` overlay. Fresh-install acceptance passes `--source-build` so it tests the candidate rather than an older published image.
- A published release must be checked by pulling its exact Calendar Version and verifying the image digest in the GitHub release asset before announcing it.

## Charge identity upgrade acceptance

The release candidate must preserve the unified app-container topology. The
charge identity migration is an expand step: the app must become healthy
without waiting for a full-table rewrite, and the resumable backfill then runs
in-process in the background. Validate this with a disposable database
containing synthetic charge payloads, checking that the health probe succeeds
first, the worker makes progress, retries remain safe, and the final identity
state is complete and idempotent. Never use real telemetry in the fixture.

The runtime workflow constructs this populated pre-upgrade ledger with the
CI-only `verify:populated-upgrade` harness. Stable and preview release workflows
repeat the same check against the published `linux/amd64` and `linux/arm64`
image variants before creating the GitHub release. A failure blocks release
creation; do not emulate the check by adding another application container or
by rewriting immutable migration files in the workflow.

The harness requires an explicit loopback `UPGRADE_DATABASE_URL` whose database
name starts with `riviamigo_upgrade`; it never falls back to `DATABASE_URL`.
This database is dropped and recreated, so it must remain disposable.
