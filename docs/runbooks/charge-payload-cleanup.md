---
title: Charge-payload cleanup
description: Safely diagnose and compact redundant Rivian charging payload evidence.
slug: /runbooks/charge-payload-cleanup/
sidebar_label: Charge-payload cleanup
---

# Charge-payload cleanup

This runbook is for the append-only Rivian charging payload evidence table. The
normal synchronizer should reuse a semantic payload identity and should not
rewrite unchanged sessions or curve points. Cleanup is bounded and dry-run by
default; it is not a substitute for fixing a write-amplification regression.
The canonical `charge_payload_fingerprint` and
`charge_payload_identity_key` database functions are shared by ingestion,
backfill, and this compactor; do not reintroduce an inline identity expression.

## Before cleanup

1. Create and verify a recovery package or PostgreSQL dump.
2. Record the current payload, alias, session, and curve-point counts.
3. Pause the Riviamigo app/worker or otherwise schedule the operation away from
   active charging-history synchronization. The compactor takes its own
   advisory lock to prevent concurrent compactors, but the safest window is
   still a quiet ingestion window.
4. Confirm that the target database is the intended instance and that the
   backup has been copied off the NAS.

## Diagnose first

Run without `--apply`:

```bash
cargo run --manifest-path apps/api/Cargo.toml --bin compact_charge_payloads -- \
  --batch-size 5000
```

The report includes relation and payload-byte totals plus the number of
semantic duplicates. It does not delete rows. Use `--vehicle <uuid>` to bound
the report to one vehicle.

Continuous PostgreSQL activity should be investigated before compacting. Check
the app logs for `charge history synced` counters, including `payloads_reused`
and `payloads_inserted`, and compare the counts across two idle polls. Normal
checkpoint, vacuum, or Redis persistence activity is not evidence of a
charging-history loop by itself.

## Apply a bounded cleanup

After reviewing the dry run, remove one bounded batch:

```bash
cargo run --manifest-path apps/api/Cargo.toml --bin compact_charge_payloads -- \
  --batch-size 5000 --apply
```

The compactor keeps a linked/oldest canonical payload, repoints aliases and
semantic identities, and deletes only redundant payload rows. Repeat the same
bounded command while the report shows remaining candidates. Stop if the
reported identity, alias, or session counts change unexpectedly.

Do not use `VACUUM FULL` on a live production database. After the bounded
deletion and a quiet window, run a normal maintenance vacuum/analyze according
to your PostgreSQL operations policy. `VACUUM FULL`, `pg_repack`, or a dump and
restore require additional outage space and rollback planning; select one only
when the recovered disk space justifies that operational cost.

## After cleanup

1. Re-run the dry-run report and record zero remaining semantic duplicates (or
   the reviewed remainder for a filtered vehicle).
2. Compare payload, alias, session, and curve-point counts with the pre-cleanup
   record.
3. Restart the stack and verify `/health`, worker status, and a signed-in
   dashboard.
4. During the next idle completed-history poll, confirm `payloads_reused`
   increases while `payloads_inserted` remains zero for identical upstream
   data.
5. For an active charge, confirm that curve writes correspond only to new or
   genuinely corrected points, not the full historical curve length.

If counts or costs change unexpectedly, stop synchronization, restore the
verified backup in an isolated database, and investigate the replay before
deleting more evidence.
