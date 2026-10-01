---
title: Vehicle state and trip ingestion diagnostics
description: Record and read an ingestion capture of Parallax frames, legacy frames, canonical telemetry fusion, and trip detection for any vehicle model.
---

# Vehicle state and trip ingestion diagnostics

Use this when a connected vehicle shows missing state fields or trips. Parallax
acquisition already runs inside the API process. The owner records an
**ingestion capture** from **Settings → Raw data** and shares the downloaded
`.jsonl` file. Captures exclude VINs, vehicle IDs, names, coordinates, tokens,
and secrets, so the file can be shared as it is.

## Collect a capture

1. Check **Health → Acquisition** and **Settings → Raw data → Collector
   diagnostics** for socket, heartbeat, reconnect, and decoder context.
2. In **Settings → Raw data → Ingestion capture**, an owner or manager selects
   **Start capture** for the affected non-demo vehicle. Recording starts
   immediately, runs for up to one hour, and does not change ingestion.
3. Create or wait for a real vehicle update, then select **Stop** and
   **Download**. Starting a new capture replaces the old one; a stopped capture
   is deleted after 24 hours.

A capture file contains:

- a header line with the app version, vehicle model, capture window, event
  counts by kind, and whether any events were dropped or the 50,000-event limit
  was reached;
- `parallax_envelope`: every Parallax frame with its topic, source timestamp
  and age, decode outcome, whether it reached the canonical worker, the decoded
  values, and the raw payload bytes (except GNSS and network frames). Body
  frames also list each closure or lock position with the field it maps to, or
  `null` when Riviamigo does not know the position;
- `parallax_connection` and `legacy_connection`: subscribe, close, and
  connection-renewal events for both Rivian streams;
- `legacy_frame`: each legacy WebSocket update with every reported field, its
  value, and Rivian's timestamp, so it can be lined up against Parallax;
- `ingestion`: what the worker did with each sample: its source, values,
  whether it was stored or suppressed as a duplicate, the state it implies,
  and whether charge and power lifecycle signals were updated;
- `trip`: the trip detector's power and speed choices, GNSS and odometer
  evidence, start decision, and transition;
- `poll`: each Rivian GraphQL fetch (vehicle-state baseline, vehicle details,
  wallboxes, charge history, charging schedule) with its outcome. The startup
  fetches run when the vehicle's worker starts, so they appear only in a
  capture that spans an API restart. The baseline's fields also appear as a
  `legacy_frame` with message type `baseline`.

Captures never include coordinates, credentials, the VIN, the vehicle ID, or
vehicle and account names. GNSS frames record only that a location was present.

To line up both streams, sort by `recorded_at` and compare each
`parallax_envelope` `source_at` and `decoded` values with the `legacy_frame`
field timestamps for the same change.

## Symptom → next check

- Envelope `outcome` is `rejected`: read `notes` for the decoder error and
  decode `payload_hex` against the topic's protobuf shape.
- Envelope `outcome` is `empty` or `ignored`: the frame had no usable canonical
  value or the topic has no stable canonical mapping. Unknown enum values do
  not become inferred states.
- Body `entries` contain `"field": null`: the vehicle reported a closure or
  lock position the decoder does not map. Note the position and what was
  physically operated at that time.
- `forward_outcome` is `stale`: compare `source_age_ms` with the freshness
  window (five minutes old, thirty seconds ahead).
- `forward_outcome` is `full` or `closed`: inspect worker health and
  backpressure. Parallax collection keeps its independent persistence path.
- No `parallax_envelope` rows at all: check the `parallax_connection` rows and
  Acquisition. A connected socket proves the subscription, not that a vehicle
  sent a particular topic.
- `ingestion` rows show `"state_period": "skipped_parallax_charge_guard"`:
  expected during a charge. Parallax power has no Charging value, so Parallax
  frames without charger state cannot close the Charging period or slow
  live-session polling while a charge session is open.
- `ingestion` `persistence` is `suppressed_duplicate`: the sample matched the
  stored state, so it left no new telemetry row.
- `trip` rows: check the effective power source and freshness. Change-only
  Parallax power remains latched until a newer state arrives; periodic legacy
  `vehicleState` power is fresh for at most two minutes. Check that direct
  speed is used when present and that a GNSS or odometer estimate is used only
  when direct speed is absent, then read the start decision and transition.

## Exact-SHA real-drive acceptance

Decoder tests and a successful build establish code behavior. They do not prove
that a vehicle sent the expected signals or that a trip completed. Record the
full source Git SHA and immutable image digest for a controlled real-drive
check, then confirm the running API instance uses that build.

- [ ] Start a capture for a non-demo vehicle and confirm fresh allowlisted
      Parallax frames appear in the downloaded file.
- [ ] Capture a short, known drive safely. A passenger can observe the live
      dashboard; stop and download the capture only while parked.
- [ ] Confirm recognized power and its source age are plausible: Parallax
      change-only state remains latched until an explicit new state, while
      periodic legacy power ages out after two minutes.
- [ ] Confirm reported numeric speed is preserved. When it is absent, check
      that any derived speed names its GNSS or odometer source and has plausible
      input deltas and interval.
- [ ] Confirm the trip start decision agrees with the captured drive,
      followed by a start and completion transition.
- [ ] After stopping, confirm the trip closes and its distance is plausible.
      Save the capture with the exact Git SHA and image digest.

If there is no real-vehicle capture from the identified build, record live
acceptance as unverified.

For the owner-facing overview, see [Extended Vehicle Telemetry](../guides/extended-vehicle-telemetry.md).
