# Release database cutover

Riviamigo's first public release starts fresh installs from one SQLx baseline:
apps/api/migrations/0001_initial_schema.sql. The API applies that baseline on
an empty database and uses normal, forward-only SQLx migrations for later
releases.

The pre-release development database is not empty and must not run the new
baseline. Adopt it once before starting the release build.

## Adopt the existing development database

1. Stop the API and create a restorable database dump. Keep the dump outside
   the repository.

   ```bash
   docker exec riviamigo-timescaledb-1 pg_dump -U riviamigo -d riviamigo -Fc > riviamigo-pre-release.dump
   ```

2. Run the rebaseline command without confirmation. It checks for the expected
   pre-release schema and SQLx ledger but makes no changes.

   ```bash
   pnpm db:rebaseline
   ```

3. Provide the dump path and explicitly confirm the ledger replacement.

   ```bash
   pnpm db:rebaseline -- --yes --backup /absolute/path/riviamigo-pre-release.dump
   ```

4. Start the API normally, or run pnpm db:migrate. It must complete without
   checksum warnings or migration replay output.

The command relocates the SQLx bookkeeping table from the historical
riviamigo schema to public, then replaces its entries with the baseline
checksum. It does not execute schema SQL, alter application tables, or delete
application data. It refuses databases that do not have the expected
pre-release ledger and final release-schema markers. If the database is already
adopted, it exits with a no-op message and does not require another backup or
cutover.

## Baseline maintenance

Do not edit the initial baseline after it has shipped. Add a new numbered SQLx
migration for every post-release schema change. Keep data repairs and
one-time backfills as explicit operational commands unless a new installation
also requires them.
