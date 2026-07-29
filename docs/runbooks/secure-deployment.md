# Secure Deployment Boundary

## Supported exposure model

Riviamigo is not approved for direct Internet exposure. The production Compose
stack publishes its web origin on port `8080`; place an authenticated tunnel or
identity-aware reverse proxy and host firewall rule in front of that listener. A tunnel that
only publishes the port without an access policy is not sufficient.

The outer gateway must terminate public HTTPS, require an identity policy, and
forward normal HTTP and WebSocket traffic to `http://localhost:8080`. Riviamigo
login remains enabled behind that gateway. Cloudflare Tunnel with Access and
Authentik in front of Caddy, Nginx, or Traefik are supported deployment shapes;
the gateway itself is operated and patched by the self-hoster.

## Required production configuration

- Riviamigo defaults to production mode; use `RIVIAMIGO_ENV=development` only for local development.
- Let Riviamigo generate and persist its application keys in PostgreSQL, or
  supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` together from
  a secret manager. Partial overrides fail startup.
- Set `ALLOWED_ORIGINS` to the exact public HTTPS origin, with no path.
- Set strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values. Standard Compose
  safely constructs its internal URLs; custom `DATABASE_URL` values must be valid URLs.
- Keep `COOKIE_INSECURE` absent. It is local-development-only.
- Do not publish API port 3001, PostgreSQL port 5432, Redis port 6379, or the
  origin port 8080 directly to the Internet.

## Gateway requirements

- Enforce authentication before forwarding any request, including `/v1/*` and
  WebSocket upgrades.
- Preserve `Host` and WebSocket upgrade headers. Do not log `Authorization` or
  `Sec-WebSocket-Protocol` headers.
- Preserve live-status control frames and configure the gateway's websocket
  idle/read timeout above 90 seconds. Riviamigo sends a keepalive every 30
  seconds and the browser reconnects when it misses the 90-second liveness
  window.
- Own public TLS, certificate renewal, Internet-facing rate limits, and any
  trusted-client-IP policy. The internal Riviamigo origin intentionally does
  not trust arbitrary forwarded client IP headers.
- Restrict direct host access to port 8080 with host firewall rules.

## Verification

1. Run `docker compose --env-file .env -f compose/docker-compose.yml config` and confirm
   the unified app publishes port `8080:8080` and no database or Redis port.
2. Start the stack and check `curl http://localhost:8080/health` locally.
3. Confirm external access is denied by the gateway before reaching Riviamigo,
   then authenticate through the gateway and sign in to Riviamigo.
4. Confirm `docker compose --env-file .env -f compose/docker-compose.yml ps` shows no host
   mapping for the internal API listener, TimescaleDB, or Redis.
5. Run `pnpm docs:check` and the security test suite before upgrading a shared
   instance.
6. From the public address, leave a signed-in dashboard open beyond the
   gateway idle window, background and refocus the tab, and confirm the status
   transitions through `Reconnecting...` to `Online` without a page reload.

## Limits of this guidance

This boundary reduces exposure; it is not a security certification or a
substitute for gateway patching, host hardening, backups, monitoring, and an
independent penetration test when the deployment risk warrants one.
