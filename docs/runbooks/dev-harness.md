# Production-test clone and dev-upgrade harness

This runbook owns the disposable `riviamigo-prod-test` workflow. It consumes a verified production `.rma.tar.gz` recovery package, restores it into new test-only storage, starts the clone on an immutable baseline image, and then starts the same clone on an immutable development image so forward migrations run only against the clone.

Production is not a source or target of the restore operation. The package contains PostgreSQL and vehicle artwork. Redis live state, provider credentials, refresh sessions, browser state, installation keys, and backup target secrets are intentionally fresh after restore; reconnect providers in the test installation when a test needs them.

## Invariants

- The production stack remains `riviamigo-prod`, port `8066`, and `<production-root>`.
- The test stack is `riviamigo-prod-test`, port `<private-test-host>:8067`, and `<production-root>-test/{db,redis,backups,cache,secrets}`.
- The test Compose file uses `riviamigo-prod-test-internal`, has no `t3_proxy`, Traefik labels, public router, or production network name, and pins every application image by `tag@sha256`.
- Test credentials are host-only. Never copy the production `.env` into Forgejo, Komodo environment, a command line, or a log.
- A migrated test database is never downgraded in place. Rollback means fresh test storage plus the preserved package and the prior image lock.

## Preflight

Before running the procedure, prove all of the following:

1. A verified package exists under `<production-root>/backups`, or an explicit package path was supplied. The package must have its SHA-256 recorded and must pass the existing recovery manifest, migration-chain, schema, checksum, and compatibility contract.
2. The currently running production app has a proven immutable image digest. A Komodo record containing `ghcr.io/bballdavis/riviamigo:latest` without a digest is not sufficient; strict two-phase mode stops rather than guessing.
3. The development candidate is a prerelease image built from the intended remote `dev` SHA. Record the source SHA, prerelease tag, image digest, and Compose source SHA in the test repository's `deployment.lock`.
4. `<private-test-host>:8067` is unused, the trusted-LAN CIDR is known, and the host firewall—not a public router—owns the allow rule. The HTTP exception is private-LAN-only and weaker than HTTPS.
5. GHCR pull access and Komodo's absolute host-file behavior have been tested without printing secrets.

The current branch flow is `dev` only. Re-read the Forgejo/GitHub `dev` revision immediately before publishing. If a local candidate is not on remote `dev`, only an explicit fast-forward push to `dev` is allowed. Never push or merge this workflow to `main`.

## Harness command

The repository-owned command defaults to a read-only plan. Use an explicit test-only env file containing the generated test passwords and setup-token file reference; do not point it at the production env file.

```bash
node scripts/dev-harness.mjs \
  --package <production-root>/backups/<verified-package>.rma.tar.gz \
  --sha256 <64-hex-package-sha256> \
  --baseline-image ghcr.io/bballdavis/riviamigo:<baseline-tag>@sha256:<baseline-digest> \
  --dev-image ghcr.io/bballdavis/riviamigo:<dev-tag>@sha256:<dev-digest> \
  --test-root <production-root>-test \
  --env-file <production-root>-test/secrets/compose.env \
  --port 8067 \
  --project riviamigo-prod-test \
  --plan
```

The command rejects mutable `latest`, unpinned images, port `8066`, production paths, production-labelled projects, packages inside live database directories, unsafe archive members, missing recovery manifest components, and populated test storage. Add `--reset-test-storage` only after confirming the resolved path is exactly the disposable test root. Add `--execute` only after the plan JSON has been reviewed.

The repository also provides `pnpm dev:harness:procedure`, a thin entrypoint for a Komodo Procedure. Configure the Procedure to supply the `RIVIAMIGO_HARNESS_*` variables (paths, exact image refs, provenance, port, and optional reset flag) and invoke `node scripts/dev-harness-procedure.mjs` from the source checkout. The wrapper passes only non-secret paths and provenance values as arguments; credentials remain in the host env file. Komodo remains the owner of stack deployment and supplies the resulting stack revision for the state record; the harness never calls Komodo HTTP or bypasses the Forgejo/Komodo contract.

## Test stack configuration

Create private Forgejo repository `<forgejo-owner>/Riviamigo-prod-test` with deployment branch `prod-test`. Its tracked files are the isolated Compose contract, non-secret runtime settings, `deployment.lock`, and the README/rollback instructions. Host-only files under `<production-root>-test/secrets` contain the generated app/database/Redis credentials and one-time setup token.

The Compose contract retains `riviamigo-init`, the unified app, TimescaleDB, and Redis. It uses the canonical digest-pinned database and Redis images, a test-only internal network, a separate app egress bridge, and literal host paths under the test root. It must not include a proxy network, Traefik labels, public DNS/router names, `8066`, `latest`, or `<production-root>`.

For the documented trusted-LAN HTTP exception, the test app env contains the exact private-network acknowledgement:

```dotenv
RIVIAMIGO_BIND_ADDRESS=0.0.0.0
ALLOW_PUBLIC_ORIGIN_BIND=true
ALLOW_INSECURE_LAN_HTTP_AUTH=true
ALLOWED_ORIGINS=http://<private-test-host>:8067
RIVIAMIGO_ENV=production
```

Do not expose that origin through a router or public DNS. Prefer an authenticated HTTPS gateway if the test needs access beyond the trusted LAN.

## Ordered operation

1. Run the harness in plan mode and inspect the package SHA, archive members, baseline/dev digests, target paths, and phases.
2. With `--reset-test-storage`, create only the test directories and stage a read-only package copy. Never read or copy PostgreSQL's production data directory.
3. Run the existing `scripts/restore-backup.mjs` engine against the isolated Compose project and baseline image. Confirm the restore completes, setup is already closed, and users, dashboards, historical telemetry, vehicles, trips, charging history, artwork, and health are present.
4. Stop the baseline test deployment only as needed, update the test GitOps lock to the immutable dev digest, and deploy only `riviamigo-prod-test` through Komodo. The app startup migration may advance only the cloned test database.
5. Record the migration transition, resulting app digest, health/setup state, source SHA, Compose source SHA, and Komodo stack revision. Re-read the Komodo stack and containers after deployment.
6. Restart the test stack and verify the restored users, generated application keys, database, artwork, and test configuration persist. Verify provider credentials and live sessions remain absent until deliberately reauthenticated.
7. Re-read `riviamigo-prod` and prove its revision, containers, port, network, route, and storage are unchanged.

## Rollback

Do not run an older image against a test database after dev migrations have succeeded. Stop and remove only the `riviamigo-prod-test` containers, preserve the failed test root for diagnosis if needed, create fresh `{db,redis,backups,cache}` directories, restore the preserved package with the prior immutable image, and redeploy the prior test lock. Production is never part of rollback.

The harness writes non-secret state and lock records under the test root. Keep the package and its checksum until the upgraded test has passed the data and migration checks; these are the rollback authority.

## Acceptance evidence

- `riviamigo-init` completes; app, TimescaleDB, and Redis are healthy.
- Only `<private-test-host>:8067` is published by the test stack.
- The rendered test Compose has no mutable image, production path, production port/network, or proxy labels.
- Restored users and historical data are present; providers and live sessions require reauthentication.
- Dev migrations succeed only in the test database.
- Restart preserves test data and generated application keys.
- Komodo and Forgejo read-back matches the recorded lock.
- Production remains running at its original revision and route.
