# Unification and debloat baseline

Captured on 2026-08-20 for `refactor/unification-debloat` at `fcd6ed9d41127cec0f40468672de081a1e8eff6c`.

This document is the measured starting point for the behavior-preserving unification initiative described in the review plan. Counts are intentionally scoped and reproducible; they are not a claim that every similar implementation in the repository has been found.

## Branch state

The source trees were identical before normalization even though `dev` had five merge-history commits to catch up. The prescribed fast-forward procedure was completed and pushed:

- `origin/main`: `fcd6ed9d41127cec0f40468672de081a1e8eff6c`
- normalized `origin/dev`: `fcd6ed9d41127cec0f40468672de081a1e8eff6c`
- `git diff origin/main...origin/dev`: empty
- implementation branch: `refactor/unification-debloat`

## Verification baseline

| Command | Result | Evidence or limitation |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Pass | pnpm 11.15.1; all eight workspace projects already up to date |
| `pnpm verify` | Pre-existing failure | lint, typecheck, docs, dependency policy, route security, dashboard sync, package tests, and script tests passed; API integration tests failed before application assertions because the test database pool timed out |
| `pnpm build` | Pass | Web and documentation production builds completed; existing large-chunk warning remains |
| `pnpm test:e2e` | Environment failure | Playwright startup stopped on Node `Unknown file extension ".css"` for `uplot/dist/uPlot.min.css` before any E2E test ran |
| `pnpm docs:build` | Pass | Docusaurus build and search-index validation completed |
| `cargo fmt --manifest-path apps/api/Cargo.toml --all --check` | Pass | — |
| `cargo clippy --manifest-path apps/api/Cargo.toml --all-targets --all-features -- -D warnings` | Pass | Existing future-incompatibility warning is emitted by a dependency, not clippy |
| `cargo test --manifest-path apps/api/Cargo.toml --all --all-features` | Pre-existing failure | 292 unit tests passed and 43 were ignored; 32 auth/integration tests failed at `admin db connect: PoolTimedOut` |

The API failures are recorded as baseline limitations. They must not be attributed to later refactor changes without a working test database and a new comparison run.

## Hotspot size baseline

The ratchet stores these values in [`config/architecture-budgets.json`](../../config/architecture-budgets.json). A listed file may shrink but may not exceed its initial line or byte budget. Byte counts are normalized to LF before measurement so Windows checkout EOL conversion cannot reject unchanged source.

| File | Lines | Bytes |
| --- | ---: | ---: |
| `apps/web/src/features/settings/SettingsPage.tsx` | 1,866 | 97,620 |
| `apps/web/src/components/settings/BackupSection.tsx` | 1,700 | 71,666 |
| `apps/web/src/components/layout/AppLayout.tsx` | 430 | 16,120 |
| `apps/web/src/components/dashboard/DashboardPageShell.tsx` | 485 | 18,178 |
| `apps/api/src/routes/vehicles.rs` | 5,597 | 198,198 |
| `apps/api/src/routes/charging.rs` | 2,242 | 83,776 |
| `apps/api/src/routes/trips.rs` | 1,833 | 65,504 |
| `apps/api/src/services/backups.rs` | 2,673 | 98,764 |
| `apps/api/src/services/charge_sessions.rs` | 1,949 | 73,563 |
| `packages/hooks/src/api/transport.ts` | 2,254 | 76,978 |

## Duplicate-pattern inventory

Counts below exclude test and story files. A match count is reported separately from the file count where a file can contain multiple direct consumers.

| Pattern | Count | Files | Scope |
| --- | ---: | ---: | --- |
| `window.alert(...)` | 0 | 0 | `apps/web/src` and shared frontend packages |
| `window.confirm(...)` | 6 | 3 | Settings and external-connection workflows |
| `role="switch"` | 3 | 3 | Settings and dashboard editor controls |
| `createPortal(...)` | 8 | 7 | Existing overlay and low-level tooltip/editor surfaces |
| `queryKey: [...]` | 116 | 22 | App/package source; includes raw query and invalidation arrays |
| `resolve_time_bounds` definitions | 6 | 6 | `apps/api/src/routes/{battery,efficiency,idle_drain,metrics,trips,charging}.rs` |

The initial guard configuration allowlists the current production locations and caps each pattern at its measured match count. Follow-up foundation and query-factory PRs must remove those allowlists and lower those caps as consumers migrate. The six Rust time-range definitions are likewise capped by the guard until A1 consolidates them.

## Guard ownership

`pnpm architecture:check` is now the single named verification entry point for:

- architecture-budget and duplicate-pattern ratchets;
- raw transport ownership and source-cycle checks;
- dashboard-default synchronization;
- API route security inventory.

`pnpm verify` invokes this entry point once and no longer invokes the nested dashboard and route checks separately. PR 1 changes verification and documentation only; it does not change application runtime behavior.

## Cleanup checkpoint

The temporary persisted custom-chart subsystem was removed from the application surface while the existing static dashboard chart catalog and specialized renderers were retained. Migration `0011_chart_definitions.sql` remains immutable; migration `0012_remove_chart_definitions.sql` removes its unused table for databases that applied the temporary feature.

The trips and efficiency routes now share one trip-tag search parser, normalizer, serializer, and route adapter. The route-local implementations fell from two to zero, with four focused contract tests covering canonical ordering, invalid input, untagged precedence, and identical serialization.
