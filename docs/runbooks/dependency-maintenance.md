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

Dependabot monitors Cargo, npm, GitHub Actions, Dockerfiles, and Compose. Patch/minor changes are grouped; majors remain separate. CI rejects catalog drift, undeclared/unused dependencies, peer failures, lockfile drift, unsupported runtime references, high/critical npm or Rust advisories, leaked secrets, and fixable high/critical container findings. Unfixed base-image findings stay in Trivy output and require review whenever the pinned base digest changes.

Do not add unbounded advisory exceptions. Any temporary exception needs an owner, upstream link, expiry, and removal condition.

## Maintenance register

This register records accepted maintenance debt that is not release-blocking.
Each entry needs an owner, evidence, a due date, and a closure check. Do not
use it to waive a security, privacy, data-integrity, or availability defect.

| Priority | Item | Owner | Evidence and current control | Due date | Closure evidence |
| --- | --- | --- | --- | --- | --- |
| P3 | RustSec warning exception: `RUSTSEC-2026-0173` | Release maintainer | `.github/workflows/security.yml` blocks CI after **2026-10-01** and ignores this unmaintained `age` → `i18n-embed-fl` procedural-macro chain until an upstream-compatible release is available. | 2026-10-01 | Remove the ignore after the dependency chain is replaced, then attach a clean `cargo audit --deny warnings` result. |
| P3 | RustSec warning exception: `RUSTSEC-2023-0071` | Release maintainer | `.github/workflows/security.yml` time-bounds the ignore through **2026-12-31**; `openidconnect 4.0.1` brings `rsa 0.9.10` for provider ID-token signature verification. The callback uses public-key verification only; [RustSec reports no patched release](https://rustsec.org/advisories/RUSTSEC-2023-0071.html). | 2026-12-31 | Remove the ignore when a fixed upstream release is available or the verifier no longer depends on `rsa`, then attach clean `cargo audit` output. |
| P3 | Asset optimization | Frontend maintainer | No source-backed performance budget or image/asset optimization evidence is currently recorded. The artwork workflow validates fallback correctness, not total transfer-size optimization. | 2026-10-01 | Record a repeatable baseline, optimize the identified assets without visual regression, and attach desktop/mobile verification. |
| P3 | Unproven dead exports | Frontend maintainer | `pnpm deps:check` invokes Knip, but the current repository has no reviewed export-by-export disposition proving all reported candidates are safe to remove. | 2026-10-01 | Attach reviewed Knip output, remove confirmed dead exports with focused tests, and document any intentional public/package exports. |

Review this register during dependency maintenance and release preparation. If a
date passes without closure, either resolve the entry or explicitly reassess its
priority and risk in a pull request; do not silently extend it.
