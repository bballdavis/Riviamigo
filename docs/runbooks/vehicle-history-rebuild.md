# Vehicle History Rebuild

## Audience

Maintainers and agents rebuilding per-vehicle historical facts from stored telemetry.

## Source Of Truth

This runbook is canonical for the `rebuild_vehicle_history` maintenance workflow and its post-replay enrichment behavior.

## What The Rebuild Does

`apps/api/src/bin/rebuild_vehicle_history.rs` rebuilds durable per-vehicle history from telemetry by:

1. clearing existing `charge_sessions` and `trips` rows for the target vehicle
2. rebuilding state periods
3. rebuilding charge sessions and their derived fields
4. replaying trips and telemetry `trip_id` links
5. re-enriching rebuilt trips with geofence/address matching and missing outside temperatures

The rebuild is intentionally self-healing for trip presentation and efficiency analysis. A completed rebuild should leave `/v1/trips` with human-readable start/destination labels when enrichment is available and `/v1/efficiency/vs-temp` with rebuilt trips included once outside temperatures are restored.

## Command

```bash
cargo run --bin rebuild_vehicle_history -- [--vehicle <uuid>]
```

Run from `apps/api` with `DATABASE_URL` set.

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
- Missing trip outside temperatures are re-fetched after replay through the same service.
- Rebuild completion logs now include filled/failed counts for:
  - trip geofence matches
  - trip address matches
  - trip outside-temperature backfills
- Standalone repair commands also support `--vehicle <uuid>` and log scanned/filled/failed/skipped counts for targeted repair passes.

## Operational Tradeoffs

- The rebuild now depends on external enrichment services for the address and weather portions of trip recovery.
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

3. Re-run `report_trip_enrichment_gaps -- --vehicle <uuid>` and confirm the missing-field counts actually improved.
4. Only if coordinate-bearing trips are still missing enrichment should you run `rebuild_vehicle_history -- --vehicle <uuid>`.
5. Immediately rerun the diagnostics report after a rebuild. A rebuild is only accepted when the post-run counts improve.

After a targeted repair or rebuild, verify the affected vehicle through the shared product seams:

1. `GET /v1/trips?vehicle_id=<uuid>&from=<iso>&to=<iso>` returns readable `start_place` / `start_address` and `end_place` / `end_address` where enrichment exists.
2. `GET /v1/efficiency/vs-temp?vehicle_id=<uuid>&from=<iso>&to=<iso>` returns bins for rebuilt trips once outside temperatures are backfilled.
3. Focused regression tests:

```bash
pnpm -C apps/web exec vitest run src/test/tripColumns.test.tsx src/test/dashboardChartWidget.test.tsx src/test/apiClient.test.ts
```

Use targeted API integration tests for rebuild/enrichment behavior rather than relying on broad workspace validation when unrelated SQLx or frontend failures are noisy.
