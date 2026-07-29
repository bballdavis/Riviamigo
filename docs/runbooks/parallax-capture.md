# Optional Parallax Telemetry Collector

The Parallax collector is an optional process. It is deliberately separate
from Riviamigo's canonical vehicle-state acquisition: it owns a second,
allowlisted GraphQL WebSocket and can stop or restart without affecting normal
telemetry, trip detection, charging, or vehicle freshness.

## Data collected

The collector decodes a small set of verified protobuf topics:

- connectivity quality without SSID, carrier name, BSSID, MAC, IP, or saved networks
- Rivian reference and learned efficiency in Wh/km
- Rivian estimated vehicle mass in kg
- Rivian parked-energy distributions for since parked, 8 hours, and 24 hours
- charging-session energy breakdown for future use
- cold-weather SoC/range impact when the vehicle reports it

Raw protobuf payloads are never stored. Normalized rows use source and receipt
timestamps, schema version 1, and payload-hash deduplication.

## Local development

Start the local stack with its independently managed collector:

```powershell
pnpm run dev:stack:parallax
```

This launches a separate collector executable while reusing the dynamically
selected development database port. If the normal stack is already running,
`pnpm run dev:parallax` can be used in a second terminal with
`PARALLAX_DATABASE_URL` set to the database URL printed by `dev:stack`.

For a Compose installation, enable the opt-in profile:

```powershell
docker compose -f compose/docker-compose.yml --profile parallax up -d
```

It uses `PARALLAX_DATABASE_URL` when supplied and otherwise uses
`DATABASE_URL`. If neither is set, the local development database URL is used.
The API applies migration `0003_extended_parallax_telemetry.sql` on startup;
the collector also checks migrations so it can be started independently.

## Verify

On the Health page, the **Extended Vehicle Telemetry** card reports collector
status, last event time, connectivity quality, efficiency, and mass. The
Phantom Drain page shows **Parked Energy** as `Rivian reported`, above the
separate `Riviamigo battery-change estimate`.

If the collector reports an error:

1. Confirm the vehicle is enrolled and normal Rivian credentials are healthy.
2. Confirm the collector can reach the database and Rivian WebSocket endpoint.
3. Restart only `pnpm run dev:parallax`; do not restart the main acquisition
   worker unless its own health indicates a separate problem.
4. A normal Rivian connection TTL close is retried automatically.

Legacy rows in `riviamigo.rivian_parallax_events` remain unrelated discovery
data and continue to age out. The normalized collector does not write there.
