# Security Architecture

## Deployment posture

Riviamigo is not approved for direct Internet exposure. Production Compose binds
the application behind a host firewall and authenticated gateway, and every shared deployment must place
an authenticated tunnel or identity-aware reverse proxy in front of it. The
outer gateway owns public TLS, certificate renewal, identity enforcement, and
Internet-facing rate limits; Riviamigo login remains required behind it.

See the [secure deployment runbook](./runbooks/secure-deployment.md) for the
required gateway contract and verification steps.

The current internal audit evidence and release requirements are tracked in
[`docs/security-audit.md`](./security-audit.md).

Sensitive vulnerability reports must use the repository's [private GitHub
Security Advisory flow](https://github.com/bballdavis/Riviamigo/security/advisories/new).
Do not publish credentials, exploit details, production data, live telemetry, or
precise vehicle locations in public issues.

## Authentication

- JWT (RS256) with 15-minute access tokens
- 30-day HttpOnly refresh tokens, rotated on use
- API keys are SHA256-hashed, read-only, and bound to exactly one vehicle; keys
  never authorize dashboard, account, administrative, or vehicle-setting writes
- Argon2 password hashing
- Vehicle membership roles are capability boundaries: `viewer` is telemetry and
  history read-only, `manager` may run operational changes such as schedules
  and backfills, and `owner` alone manages credentials and membership.
- Protected-route bootstrap uses `POST /v1/auth/bootstrap`, which returns fresh tokens when a valid refresh cookie exists and `204 No Content` when no resumable session exists, so first-load logged-out state does not depend on a visible refresh 401.
- The web app attempts one refresh on protected 401s, then emits a single auth-expired flow: toast, session clear, redirect to `/login`, and resume to the original in-app route after successful sign-in.

## Transport Security

- Production nginx is an HTTP origin on port 8080, not a public TLS endpoint
- Public HTTPS and HSTS are enforced by the authenticated outer gateway
- `Secure` cookie flag enforced (disable only with COOKIE_INSECURE=1 in local dev)

## Rate Limiting

- Riviamigo applies class-specific auth, read, write, and heavy-read limits
- The authenticated outer gateway must apply its own client-facing limits
- The internal origin does not trust arbitrary forwarded client-IP headers

## Headers

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'self'; ...`

## Database

- PostgreSQL accessible only on internal Docker network (not exposed to host)
- Parameterized queries via sqlx (compile-time checked)
- Telemetry column names validated against allowlist before interpolation
- Rivian vehicle credentials are encrypted with age before durable storage

## Secret Storage

- Durable Rivian credential bundles are encrypted before storage in `riviamigo.vehicle_credentials`
- Short-lived connect / OTP staging data should stay encrypted at rest in Redis and Redis should remain internal-only
- Production generates `AGE_ENCRYPTION_KEY`, `JWT_SECRET`, and `JWT_PUBLIC_KEY` on first start and persists them in PostgreSQL; externally managed overrides must supply all three together

## Audit Logging

- Security events (login success/failure, key operations) logged to `riviamigo.security_events`
- Structured `[riviamigo][LEVEL]` key-value logs are written to stdout/stderr; Docker supplies the outer timestamp. The production wrapper normalizes Nginx error lines into the same shape.

## Dependencies

- Weekly automated dependency audits via Dependabot
- `cargo audit --deny warnings` in CI
- `pnpm audit --prod --audit-level=high` in CI
- Semgrep SAST is blocking on trusted branches and same-repository pull
  requests; fork pull requests use a separate secret-free blocking scan.
- Fixable critical and high Trivy findings are blocking after the unified production image builds; unfixed base-image findings remain visible for review and base-digest refreshes.
- Workflow actions are pinned to reviewed commit SHAs.

## Release Images

- Standard Compose pulls one public unified image from GitHub Container Registry; source builds use the explicit build overlay only.
- Stable images use immutable Calendar Version tags and provenance attestations; `latest` is a moving convenience tag, not a reproducible deployment identifier.
- Container images are published only by intentional release workflows from validated `main` tags or the current `dev` pre-release candidate. Stable and pre-release image tags and digests must be treated as release artifacts.
- See the [release images runbook](./runbooks/release-images.md) for package visibility, tag protection, and recovery requirements.

## Production Checklist

- [ ] `COOKIE_INSECURE` is NOT set
- [ ] `POSTGRES_PASSWORD` changed from default
- [ ] `REDIS_PASSWORD` is strong and Redis is not host-published
- [ ] Generated application keys are protected by database backups, or all three explicit key overrides are stored safely
- [ ] `ALLOWED_ORIGINS` set to exact frontend domain(s)
- [ ] An authenticated tunnel or identity-aware reverse proxy terminates public HTTPS
- [ ] Host firewall rules restrict direct access to port 8080
- [ ] Redis is reachable only on a private/internal network
- [ ] Firewall blocks API, PostgreSQL, Redis, and origin ports from external access
- [ ] `IMAGE_TAG` is pinned to an exact Calendar Version when repeatability matters
