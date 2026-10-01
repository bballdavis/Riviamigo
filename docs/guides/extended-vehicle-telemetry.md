---
title: Extended Vehicle Telemetry
description: Enable Rivian-reported connectivity, efficiency, mass, and parked-energy readings.
---

# Extended Vehicle Telemetry

Riviamigo runs an integrated, isolated Parallax acquisition subsystem inside each vehicle worker. It adds
privacy-filtered vehicle readings to the compact Connectivity and Signal
Freshness panels at the top of Health, plus a Rivian-reported Parked Energy
breakdown to Phantom Drain.

The subsystem ships as part of the normal API process. It
uses its own WebSocket, persistence path, reconnect loop, health state, and
bounded lease, so failure cannot block canonical vehicle acquisition. Set
`PARALLAX_ENABLED=false` only as an emergency rollback; no separate container
or launcher is required.

The Parked Energy card distinguishes the two available perspectives:

- **Rivian reported:** vehicle-calculated energy attributed to vehicle systems,
  climate, Gear Guard, and outlets.
- **Riviamigo battery-change estimate:** the existing calculation from
  validated parked-session battery and range changes.

The two sources are displayed separately because their windows and measurement
methods differ. Riviamigo does not silently substitute one for the other.

Health keeps the integrated acquisition state visible in the compact top panels, including
never-observed, starting, connected, reconnecting, stale, disabled,
duplicate-owner, and error states. The Health summary includes vehicle Wi-Fi,
unit-aware estimated efficiency, unit-aware vehicle mass, optional cold-weather
impact, and acquisition diagnostics. The Connectivity panel presents
Connectivity as separate Wi-Fi signal, throughput, and Wi-Fi status metrics.
Acquisition is the integrated Parallax subsystem's separate Rivian GraphQL WebSocket state:
Connected means its handshake, subscription, and heartbeat are active, while
Error means its latest token, socket, subscription, or heartbeat attempt
failed and will be retried. Error does not by itself indicate a vehicle fault
or canonical telemetry failure; the Health info tooltip explains this alongside
the latest frame and diagnostic counts.
Legacy charging-session and repair-journal details are not part of that compact
summary. When Parallax acquisition is unavailable,
canonical telemetry and Riviamigo's derived Phantom Drain history continue
normally.

Connectivity collection excludes network names and hardware identifiers.
Values such as mass and learned efficiency are labeled as Rivian estimates,
not independently measured specifications.

## Vehicle state readings and trips

The same allowlisted Parallax subscription requests power, GNSS, odometer,
closures and locks, tire state, and cabin readings for every enrolled vehicle
model. Validated readings join the ordinary vehicle status and telemetry
history. Availability still depends on what that vehicle and Rivian send. A
missing or unrecognized value does not become an inferred state, and Parallax
readings do not start or end charging sessions.

Parallax also reports when a door, gate, frunk, or window is moving. The
vehicle status page then shows **Opening…** or **Closing…** for that closure
until it settles. When Rivian only reports that a closure is ajar, the
direction comes from its last settled state: a closure that was closed is
opening, and one that was open is closing. This motion is live only and is not
stored in telemetry history; the stored value is simply "not closed".

Power state keeps the freshness rule of its source. Parallax reports state when
it changes, so the latest recognized Parallax state stays current until a newer
state arrives. Legacy periodic `vehicleState` power samples are considered
fresh for at most two minutes. When both sources contribute, the newest
accepted sample by source timestamp controls the cached state and its freshness
rule follows that sample's source. Unrecognized power values remain unknown and
do not become sleep or drive decisions.

Trip processing uses the vehicle's direct numeric speed when one is present.
Only when direct speed is absent can shared telemetry fusion estimate speed:
it uses successive plausible GNSS fixes after enough movement is observed, or
an increasing odometer when GNSS has not yet shown movement. The source value
is kept intact; an estimate is not written back as a vehicle-reported speed.
Trip distance starts from the odometer reading at the detected shift into
gear, so early odometer steps are retained. Old fixes, implausible jumps, and
parked odometer readings are excluded from trip detection. Historical replay
does not retain power-source provenance. It treats power-only rows as
change-only frames and richer power rows as periodic telemetry. A legacy
power-only row is indistinguishable, so this remains a replay limitation;
live fusion uses the actual sample source.

## Investigate missing readings

When a maintainer asks for evidence about a missing reading, record an
**ingestion capture** and share the downloaded file:

1. In **Settings → Raw data → Ingestion capture**, an owner or manager selects
   **Start capture** for the affected non-demo vehicle. Recording starts
   immediately and stops on its own after one hour.
2. Reproduce the problem: open and close the doors, drive, plug in, or wait
   for the update that goes missing. A sleeping vehicle may send nothing.
3. Select **Stop**, then **Download**. The file is named
   `riviamigo-capture-<model>-<start time>.jsonl`, with one JSON object per
   line.
4. Share the file with the maintainer as it is. It is safe to share.

Each vehicle keeps only its most recent capture. Starting a new one replaces
the previous file, and a stopped capture is deleted after 24 hours.

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
  evidence, start decision, and transition.

Captures never include coordinates, credentials, the VIN, the vehicle ID, or
vehicle and account names. GNSS frames record only that a location was present.

Operators can still follow API output with
`docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo`,
but diagnostic detail now goes to the capture rather than the log. See the
[maintainer runbook](../runbooks/r2-ingestion-diagnostics.md) for reading a
capture, and the [API reference](../api-access.md) for the session-only capture
endpoints.
