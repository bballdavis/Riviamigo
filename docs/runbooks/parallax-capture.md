# Parallax Capture

Parallax capture is an experimental, read-only backend collector for Rivian
protobuf messages. It is enabled by default in Compose through
`RIVIAN_PARALLAX_CAPTURE_ENABLED=true` and uses the existing raw-event
retention period, which defaults to seven days.

The collector does not decode or promote fields into `timeseries.telemetry`.
It stores the RVM name, Rivian server timestamp, receive timestamp, and
base64 protobuf payload in `riviamigo.rivian_parallax_events`. While a drive or
charge session is active, the worker also stamps its in-memory trip or session
ID so the samples can be correlated after the parent row is persisted.

## Inspect capture coverage

```sql
SELECT
  rvm,
  COUNT(*) AS samples,
  COUNT(*) FILTER (WHERE trip_id IS NOT NULL) AS drive_linked_samples,
  COUNT(*) FILTER (WHERE charge_session_id IS NOT NULL) AS charge_linked_samples,
  MIN(COALESCE(server_timestamp, received_at)) AS first_sample,
  MAX(COALESCE(server_timestamp, received_at)) AS last_sample
FROM riviamigo.rivian_parallax_events
GROUP BY rvm
ORDER BY samples DESC;
```

For one drive, join by the stamped trip ID:

```sql
SELECT rvm, server_timestamp, received_at, payload_b64
FROM riviamigo.rivian_parallax_events
WHERE trip_id = '<trip-uuid>'
ORDER BY COALESCE(server_timestamp, received_at), received_at;
```

The payload is intentionally kept as base64 so it can be exported or decoded
offline without changing the production telemetry schema.

## Connection lifecycle

Parallax shares the authenticated vehicle-state WebSocket connection. Rivian
closes long-lived GraphQL sockets with close code `4420` and reason
`Connection TTL expired`. This is expected; the existing collector renews the
socket and both subscriptions immediately. The
`Parallax subscription submitted on existing Rivian WS connection` confirms
that the client sent the subscription after the shared connection was
acknowledged. If that appears but the table stays empty after several minutes,
investigate RVM availability or feature gating rather than waiting for a drive.

## Stop or remove the experiment

Set `RIVIAN_PARALLAX_CAPTURE_ENABLED=false` and restart the API. Existing rows
will continue to age out under the normal retention job. Once the samples have
been reviewed, the experiment can be removed independently with:

```sql
DROP TABLE riviamigo.rivian_parallax_events;
ALTER TABLE riviamigo.rivian_stewardship_counters
  DROP COLUMN IF EXISTS parallax_events_persisted;
```
