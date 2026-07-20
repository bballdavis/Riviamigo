# Dependency maintenance runbook

This runbook owns JavaScript, Rust, runtime, service-image, and CI dependency updates.

## Sources of truth

- `config/dependency-baselines.json` records Node, pnpm, Rust, PostgreSQL, TimescaleDB, Redis, Garage, and image baselines.
- `pnpm-workspace.yaml` owns shared JavaScript versions through the default catalog.
- `package.json` pins pnpm and the supported Node range.
- `rust-toolchain.toml` and `apps/api/Cargo.toml` pin Rust and the crate MSRV.
- Dockerfiles and Compose files pin stable patch tags plus multi-architecture manifest digests.

Keep Lucide, Iconify, and React Icons. They serve app-native, dynamic catalog, and specialized icon-family use cases respectively. Recharts, uPlot, and react-grid-layout are also intentional specialized dependencies.

## Routine update sequence

1. Work from a clean worktree and record direct dependency, lockfile, duplicate, bundle, crate, and image-size baselines.
2. Run `pnpm deps:check` before and after changes. Shared dependencies must use `catalog:` and imports must be declared by the package that owns them.
3. Group patch and minor updates. Keep major updates isolated so migrations and rollback are reviewable.
4. Run `pnpm install --frozen-lockfile`, peer checks, typecheck, lint, tests, production build, docs build, and Storybook build.
5. Run Cargo format, Clippy, all-target checks/tests, `cargo tree --duplicates`, SQLx prepare/check, and `cargo audit --deny warnings`.
6. Build and scan clean amd64 and arm64 images. Smoke-test development and production fresh installs.
7. For PostgreSQL majors, use dump/restore into a new volume only. Validate a second recovery-package restore before release.
8. Record results in a dated dependency-modernization report under `docs/`.

## Automation policy

Dependabot monitors Cargo, npm, GitHub Actions, Dockerfiles, and Compose. Patch/minor changes are grouped; majors remain separate. CI rejects catalog drift, undeclared/unused dependencies, peer failures, lockfile drift, unsupported runtime references, high/critical npm or Rust advisories, leaked secrets, and high/critical container findings.

Do not add unbounded advisory exceptions. Any temporary exception needs an owner, upstream link, expiry, and removal condition.
