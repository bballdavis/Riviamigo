---
title: Extended Vehicle Telemetry
description: Enable Rivian-reported connectivity, efficiency, mass, and parked-energy readings.
---

# Extended Vehicle Telemetry

Riviamigo can optionally run a separate Parallax telemetry collector. It adds
privacy-filtered vehicle readings to the Health page and a Rivian-reported
Parked Energy breakdown to Phantom Drain.

The feature is opt-in and does not replace normal vehicle acquisition. If the
collector is stopped, all existing dashboards and Riviamigo's derived Phantom
Drain history continue to work.

The collector is a source-development tool and is intentionally not included
in Riviamigo's published production image. Run it from a source checkout or the
opt-in development Compose profile below.

For a source checkout:

```powershell
pnpm run dev:stack:parallax
```

For a development Compose installation:

```powershell
docker compose -f compose/docker-compose.dev.yml --profile parallax up -d
```

The Parked Energy card distinguishes the two available perspectives:

- **Rivian reported:** vehicle-calculated energy attributed to vehicle systems,
  climate, Gear Guard, and outlets.
- **Riviamigo battery-change estimate:** the existing calculation from
  validated parked-session battery and range changes.

The two sources are displayed separately because their windows and measurement
methods differ. Riviamigo does not silently substitute one for the other.

The Parked Energy card is shown only while the Parallax collector reports a
fresh connected heartbeat. When the optional collector is stopped or
unavailable, Phantom Drain continues to show Riviamigo's derived battery-change
estimate without the Parked Energy card.

Connectivity collection excludes network names and hardware identifiers.
Values such as mass and learned efficiency are labeled as Rivian estimates,
not independently measured specifications.
