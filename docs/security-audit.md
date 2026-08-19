# Shareable Release Security Audit

## Status

This is an internal source and deployment-configuration audit for the shareable
release. It is not an independent penetration test or a security certification.
The release posture remains: do not expose Riviamigo directly to the Internet.

## Reviewed evidence

- Authentication: RS256 access-token validation pins issuer and zero leeway;
  access tokens remain in memory and refresh tokens are HttpOnly cookies.
- Authorization: API-key hashing, expiry, revocation, access-level checks, and
  dashboard ownership checks were reviewed at their shared middleware/route
  seams.
- Vehicle roles: viewers are read-only; managers may perform operational
  schedule and history-backfill actions; owners retain credential and
  membership administration.
- Data handling: SQL access in the reviewed auth, API-key, backup, and key
  bootstrap paths uses parameter binding; durable Rivian credentials and
  short-lived connection material use age encryption.
- Browser and transport: reviewed CORS allowlist, cookie flags, CSP, WebSocket
  token handling, request logging, and the absence of access-token persistence.
- Deployment: reviewed Compose networking, API/origin reachability, Redis
  isolation, secret requirements, container privilege settings, and the backup
  client runtime.

## Findings resolved in this release

| Severity | Finding                                                                                                 | Resolution                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| High | An unclaimed production installation could accept its first owner without an out-of-band proof. | Production registration now requires a configured 32-byte setup proof while no user exists; its source/value is never exposed. |
| High | The origin could be published more broadly than the intended gateway boundary. | Standard Compose binds the origin to loopback and requires an explicit public-bind opt-in; the app service is rootless, read-only, capability-dropped, and `no-new-privileges`. |
| High     | The former separate nginx image originally used the wrong upstream boundary.                            | The unified production image now runs nginx and the API together and intentionally proxies over container-local loopback.    |
| High     | The production Compose topology omitted its Redis dependency and had stale ports/service documentation. | Redis is included as an internal password-protected service; Compose, user guide, runbook, and env documentation now agree.  |
| High     | The API production image could not install matching PostgreSQL client tools from its Debian base.       | The runtime now uses the pinned `postgres:18.4-bookworm` image, which includes matching `pg_dump`.                           |

## Residual risks and release requirements

- The outer tunnel/proxy is self-hoster operated. It must enforce identity,
  public HTTPS, WebSocket forwarding, patching, and client-facing rate limits.
- No native Authentik/OIDC trust integration is implemented. The gateway is an
  additive boundary; Riviamigo application login remains mandatory.
- The internal origin deliberately does not trust arbitrary forwarded client-IP
  headers. Configure client-IP trust only at the outer gateway after validating
  its network boundary.
- Application signing/encryption keys may be persisted in PostgreSQL when the
  complete external key trio is omitted. This is an explicitly accepted P2
  shared-fate risk: database compromise or loss can affect both state and
  locally generated keys. Tested database recovery is required; a secret
  manager supplying all three keys is the optional separate-custody path.
- Security events are structured, redacted, and retained in the live database
  for 365 days by the application retention worker. Backup retention remains
  an operator policy and may preserve older events inside recovery packages.
- CI runs cargo audit, pnpm audit, Gitleaks, blocking Semgrep, and blocking
  high/critical Trivy image scans. Fork pull requests run the separate
  secret-free blocking Semgrep scan. Reviewed exceptions must be documented in
  the PR with an owner, expiry, and remediation link. Local
  dependency validation in this audit found no high-severity production npm
  vulnerabilities; the Rust/secret/SAST tools were not installed locally. The
  four RustSec exceptions are listed with owners, evidence, and expiry in the
  [maintenance register](./runbooks/dependency-maintenance.md#maintenance-register).
- Before a wider exposure or multi-tenant use case, commission an independent
  authenticated penetration test and review gateway, host, backup, and secret
  manager configuration in the target environment.

## Verification recorded

The security-hardening branch additionally requires:

- `pnpm security:routes`
- constant-time restore-token comparison tests
- bounded dynamic telemetry and metric selector tests

- `cargo test config::tests --lib`
- `cargo test routes::dashboards::tests --lib`
- `pnpm -C apps/web exec vitest run src/test/dashboardComponentRegistry.test.ts src/test/dashboardApi.test.tsx`
- `pnpm build`
- `cargo check`
- `pnpm docs:check`
- `pnpm dashboards:sync-defaults --check`
- `pnpm audit --prod --audit-level=high`
- `docker compose --env-file .env -f compose/docker-compose.yml config --quiet`
- `docker run --rm postgres:16-bookworm pg_dump --version`
- `docker run --rm -v <repo>/compose/nginx/nginx.conf:/etc/nginx/nginx.conf:ro nginx:1.27-alpine nginx -t`

The full API Docker image build was started after fixing the PostgreSQL client
base image, but the isolated Rust compile exceeded the five-minute local command
window. It must complete in CI or a longer-running local build before release.
