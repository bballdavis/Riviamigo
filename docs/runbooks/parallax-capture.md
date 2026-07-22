# Retired Production Parallax Capture

The production Parallax sidecar has been retired. The API no longer opens a
second Parallax subscription or writes Parallax payloads to the application
database. This prevents experimental discovery traffic from duplicating the
normal vehicle-state WebSocket workload.

Existing rows in `riviamigo.rivian_parallax_events` are legacy data. The normal
raw-event cleanup job continues to age them out using the configured retention
period; no new rows are written.

## Local exploration

Use the `graph-exploration` branch and its local-only harness instead. It reads
the encrypted local session, subscribes directly to Rivian, and writes raw
captures beneath its ignored `tools/graph-exploration/local/` directory. It does
not require the Riviamigo API or write to the application database.
