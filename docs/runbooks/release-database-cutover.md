# Release database cutover

Riviamigo's public release starts fresh installs from one SQLx baseline:
apps/api/migrations/0001_initial_schema.sql. The baseline contains the complete
release-era application schema, including backup, dashboard, and TimescaleDB
objects. Later migrations remain forward-only upgrades; the numbered history
before the baseline is intentionally not part of the public install contract.

Existing installations from the earlier five-migration release must be adopted
once before they run the public release. Adoption replaces only SQLx
bookkeeping after proving that the populated database has the complete final
schema; it does not replay schema SQL or remove application data. Packages from
that former chain are unsupported restore inputs after cutover.

## Adopt an existing installation

1. Stop the API and create a restorable database dump. Keep the dump outside
   the repository.

   ```bash
   docker exec riviamigo-timescaledb-1 pg_dump -U riviamigo -d riviamigo -Fc > riviamigo-pre-release.dump
   ```

2. Run the rebaseline command without confirmation. It creates a disposable
   scratch baseline from the compiled release, compares the complete canonical
   schema contract, validates the existing ledger as ordered and successful, and
   makes no changes.

   ```bash
   pnpm db:rebaseline
   ```

3. Provide the dump path and explicitly confirm the bookkeeping replacement.

   ```bash
   pnpm db:rebaseline -- --yes --backup /absolute/path/riviamigo-pre-release.dump
   ```

4. Start the API normally, or run `pnpm db:migrate`. If the compiled release
   contains migrations added after the flattened baseline, adoption applies
   those migrations from the adopted baseline and records the complete current
   ledger before returning. The API must then start without checksum warnings
   or migration replay output.

The command acquires an advisory lock, moves a historical bookkeeping table
into `public` when needed, and replaces its entries with the flattened
baseline checksum. It then runs any migrations added after that baseline using
the normal SQLx migrator. It refuses missing recovery evidence, active writers,
incomplete schemas, failed or non-sequential ledgers, and engine mismatches.
If the database is already adopted, it exits with a no-op message. Run it
separately against both development and production before starting the release.

The production image includes the same verified utility. With the API stopped,
an operator can run the cutover against a Compose-managed installation without
checking out Rust tooling on the server:

```bash
docker compose run --rm --no-deps \
  --entrypoint /app/rebaseline_db riviamigo \
  --yes --backup /backups/riviamigo-pre-release.dump
```

## Baseline maintenance

Keep the baseline and every later migration byte-for-byte immutable after it
has merged. For a future schema change, append one uniquely numbered LF/UTF-8
SQL migration with a deliberate forward upgrade path. The migration-integrity
check rejects edits, deletions, renames, version reuse, out-of-order additions,
and line-ending changes. A v3 restore with an exact ledger prefix is upgraded
normally. A v3 restore with historical bookkeeping can be adopted only after
its isolated candidate matches both its declared schema fingerprint and the
immutable baseline contract; otherwise it is rejected before activation.
