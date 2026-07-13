# Deployment

This is the production, self-hosted Compose stack. For the shortest setup path, see [getting started](./getting-started.md).

The stack in [`compose/docker-compose.prod.yml`](../../compose/docker-compose.prod.yml) runs:

- TimescaleDB for application and telemetry data.
- Redis for session and token-lock state.
- The Riviamigo API on Docker's internal network.
- Nginx for the web app and API origin, bound to `127.0.0.1:8080` by default.

The loopback binding is intentional. Place an authenticated HTTPS tunnel or identity-aware reverse proxy in front of it; never publish the API, database, Redis, or origin port directly.

## Initial deployment

1. Prepare `.env` using [configuration](./configuration.md). In particular, use `timescaledb` (not `localhost`) in `DATABASE_URL`, set separate strong database and Redis passwords, provide the signing and age encryption keys, set `RIVIAMIGO_ENV=production`, and set `ALLOWED_ORIGINS` to your exact public HTTPS address.

2. Start the stack:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.prod.yml up -d --build
   ```

3. Check that services are healthy:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.prod.yml ps
   curl http://127.0.0.1:8080/health
   ```

4. Configure an authenticated gateway that forwards to `127.0.0.1:8080` and supports WebSockets. The [secure deployment guide](./secure-deployment.md) has the required access boundary.

5. Open the authenticated HTTPS address. The first account is the `super_user`; afterward, that owner can create activation links for invited users.

## Logs and updates

```bash
# Follow every service
docker compose --env-file .env -f compose/docker-compose.prod.yml logs -f

# Follow the API only
docker compose --env-file .env -f compose/docker-compose.prod.yml logs -f api

# Pull a new image tag and recreate the stack
docker compose --env-file .env -f compose/docker-compose.prod.yml pull
docker compose --env-file .env -f compose/docker-compose.prod.yml up -d
```

The API applies its database migrations on startup. Back up before a significant update and review the release notes for breaking changes.

## Stopping and recovery

```bash
# Stop containers but retain your data volumes
docker compose --env-file .env -f compose/docker-compose.prod.yml down

# Destructive: remove containers and all stored data
docker compose --env-file .env -f compose/docker-compose.prod.yml down -v --remove-orphans
```

For a database dump, restore process, and backup considerations, see [backup and restore](./backup-and-restore.md).
