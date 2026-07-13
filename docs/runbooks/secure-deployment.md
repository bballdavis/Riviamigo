# Secure Deployment Boundary

## Supported exposure model

Riviamigo is not approved for direct Internet exposure. The production Compose
stack binds its web origin only to `127.0.0.1:8080`; place an authenticated
tunnel or identity-aware reverse proxy in front of that listener. A tunnel that
only publishes the port without an access policy is not sufficient.

The outer gateway must terminate public HTTPS, require an identity policy, and
forward normal HTTP and WebSocket traffic to `http://127.0.0.1:8080`. Riviamigo
login remains enabled behind that gateway. Cloudflare Tunnel with Access and
Authentik in front of Caddy, Nginx, or Traefik are supported deployment shapes;
the gateway itself is operated and patched by the self-hoster.

## Required production configuration

- Set `RIVIAMIGO_ENV=production`.
- Supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` from a secret
  manager or protected deployment environment. Production startup fails when
  any value is absent.
- Set `ALLOWED_ORIGINS` to the exact public HTTPS origin, with no path.
- Set strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values. URL-encode the
  database password when it is embedded in `DATABASE_URL`.
- Keep `COOKIE_INSECURE` absent. It is local-development-only.
- Do not publish API port 3001, PostgreSQL port 5432, Redis port 6379, or the
  origin port 8080 beyond loopback/internal Docker networking.

## Gateway requirements

- Enforce authentication before forwarding any request, including `/v1/*` and
  WebSocket upgrades.
- Preserve `Host` and WebSocket upgrade headers. Do not log `Authorization` or
  `Sec-WebSocket-Protocol` headers.
- Own public TLS, certificate renewal, Internet-facing rate limits, and any
  trusted-client-IP policy. The internal Riviamigo origin intentionally does
  not trust arbitrary forwarded client IP headers.
- Restrict direct host access to the loopback listener with host firewall rules.

## Verification

1. Run `docker compose --env-file .env -f compose/docker-compose.prod.yml config` and confirm
   nginx publishes only `127.0.0.1:8080:8080`.
2. Start the stack and check `curl http://127.0.0.1:8080/health` locally.
3. Confirm external access is denied by the gateway before reaching Riviamigo,
   then authenticate through the gateway and sign in to Riviamigo.
4. Confirm `docker compose --env-file .env -f compose/docker-compose.prod.yml ps` shows no host
   mapping for API, TimescaleDB, or Redis.
5. Run `pnpm docs:check` and the security test suite before upgrading a shared
   instance.

## Limits of this guidance

This boundary reduces exposure; it is not a security certification or a
substitute for gateway patching, host hardening, backups, monitoring, and an
independent penetration test when the deployment risk warrants one.
