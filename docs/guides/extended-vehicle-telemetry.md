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

Use this short procedure when a maintainer asks for evidence about a missing
reading:

1. From the repository root, start the standard stack if it is stopped, then
   follow the existing API output:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo
   ```

   Use the equivalent log command for your deployment if it is managed by an
   operator. Normal API startup runs the in-process Parallax acquisition task;
   there is no separate Parallax logger, container, or start command.
2. In **Settings → Raw data**, an owner or manager turns on **Ingestion
   diagnostics** for the affected non-demo vehicle. It expires after one hour.
   The switch increases diagnostic log detail; it does not enable ingestion or
   create a downloadable data dump.
3. Create or wait for a real vehicle update while the logs are being followed.
   `Parallax envelope diagnostics` reports an allowlisted topic's outcome,
   payload byte length, source age, and canonical-forward result.
   `vehicle ingestion diagnostics` records source, field presence, and sample
   age. `vehicle trip diagnostics` reports the selected power source and age,
   numeric speed and origin, GNSS or odometer derivation evidence, trip
   category checks, start decision, and sanitized transition. Health
   **Acquisition** and **Collector diagnostics** provide connection context.
4. Share only redacted diagnostic lines. Remove vehicle IDs, account data,
   coordinates, tokens, secrets, and any other identifying values. Do not share
   raw telemetry payloads.
5. Turn **Ingestion diagnostics** off when the evidence is collected. It also
   expires automatically after one hour.

Diagnostic events omit raw Parallax payloads, protobuf wire data, credentials,
network identifiers, and coordinates; host logging controls retention. They
include the existing vehicle ID, so redact it before sharing. A sleeping
vehicle may provide no new frames during the window. See the [maintainer
runbook](../runbooks/r2-ingestion-diagnostics.md) for a repeatable investigation
and real-drive acceptance checklist, and the [API reference](../api-access.md)
for the session-only switch endpoints.
