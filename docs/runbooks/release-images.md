# Release Images

This runbook owns Riviamigo's public container-image release process. The API, web application, nginx configuration, and backup tooling ship together as `ghcr.io/bballdavis/riviamigo`.

## One-time GitHub setup

Before the first release, configure both generated GHCR packages as public and confirm anonymous `docker pull` works. The publishing workflows add the OCI source label that links each package to this repository; keep inherited repository permissions enabled and grant this repository Actions admin access to each package.

Enable immutable releases in repository settings. Add a tag ruleset for `YYYY.MM.PATCH` tags that prevents deletion and force-moves, while allowing the release workflow to create tags. Protect `main` and `dev` and require the pull-request validation checks before merging. The release workflow requires repository Actions permission to write contents, packages, attestations, and OIDC tokens; do not replace its `GITHUB_TOKEN` with a long-lived personal token.

## Stable releases

Stable releases use bare Calendar Versions: `YYYY.MM.PATCH`. The first release in July 2026 is `2026.07.0`; a later July release is `2026.07.1`.

1. Ensure `main` is the intended, validated release commit.
2. Run **Prepare calendar release** from Actions. It calculates the next UTC monthly patch number and pushes the protected tag.
3. **Publish release image** builds the unified image for `linux/amd64` and `linux/arm64`, pushes the exact version plus `latest`, records its provenance attestation, verifies the manifest, and creates the GitHub release with `images.lock`.
4. Treat the `images.lock` digests as the immutable release identifiers. `latest` is a moving convenience tag; self-hosters who require repeatability should pin `IMAGE_TAG` to the exact Calendar Version.

If image publication or manifest verification fails, no GitHub release is created. Correct the failure before creating another release tag; immutable releases intentionally make published release tags non-reusable.

## Pre-release images from dev

Pre-release publishing is manual and does not run for ordinary commits or
merges into `dev`. After the candidate has passed its pull-request checks,
run **Publish pre-release images** from Actions and provide a version such as
`2026.07.0-rc.1`, `2026.07.0-beta.1`, or `2026.07.0-alpha.1`.

The workflow builds the current `dev` commit for `linux/amd64` and
`linux/arm64`, pushes only the exact pre-release image tags, records
provenance attestations, runs the published-image smoke test, and creates a
GitHub pre-release. It never updates `latest`.
The GitHub pre-release tag is created at the exact `dev` commit used for the
build.

## Source and image verification

- Normal self-hosted deployments use `compose/docker-compose.yml` and pull published images.
- Source candidates use the `compose/docker-compose.build.yml` overlay. Fresh-install acceptance passes `--source-build` so it tests the candidate rather than an older published image.
- A published release must be checked by pulling its exact Calendar Version and verifying the image digest in the GitHub release asset before announcing it.
