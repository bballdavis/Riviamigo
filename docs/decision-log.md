# Decision Log

Use this file for short, durable process and documentation decisions that should survive chat history.

## 2026-06-09

### Documentation system

- `AGENTS.md` is the primary Codex/bootstrap document for Riviamigo.
- `CLAUDE.md` remains first-class, but acts as a companion guide rather than a competing source of truth.
- Repo docs are canonical; the Docusaurus site renders the complete `docs/` tree and publishes relevant `main` commits to GitHub Pages.

### Documentation governance

- Non-trivial changes must classify documentation impact in the PR template.
- If behavior, structure, or operations change, docs update in the same PR is the default expectation.
- If docs cannot land immediately, tracked doc debt is required.

### Drift prevention

- `pnpm docs:check` is the lightweight repo check for canonical file presence, markdown-link validity, env-var coverage, route/API contracts, and documentation-site policy.
- `pnpm docs:build` validates production Docusaurus routes, navigation, assets, and local search before publication.
