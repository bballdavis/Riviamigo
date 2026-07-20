# Dependency modernization report — July 2026

## Scope

This two-phase update first reduced and centralized the dependency surface, then upgraded the retained JavaScript, Rust, runtime, database, cache, object-store, documentation, and build-image dependencies.

The full Lucide, Iconify, and React Icons catalogs remain available. Recharts, uPlot, and react-grid-layout remain intentionally specialized.

## Baselines

| Measure                             |           Before |    After Phase 1 |
| ----------------------------------- | ---------------: | ---------------: |
| Direct JavaScript declarations      |              114 |              105 |
| Unique external JavaScript packages |               65 |               57 |
| pnpm lock snapshots                 |            3,105 |            3,005 |
| Web production output               | 38,799,679 bytes | 38,837,851 bytes |

Phase 2 standardizes Node 24.18.0, pnpm 11.15.1, Rust 1.97.1, PostgreSQL 18.4, TimescaleDB 2.28.3-pg18, Redis 8.8.0 Alpine, and Garage 2.3.0. Container inputs use immutable multi-architecture manifest digests.

| Release artifact              | Before (`2026.07.2`) | Final candidate | Change |
| ----------------------------- | -------------------: | --------------: | -----: |
| Production image content size |          203,535,829 |     189,374,299 |  -7.0% |

## Compatibility work

- Migrated ESLint 8 legacy configuration to ESLint 10 flat configuration.
- Migrated TypeScript 7, Zod 4, Zustand 5, Storybook 10, Iconify 6, React Icons 5.7, and Tailwind Merge 3.
- React Icons 5.7 compiles without a compatibility adapter and retains the existing icon-family imports.
- Migrated SQLx 0.7 to 0.9, Redis 0.25 to 1.x, age 0.10 to 0.12, jsonwebtoken 9 to 10, and tokio-tungstenite 0.23 to 0.30.
- Replaced the vulnerable `rsa` implementation with AWS-LC for RS256 signing and RSA-2048 key generation while preserving the existing PEM key contract.
- Regenerated SQLx metadata against PostgreSQL 18/TimescaleDB 2.28.3.
- Updated PostgreSQL 18 development storage to the version-aware `/var/lib/postgresql` mount required by the upstream image.

## Release evidence

RustSec has one time-bounded warning exception for `RUSTSEC-2026-0173`, an unmaintained procedural macro pulled by the latest stable `age` release. CI expires the exception on 2026-10-01; it does not suppress vulnerabilities or high/critical advisories.

The final production image passed an isolated fresh-install smoke test, amd64 and arm64 packaging builds, and a digest-pinned Trivy 0.72.0 scan with zero fixable high/critical findings. The same scan on July 20, 2026 reported 67 high/critical Debian 13.6 base-package advisories whose status was `affected` or `fix_deferred` and for which Debian published no fixed version. CI blocks fixable high/critical findings; unfixed base-image findings remain visible in scan output and must be reevaluated whenever a new base digest is available.

Final combined verification is recorded in the commits and CI run for the `dev` release-candidate branch. PostgreSQL major upgrades require dump/restore into a clean volume; Redis may fall back to a clean volume with session/provider reconnection as documented in the backup runbook.
