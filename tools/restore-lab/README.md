# Restore compatibility lab

This lab restores a real recovery package into an isolated Compose project,
starts the current Riviamigo image against it, and records a data-free JSON
verification report. It never connects to or changes a production host.

Place recovery packages under `tools/restore-lab/local/packages/` or pass an
absolute path. Everything below `tools/restore-lab/local/` is gitignored because
packages contain private account, location, and vehicle history.

```powershell
pnpm verify:restore-compatibility -- `
  --package C:\path\to\backup.rma.tar.gz `
  --source-build
```

Use `--keep` to leave the disposable stack and database available for manual
inspection. Without it, the Compose project and temporary data are removed
after the report is written to `tools/restore-lab/local/reports/`.

After a successful `--source-build`, add `--reuse-image` to repeat the fixture
against the existing `riviamigo:local` image without recompiling it.

The lab uses generated local-only database and Redis passwords. It does not
read Rivian credentials or provider tokens.

`fixtures.json` records release checkpoints by package checksum and manifest
expectations. The runner reads the source migration ledger from
`manifest.json`, derives the expected target ledger from the restore plan, and
never names a particular historical migration number or applies a fixture-only
transform. A checkpoint can also declare that a pre-cutover chain must be
rejected with `unsupported_migration_chain`.

The current public release uses recovery manifest v3 and the
`riviamigo-schema-v1` migration chain. Packages from the former five-migration
chain are retained only as rollback evidence and must be represented as
rejected checkpoints, not successful compatibility fixtures. The lab data
itself remains under the ignored `local/` tree; the checksum is the regression
contract and the package must never be added to Git.
