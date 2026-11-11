# Vehicle History Rebuild

## Audience

Maintainers and agents rebuilding per-vehicle historical facts from stored telemetry.

## Source Of Truth

This runbook is canonical for the `rebuild_vehicle_history` maintenance workflow and its post-replay enrichment behavior.

## What The Rebuild Does

`apps/api/src/bin/rebuild_vehicle_history.rs` rebuilds durable per-vehicle history from telemetry by:

1. clearing existing `trips` rows for the target vehicle
2. rebuilding state periods
3. rebuilding telemetry-derived charge evidence without deleting canonical `charge_sessions`
4. replaying Rivian completed-session payloads back into canonical matching
5. canonicalizing duplicate charge rows and recovering API-only charge history
6. replaying trips and telemetry `trip_id` links, using the same sparse R2 power, location, and odometer joining as live ingestion
7. reattaching geofence/address matches and queueing route-aware outside-temperature enrichment

The rebuild is intentionally self-healing for trip presentation and efficiency analysis. A completed rebuild should leave `/v1/trips` with human-readable start/destination labels when enrichment is available and `/v1/efficiency/vs-temp` with rebuilt trips included once outside temperatures are restored.

## Command

```bash
cargo run --bin rebuild_vehicle_history -- [--vehicle <uuid>]
```

Run from `apps/api` with `DATABASE_URL` set.

Supporting charge-session maintenance commands:

```bash
cargo run --bin diagnose_charge_sessions -- [--vehicle <uuid>]
cargo run --bin canonicalize_charge_sessions -- [--vehicle <uuid>]
cargo run --bin compact_charge_payloads -- [--vehicle <uuid>] [--apply] [--batch-size <count>]
```

`compact_charge_payloads` reports semantically identical Rivian payload fingerprints by default and
does not change data. After creating a verified backup, add `--apply` to remove
only equivalent JSON payloads with the same vehicle, operation, transaction,
and upstream vehicle identity. It retains one payload, preferring a payload that
is already linked to a canonical charge session. Cleanup is limited to 5,000 rows
per run by default to bound WAL and disk pressure on NAS storage; repeat the
command until the dry-run report reaches zero, or choose a smaller batch with
`--batch-size`.

Charge-payload JSON is retained for 90 days. A replayed completed session whose
matching payload evidence has expired is represented by a durable identity
tombstone, not a new JSON payload. This is expected for older history: it does
not block rebuilding canonical `charge_sessions`, but it means no retained raw
payload can be linked to that replay. Do not change the retention policy or
rerun cleanup to resolve this condition. Investigate only if a recent session
reports `payload_audit_failures`; normal expiration is reported as an
aggregated `payloads_evidence_expired` poll count.

### Charge-history duplicate-key failures

`duplicate key value violates unique constraint "uq_charge_sessions_rivian_session"`
means a charge-session write tried to use a Rivian session ID already owned by
another row. The completed-session API returns account-wide history, so live
sync, backfill, and stored-payload replay classify every summary by its
upstream `vehicleId` before storing or matching it:

- A summary whose `vehicleId` exactly matches the target vehicle's Rivian ID is
  processed.
- A summary that names a different vehicle is always skipped.
- A summary with a null or empty `vehicleId` is attributed to the target vehicle
  only when the target is the sole non-demo vehicle of its owner
  (`vehicles.user_id`) and nothing shows that its Rivian account covers other
  vehicles: the current response and the vehicle's retained summaries must not
  name any other upstream vehicle. Otherwise it is skipped, because its vehicle
  cannot be determined. Adding a second vehicle to an account, or sharing one
  Rivian login between users, therefore stops later syncs and replays from
  attributing unidentified summaries. If every summary on a shared account is
  unidentified there is no evidence to detect the sharing, and those sessions
  are attributed to the polling vehicle.

Each sync or replay run logs one aggregated `info` line with
`skipped_foreign`, `skipped_unidentified`, and `accepted_unidentified` counts
when any of them is nonzero. The other vehicle's Rivian ID is never logged.
Live sync does not retain payloads for skipped summaries.

Canonicalization merges same-vehicle duplicates before promoting their preferred
external alias. Promotion leaves the current ID unchanged if another row still
owns the preferred ID, including a row belonging to another vehicle. The unique
index must remain enabled.

#### Reassignment of misattributed sessions

Every canonicalization run (charge-history backfill, `canonicalize_charge_sessions`,
`rebuild_vehicle_history`, and `repair_charge_sessions_from_telemetry`) first
moves misattributed API-only sessions to their owning vehicle. A session is
misattributed when its stored `rivian_vehicle_id` is set and differs from the
Rivian ID of the vehicle it is attached to. It is moved only when:

- its `source` is exactly `rivian_api`, and no telemetry or charge-curve samples
  reference it; and
- another vehicle of the same user (`vehicles.user_id`) has that
  `rivian_vehicle_id`.

With `--vehicle <uuid>`, the run considers both sessions currently on that
vehicle and sessions belonging to it that sit on a sibling vehicle. Moves run
in one transaction; aliases and user annotations follow the session, and the
moved session's cost is recomputed against its new vehicle. Retained payloads
keep their original vehicle and are not modified or deleted. A moved session is
merged with the owner's overlapping telemetry session the next time the owner's
history is canonicalized; this happens in the same run when the owner is the
target vehicle or when the run covers all vehicles. The run reports the number of moved sessions as
`misattributed_sessions_reassigned`.

The repair leaves these sessions untouched:

- mixed-source sessions (`telemetry` or `telemetry+rivian_api`), because their
  telemetry evidence belongs to the vehicle they are on;
- sessions whose Rivian vehicle ID matches no vehicle of the same user;
- API-only sessions without a Rivian session ID that would collide with an
  existing session on the owner at the same start time.

`diagnose_charge_sessions` reports remaining cases as `misattributed_sessions`.
Inspect any nonzero count against the retained payload's `vehicleId` before
planning a targeted repair with a verified backup.

After deploying the fix, retry charge-history backfill for each affected vehicle
and run `diagnose_charge_sessions -- --vehicle <uuid>`. A successful retry alone
does not prove historical attribution is correct: sessions created from
unidentified summaries carry no Rivian vehicle ID and are not detected by the
misattribution count.

## Diagnostics First

Before changing live history, capture the current enrichment gap report for the affected vehicle:

```bash
cargo run --bin report_trip_enrichment_gaps -- --vehicle <uuid>
```

The report groups gaps per vehicle and per UTC day so maintainers can distinguish:

- total trips
- missing trip start/end address IDs
- missing trip start/end geofence IDs
- missing trip `outside_temp_c`
- address gaps that still have usable coordinates
- address gaps that can be satisfied from cached local addresses
- outside-temperature gaps that still have usable start coordinates
- outside-temperature gaps that are unrecoverable because no usable start coordinates remain

Treat the DB counts as the source of truth. Logs alone are not enough to accept a repair.

## Post-Replay Enrichment Behavior

- Trip geofence and address IDs are reattached after replay through the shared trip enrichment service.
- Rebuilt trips enqueue the same idempotent route-aware weather jobs used for new drives. The rebuild does not issue synchronous start-location weather calls.
- Rebuild completion logs now include filled/failed counts for:
  - trip geofence matches
  - trip address matches
  - trip outside-temperature backfills
- Standalone repair commands also support `--vehicle <uuid>` and log scanned/filled/failed/skipped counts for targeted repair passes.

## Operational Tradeoffs

- Address enrichment can run during the rebuild. Weather restoration is asynchronous and remains pending while Open-Meteo is disabled.
- Reverse geocoding and weather lookups fail gracefully; a rebuild can still finish even when some trips remain partially enriched.
- Because enrichment is external, rebuilds can take longer than pure local replay and may show non-zero failed counts when providers are unavailable or rate-limited.

## Verification

Use staged repair for historical gaps:

1. Run `report_trip_enrichment_gaps -- --vehicle <uuid>` and capture the baseline.
2. Run targeted trip enrichment backfills for the affected vehicle:

```bash
cargo run --bin backfill_geofence_matches -- --vehicle <uuid>
cargo run --bin backfill_trip_addresses -- --vehicle <uuid>
cargo run --bin backfill_outside_temp -- --vehicle <uuid>
```

3. Keep the API worker running, then re-run `report_trip_enrichment_gaps -- --vehicle <uuid>` after queued jobs complete and confirm the missing-field counts actually improved.
4. Run `diagnose_charge_sessions -- --vehicle <uuid>` before and after any charge-session rebuild or repair.
5. Only if coordinate-bearing trips are still missing enrichment should you run `rebuild_vehicle_history -- --vehicle <uuid>`.
6. Immediately rerun the diagnostics report after a rebuild. A rebuild is only accepted when the post-run counts improve and charge-session diagnostics no longer show canonical overlaps, null `source` rows, or unresolved payload gaps.

After a targeted repair or rebuild, verify the affected vehicle through the shared product seams:

1. `GET /v1/trips?vehicle_id=<uuid>&from=<iso>&to=<iso>` returns readable `start_place` / `start_address` and `end_place` / `end_address` where enrichment exists.
2. `GET /v1/efficiency/vs-temp?vehicle_id=<uuid>&from=<iso>&to=<iso>` returns bins for rebuilt trips once outside temperatures are backfilled.
3. Focused regression tests:

```bash
pnpm -C apps/web exec vitest run src/test/tripColumns.test.tsx src/test/dashboardChartWidget.test.tsx src/test/apiClient.test.ts
```

Use targeted API integration tests for rebuild/enrichment behavior rather than relying on broad workspace validation when unrelated SQLx or frontend failures are noisy.
