# Security Architecture

## Authentication
- JWT (RS256) with 15-minute access tokens
- 30-day HttpOnly refresh tokens, rotated on use
- API keys with SHA256 hashing, configurable TTL (default 1 year)
- Argon2 password hashing

## Transport Security
- All traffic via nginx, TLS 1.2/1.3 only
- HTTP → HTTPS redirect enforced at proxy layer
- HSTS with 1-year max-age, includeSubDomains
- `Secure` cookie flag enforced (disable only with COOKIE_INSECURE=1 in local dev)

## Rate Limiting
- Auth endpoints: 10 req/min per IP (burst 10)
- API endpoints: 120 req/min per IP (burst 20)
- Enforced at both nginx (outer) and axum (inner) layers

## Headers
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'self'; ...`

## Database
- PostgreSQL accessible only on internal Docker network (not exposed to host)
- Parameterized queries via sqlx (compile-time checked)
- Telemetry column names validated against allowlist before interpolation

## Audit Logging
- Security events (login success/failure, key operations) logged to `riviamigo.security_events`
- Structured JSON logs via tracing-subscriber

## Dependencies
- Weekly automated dependency audits via Dependabot
- `cargo audit --deny warnings` in CI
- `pnpm audit --prod --audit-level=high` in CI
- Semgrep SAST on every PR (OWASP Top 10, Rust, TypeScript rules)

## Production Checklist
- [ ] `COOKIE_INSECURE` is NOT set
- [ ] `POSTGRES_PASSWORD` changed from default
- [ ] TLS certificates provisioned at `/etc/ssl/riviamigo/`
- [ ] `ALLOWED_ORIGINS` set to exact frontend domain(s)
- [ ] nginx `server_name` set to actual domain
- [ ] Firewall blocks port 5432 externally
- [ ] Firewall allows only 80, 443 externally
