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

`fixtures.json` records approved private fixtures by checksum and expected
schema profile. The lab data itself remains under the ignored `local/` tree;
the checksum is the regression contract and the package must never be added to
Git.
