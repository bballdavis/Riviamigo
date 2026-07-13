# Riviamigo Roadmap

This is a prioritized direction, not a promise of dates. Rivian's service is unofficial and can change without notice, so every feature that depends on upstream behavior must be verified against live responses and recorded fixtures before it is treated as supported.

## Product principles

- Local-first: vehicle history stays on infrastructure the owner controls.
- Safe by default: read-only telemetry remains the default; commands require explicit capability, authorization, confirmation, and audit evidence.
- Truthful data: distinguish unavailable upstream fields from missing collection, estimated values, and measured values.
- Contributor-friendly: a new vehicle model or telemetry field should come with a fixture, parser/API contract, and regression test.
- Shared seams: implement behavior in the shared ingestion, types, hooks, dashboard, and security boundaries rather than route-specific exceptions.

## Now: foundation and trust

### OIDC and SSO

Add native OpenID Connect support for self-hosters using providers such as Authentik, Keycloak, Entra ID, or another standards-compliant provider:

- Authorization Code + PKCE with server-side callback handling and strict issuer/audience validation.
- Configurable discovery URL, client credentials, redirect allowlist, scopes, and claim-to-user/role mapping.
- Local break-glass administrator access, explicit account-linking rules, session revocation, and audit events.
- Safe migration from local accounts, no trust in arbitrary forwarded identity headers, and clear proxy deployment guidance.
- Provider integration tests using a local mock OIDC server plus one documented real-provider validation path.

SSO should complement the existing secure reverse-proxy guidance, not turn an unprotected origin into a safe public service by itself.

### R1T, R1S, and R2/R2S test coverage

Build a model and firmware compatibility matrix, starting with owner-contributed R1T and R1S coverage and extending to R2/R2S as vehicles and upstream access become available. The matrix should record model, model year, generation, trim, battery pack, firmware, supported fields, and known upstream gaps.

Expand the test system with:

- Redacted live-response fixtures and a replay harness for websocket, REST, and schema-drift cases.
- Contract tests for field parsing, persistence, latest-status reduction, trip/charge reconstruction, and dashboard rendering.
- Hardware smoke-test instructions that never require contributors to share credentials or raw location history.
- A contribution template for model metadata, field availability, timestamps, and reproducible failure evidence.
- CI coverage for every fixture and a visible unsupported/unknown state instead of silently treating a missing field as zero.

### Safe vehicle controls

Design the command boundary before exposing controls. The first candidates are lock/unlock, cabin climate/preconditioning, and selected closures such as frunk, liftgate, windows, side bins, or tonneau where the upstream contract and vehicle support are verified.

Every command must have capability discovery, permission checks, explicit confirmation for high-impact actions, idempotency or duplicate protection, rate limits, timeout/retry rules, a clear success/failure result, and an audit record. The UI should show stale status and uncertain command state rather than claiming success. Controls should ship behind an opt-in feature flag and remain disabled for unverified models or upstream schemas.

## Next: parity and daily usefulness

### Trip and activity analysis

- Group drive and charge sessions into named adventures with day-by-day breakdowns.
- Add route maps, elevation, energy used, efficiency, cost, and tagged locations with a privacy-preserving local data model.
- Improve five-second precision where the upstream feed provides it, while preserving lower-resolution and estimated states honestly.
- Add import/export tools for historical data and a durable deletion/retention workflow.

### Charging and battery health

- Charging curves with temperature and state-of-charge context.
- Battery health/degradation trends with clear measured-versus-derived labels.
- Wheel/tire efficiency and other vehicle-specific efficiency factors when telemetry is reliable.
- Daily activity and phantom-drain views that separate parked energy use from preconditioning, charging, and other known activity.
- Cost modeling for home, public, and time-of-use charging with explicit tariff assumptions.

### Operations and notifications

- Software update release and vehicle-health notifications.
- Stale-ingestion, authentication-expiry, backup, and migration alerts.
- Multi-vehicle views with per-vehicle permissions, retention, and export controls.
- A guided diagnostics page that exposes field coverage, last-seen timestamps, upstream errors, and safe recovery actions.

## Later: ecosystem and automation

- First-class Home Assistant integration for sensors, diagnostics, and carefully gated commands.
- Prometheus metrics, Grafana-friendly exports, webhooks, and a documented versioned API for local integrations.
- User-defined alerts and schedules with dry-run previews, rate limits, audit history, and an emergency disable switch.
- Better mobile/PWA behavior, offline-friendly history browsing, and optional installable notifications.
- Optional community comparisons or leaderboards only when they are opt-in, aggregate, and privacy-preserving.

## Contribution opportunities

The most useful contributions are model-specific fixtures from R1T/R1S owners, future R2/R2S owner testing, replay cases for upstream GraphQL changes, parser/API contract tests, OIDC provider validation, accessibility/mobile checks, and documentation improvements. Contributors should redact names, VINs, tokens, coordinates, and timestamps that could identify a household before sharing evidence.

## Competitive parity without copying the wrong tradeoffs

The roadmap tracks useful patterns visible in comparable Rivian tools: Roamer's trip grouping, mapped drives, charging curves, costs, battery health, tagged locations, multi-vehicle support, and daily phantom-drain views; and the community Home Assistant integration's climate and closure controls. Riviamigo's differentiator is keeping those capabilities self-hosted and auditable, with stronger model/fixture provenance and safer command boundaries rather than assuming every upstream field or command is universally available.

- [Rivian Roamer Plus](https://rivianroamer.com/plus)
- [Rivian Roamer trips](https://rivianroamer.com/changelog/trips)
- [Rivian Roamer daily activity and phantom drain](https://rivianroamer.com/changelog/daily-activity-phantom-drain)
- [Home Assistant Rivian integration](https://github.com/bretterer/home-assistant-rivian)

## Roadmap review rule

When a feature moves from proposed to implementation, update this document with the supported model/firmware scope, data source, security and privacy implications, test evidence, and any user-facing documentation required. A feature is not complete because its UI exists; it is complete when its source behavior, failure modes, tests, and operational guidance agree.
