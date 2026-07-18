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

| Severity | Finding | Resolution |
|---|---|---|
| Critical | Production Compose publishes the web origin on the host. | Documentation requires host firewall protection plus an authenticated tunnel or identity-aware proxy before remote exposure. |
| Critical | Production startup could fall back to database-generated signing and encryption keys. | Production validation now requires externally supplied JWT private/public and age keys. |
| High | The former separate nginx image originally used the wrong upstream boundary. | The unified production image now runs nginx and the API together and intentionally proxies over container-local loopback. |
| High | The production Compose topology omitted its Redis dependency and had stale ports/service documentation. | Redis is included as an internal password-protected service; Compose, user guide, runbook, and env documentation now agree. |
| High | The API production image could not install PostgreSQL 16 client tools from its Debian base. | The runtime now uses `postgres:16-bookworm`, which includes matching `pg_dump`. |

## Residual risks and release requirements

- The outer tunnel/proxy is self-hoster operated. It must enforce identity,
  public HTTPS, WebSocket forwarding, patching, and client-facing rate limits.
- No native Authentik/OIDC trust integration is implemented. The gateway is an
  additive boundary; Riviamigo application login remains mandatory.
- The internal origin deliberately does not trust arbitrary forwarded client-IP
  headers. Configure client-IP trust only at the outer gateway after validating
  its network boundary.
- CI runs cargo audit, pnpm audit, Gitleaks, blocking Semgrep, and blocking
  high/critical Trivy image scans. Fork pull requests run the separate
  secret-free blocking Semgrep scan. Reviewed exceptions must be documented in
  the PR with an owner, expiry, and remediation link. Local
  dependency validation in this audit found no high-severity production npm
  vulnerabilities; the Rust/secret/SAST tools were not installed locally.
- Before a wider exposure or multi-tenant use case, commission an independent
  authenticated penetration test and review gateway, host, backup, and secret
  manager configuration in the target environment.

## Verification recorded

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
