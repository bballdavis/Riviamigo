# Release database cutover

Riviamigo's public release starts fresh installs from one SQLx baseline:
apps/api/migrations/0001_initial_schema.sql. The baseline contains the complete
current application schema, including backup, dashboard, and TimescaleDB
objects. The numbered migration history is intentionally not part of the
public install contract.

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

4. Start the API normally, or run pnpm db:migrate. It must complete without
   checksum warnings or migration replay output.

The command acquires an advisory lock, moves a historical bookkeeping table
into `public` when needed, and replaces its entries with the single baseline
checksum. It does not execute schema SQL against the populated database, alter
application tables, or delete application data. It refuses missing recovery
evidence, active writers, incomplete schemas, failed or non-sequential ledgers,
and engine mismatches. If the database is already adopted, it exits with a
no-op message. Run it separately against both development and production
before starting the flattened release.

## Baseline maintenance

Keep the baseline and every later migration byte-for-byte immutable after it
has merged. For a future schema change, append one uniquely numbered LF/UTF-8
SQL migration with a deliberate forward upgrade path. The migration-integrity
check rejects edits, deletions, renames, version reuse, out-of-order additions,
and line-ending changes. Future source packages are accepted only when their
chain and ledger are exact prefixes of the target catalog.
