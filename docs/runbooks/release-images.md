# Release Images

This runbook owns Riviamigo's public container-image release process. It applies to the two images published to GitHub Container Registry (GHCR): `ghcr.io/bballdavis/riviamigo-api` and `ghcr.io/bballdavis/riviamigo-web`.

## One-time GitHub setup

Before the first release, configure both generated GHCR packages as public and confirm anonymous `docker pull` works. The publishing workflows add the OCI source label that links each package to this repository; keep inherited repository permissions enabled and grant this repository Actions admin access to each package.

Enable immutable releases in repository settings. Add a tag ruleset for `YYYY.MM.PATCH` tags that prevents deletion and force-moves, while allowing the release workflow to create tags. Protect `main` and `dev`: the privileged development publisher accepts only successful CI runs from this repository's `dev` branch. The release workflow requires repository Actions permission to write contents, packages, attestations, and OIDC tokens; do not replace its `GITHUB_TOKEN` with a long-lived personal token.

## Stable releases

Stable releases use bare Calendar Versions: `YYYY.MM.PATCH`. The first release in July 2026 is `2026.07.0`; a later July release is `2026.07.1`.

1. Ensure `main` is the intended, validated release commit.
2. Run **Prepare calendar release** from Actions. It calculates the next UTC monthly patch number and pushes the protected tag.
3. **Publish release images** builds API and web images for `linux/amd64` and `linux/arm64`, pushes the exact version plus `latest`, records provenance attestations, verifies both published manifests, and creates the GitHub release with `images.lock`.
4. Treat the `images.lock` digests as the immutable release identifiers. `latest` is a moving convenience tag; self-hosters who require repeatability should pin `IMAGE_TAG` to the exact Calendar Version.

If image publication or manifest verification fails, no GitHub release is created. Correct the failure before creating another release tag; immutable releases intentionally make published release tags non-reusable.

## Development images and cleanup

After successful `Quality`, `Frontend`, `Backend`, `Security`, and `Runtime`
workflow runs for the same commit on `dev`, **Publish development images**
updates the `edge` tag and creates an immutable `sha-<commit>` tag for each
image. The publisher verifies those exact-commit conclusions before it can
publish. These are development artifacts, not GitHub prereleases and not a
stable deployment channel.

**Clean expired development images** runs weekly. Run it manually with `dry_run=true` first when investigating retention. It retains every Calendar Version, `latest`, the current `edge` image, and its SHA tag. It deletes only SHA-only versions older than 30 days and deliberately ignores untagged manifests so a multi-architecture image cannot lose a platform child.

GitHub can restore a deleted package version for only 30 days. Stable images are therefore protected by exact tags and by never being cleanup candidates; package deletion remains an administrator action that must be avoided.

## Source and image verification

- Normal self-hosted deployments use `compose/docker-compose.yml` and pull published images.
- Source candidates use the `compose/docker-compose.build.yml` overlay. Fresh-install acceptance passes `--source-build` so it tests the candidate rather than an older published image.
- A published release must be checked by pulling its exact Calendar Version and verifying the two image digests in the GitHub release asset before announcing it.
