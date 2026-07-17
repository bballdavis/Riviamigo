# Documentation maintenance

## Audience

Maintainers and agents updating canonical documentation or the published documentation site.

## Source of truth

This document is canonical for documentation upkeep and publishing.

## Canonical model

- The repository `docs/` tree is canonical.
- `docs/guides/` owns the sequential installation and operation path for self-hosters.
- `docs/development.md` and the development sidebar route contributors into architecture, implementation references, runbooks, and governance.
- `apps/docs` contains the Docusaurus presentation, navigation, search, and GitHub Pages configuration. It does not duplicate documentation content.
- Relevant commits to `main` are the only public deployment trigger.
- Pull requests validate the production site but never publish it.

## Update procedure

1. Update the owning Markdown file in `docs/` with the behavior or structural change.
2. Keep each document in exactly one logical sidebar path: Overview, Getting Started, Using Riviamigo, Operations, Development, or Reference.
3. Add frontmatter only when a stable route, title, description, or navigation label is needed.
4. Run:

   ```bash
   pnpm docs:check
   pnpm docs:build
   ```

5. For visual or navigation changes, serve the production output:

   ```bash
   pnpm docs:serve
   ```

6. Verify desktop and small-screen navigation, light and dark themes, representative deep links, and local search.
7. Merge through the normal review flow. When the relevant commit reaches `main`, the Pages workflow publishes `apps/docs/build`.

## Local authoring

Use the development server while writing content or styling:

```bash
pnpm docs:dev
```

The local search index is generated only by the production build. Use `pnpm docs:build` followed by `pnpm docs:serve` to test search.

## When docs must change

- Visual pattern or token changes: update `docs/branding.md` and verify the Docusaurus theme adapter.
- Repository structure or ownership changes: update `docs/index.md`, `docs/development.md`, and the relevant architecture document.
- Environment variables, routes, auth, backups, or operational behavior: update the applicable guide and maintainer reference.
- Publishing, navigation, or search changes: update this runbook and the Docusaurus application.

## Publishing contract

The Pages workflow runs only for a push to `main` that changes a documentation-site input. It installs the frozen pnpm graph, runs the documentation checks, builds Docusaurus, uploads `apps/docs/build`, and deploys through the `github-pages` environment.

Do not:

- publish from `dev`, feature branches, pull requests, schedules, or manual dispatch
- commit `apps/docs/build` or `.docusaurus`
- maintain a second hosted documentation copy outside `docs/`
- create a parallel generated-documents branch
- add deployment PATs or long-lived Pages secrets

## Failure modes

- `pnpm docs:check` reports a missing canonical file or obsolete publishing language
  Restore the required file or update the obsolete documentation contract.
- `pnpm docs:check` reports a broken local link
  Correct the canonical Markdown target; do not suppress the check.
- `pnpm docs:build` reports a broken internal route
  Correct the document path, slug, sidebar ID, or anchor.
- `pnpm docs:build` reports a broken repository link
  Restore or correct the referenced file. Links outside `docs/` are converted to GitHub source URLs only when the target exists.
- Search is empty under `pnpm docs:dev`
  This is expected. Build and serve the production site to test the static index.
- The live site loads without CSS or images
  Confirm the production `url` is `https://riviamigo.com`, `baseUrl` is `/`, and assets use Docusaurus-aware URLs.
- The Pages deployment does not run
  Confirm the commit reached `main`, changed a configured path, and that repository Pages source is set to **GitHub Actions**.

## Go-live settings

Repository administrators must set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. After a successful live deployment and link audit, disable the repository's legacy knowledge-base feature under **Settings → Features**.
