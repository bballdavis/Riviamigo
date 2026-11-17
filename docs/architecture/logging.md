# Logging Conventions

This page is the contract for runtime logging in the Rust API, the restore
agent, the maintenance binaries, and the browser app. It defines the output
shape, what each level means, the field names to use, and what must never be
logged. The browser follows the same ladder and line shape through
`clientLog` (see [Browser logging](#browser-logging)); failure reporting there
is described in [Frontend Error Observability](./frontend-error-observability.md).

The goal is a ladder where each rung is a strict superset of the one above it
and noticeably noisier:

| Level | Audience | Typical volume |
| --- | --- | --- |
| `ERROR` | Operator, needs action | Rare; should page someone if it repeats |
| `WARN` | Operator, worth a look | Occasional; self-healing or degraded |
| `INFO` | Anyone reading a production log | A few lines per minute at most, per vehicle |
| `DEBUG` | Someone diagnosing a problem | Per request, per decision, per job step |
| `TRACE` | Someone chasing one specific bug | Per telemetry frame, per row, per loop iteration |

The default is `INFO`. A healthy, idle server should be readable at `INFO`
without scrolling; turning on `DEBUG` should still be reasonable on a dev
machine; `TRACE` may be a firehose and is never the default anywhere.

## Output shape

Every line follows `[riviamigo][LEVEL] module::path:span{fields}: message key=value`.
`logging.rs` owns the format. The module path is the Rust target with the
crate prefix removed, so `ingestion::worker` identifies the source without a
file name. Docker adds the outer timestamp. Nginx failure lines are normalized
by the production wrapper into the same `[riviamigo][LEVEL]` prefix.

`logging.rs` also guarantees two properties for every line, whatever the call
site logged:

- One event is one line. Newlines in a value (an `anyhow` chain printed with
  `?error`, a child process's stderr) are folded to ` | `, and other control
  characters are dropped, so a logged value cannot forge a second log line.
- Credentials are masked. URL userinfo (`postgres://user:secret@host`),
  `password`/`passwd`/`secret` assignments (`password=x`, `PASSWORD 'x'`, JSON
  `"password":"x"`), and `Bearer` tokens are replaced with `***`. This is a
  backstop for text you do not control; it does not make it acceptable to log a
  secret on purpose.

HTTP handling runs inside an `http` span carrying `method`, `path`, and
`request_id`. Every event emitted while a request is handled, from any layer,
includes those fields. Do not repeat them at call sites. The `request_id` is
the same value returned in the `x-request-id` response header and recorded by
the browser diagnostics, so one failure can be followed from the browser to
the server.

## Choosing a level

Ask the questions in order and stop at the first yes.

### `ERROR`: the operation failed and the system cannot fix it itself

- A request returned a 5xx because of our own fault: database, filesystem,
  Redis, or an internal invariant.
- Persisted data could not be written, was found corrupt, or a migration or
  restore step failed.
- A background job gave up. A worker that will not restart. A task panicked.
- Startup cannot continue.

An `ERROR` that fires for expected, user-triggered, or self-healing conditions
trains operators to ignore the level. Use `WARN` instead.

### `WARN`: something unexpected happened and the system coped

- An upstream (Rivian, OpenFreeMap, Nominatim, an S3 endpoint) failed or
  returned something we could not use, and we retried, skipped, or fell back.
- A worker exited on a transient failure and is being restarted.
- A rate limit, capacity limit, or deadline was hit.
- A configuration is legal but risky (for example insecure LAN HTTP auth).
- A background pass skipped work because of bad data, then continued.
- A security-relevant rejection that is not routine: a replayed or expired
  token, an unexpected signature, repeated login failures.

`WARN` is for _the system's_ surprises. A user mistyping a password or sending
an invalid form is not one.

When a condition repeats, do not emit a `WARN` per occurrence. Log the first
occurrence, then suppress or aggregate (`attempt`, `suppressed`), and log
recovery once at `INFO`.

### `INFO`: a lifecycle or business event an operator would want in a summary

Low volume, one line per event, stable wording.

- Process start and stop, effective configuration summary, migration result.
- Worker, scheduler, and connection lifecycle: started, stopped, connected,
  reconnected after an outage, paused, resumed.
- Domain milestones: a trip or charge session opened or closed, a backup or
  restore completed, a vehicle added, a user created, a setting changed by an
  administrator, an API key issued or revoked, a login succeeded.
- Recovery from a previously warned condition.

Never at `INFO`: anything per request, per telemetry frame, per poll cycle, per
row, per retry, per cache hit. If a line would be emitted more often than once
per vehicle per few minutes in normal operation, it is not `INFO`.

### `DEBUG`: the decision trail for a diagnosis

Information a developer needs to understand _why_ the system did what it did,
at the granularity of one request, job step, or decision.

- Request completed (`status`, `latency_ms`), request rejected with a 4xx.
- State machine transitions and the inputs that triggered them (trip detector
  moved to `Driving`, charge detector held a session open).
- Cache hit or miss, skipped work and the reason, selected branch.
- External call outcome: endpoint class, status, duration, row counts.
- Background job step boundaries and counts.
- Expected, handled, user-caused failures (validation, not found, forbidden).

### `TRACE`: raw detail

Anything whose volume scales with data rather than with decisions.

- Each telemetry frame received or parsed, and field-level diffs between
  frames.
- Each iteration of a loop, each row processed, each reconnect timer tick.
- Full shapes of outbound queries and external requests. Even here, never
  secrets or personal data (see below).

Guard expensive trace-only formatting with `tracing::enabled!(Level::TRACE)`
rather than building strings that are then discarded.

## Where the line falls: worked examples

| Situation | Level |
| --- | --- |
| Rivian websocket subscription frame arrived | `TRACE` |
| Frame parsed, 3 fields changed | `TRACE` |
| Trip detector transitions parked → driving | `DEBUG` |
| Trip closed (`trip_id`, distance, duration) | `INFO` |
| Worker started or stopped for a vehicle | `INFO` |
| Websocket dropped, reconnecting in 5s (first time) | `WARN` |
| Websocket dropped again, same cause, attempt 6 | `DEBUG` (suppressed), recovery `INFO` |
| Reverse-geocode returned no result | `DEBUG` |
| Reverse-geocode upstream returned 503 | `WARN` |
| Database query failed in a handler | `ERROR` |
| `GET /v1/vehicles` returned 200 in 12ms | `DEBUG` |
| `POST /v1/auth/login` rejected: wrong password | `DEBUG`, aggregated lockout at `WARN` |
| `POST /v1/auth/login` succeeded | `INFO` |
| Request body failed validation (422) | `DEBUG` |
| Backup job completed | `INFO` |
| Backup job failed | `ERROR` |
| Rate limit hit (429) | `WARN` |

## Messages

- Start lowercase, no trailing period, no emoji, no interpolated values. Values
  go in fields so lines are greppable and consistent:
  `tracing::info!(vehicle_id = %id, "worker started")`, not
  `info!("worker started for {id}")`.
- Name the event, not the plumbing: `trip closed`, not `in close_trip()`.
- A failure message says what could not be done and, if the cause is not the
  field itself, why: `charge session close skipped: no samples`. Prefer the
  `action failed` / `action skipped` / `action retrying` shape.
- Once per condition. A function that returns an error does not also log it;
  the caller that handles the error logs it, once, with the context it knows.
  Log-and-return doubles every failure.
- Do not log inside tight inner loops at any level above `TRACE`.

## Fields

Use these names so a filter works across the whole codebase.

| Field | Meaning |
| --- | --- |
| `vehicle_id` | Internal vehicle UUID |
| `user_id` | Internal user UUID |
| `trip_id`, `session_id`, `job_id`, `run_id` | Internal ids for that entity |
| `error` | The error. `%e` for std/`sqlx`/`AppError`; `?e` for `anyhow`, to keep the cause chain (the formatter folds it onto one line) |
| `status` | HTTP status as a number |
| `latency_ms`, `duration_ms` | Elapsed milliseconds |
| `count`, `rows`, `bytes` | Quantities |
| `attempt`, `retry_seconds` | Retry bookkeeping |
| `provider` | Upstream name: `rivian`, `openfreemap`, `nominatim`, `s3` |
| `reason` | Short machine-friendly cause for a skip or rejection |
| `listen_addr` | A bound socket address. Never use a bare `address` field |

Any other entity id follows the same `<entity>_id` shape (`artifact_id`,
`api_key_id`, `invitation_id`, `actor_user_id` for the user who performed an
admin action on someone else). Do not invent synonyms for a field above.

`request_id`, `method`, and `path` come from the `http` span; do not add them.
Use `?value` only for enums and small debug-only structures.

## What must never be logged

At any level, including `TRACE`:

- Passwords, one-time codes, tokens, refresh tokens, API keys, session or
  cookie values, `Authorization` headers, signing secrets, setup tokens, and
  database URLs with credentials.
- Email addresses, names, VINs, street addresses, and coordinates. Use
  `user_id` and `vehicle_id`.
- Raw Rivian payloads or request and response bodies. Log shape (field names,
  counts, sizes), not content.
- Query strings of URLs. Log only the path.

If a value is needed to diagnose, log a length, a hash prefix, or a boolean
such as `token_present`.

## Startup, shutdown, and failure

Every binary starts with `riviamigo_api::logging::run(...)` (or `init()` for a
process that manages its own result). That installs the shared subscriber
before any other work, so configuration, database, migration, and key errors
appear in the same format and obey `RUST_LOG`, instead of being printed by the
runtime as a bare `Error:` line.

- A fatal error is logged once, at `ERROR`, as `process exiting after fatal
  error` with the whole cause chain in `error`. Add `.context("verb-ing the
  thing")` to each fallible startup step so the chain says which step failed,
  and do not also log the error before returning it.
- `api starting` and `restore agent starting` log the version. `effective
  configuration` logs the settings an operator needs to read a log (environment,
  port, the active log filter) and never a secret.
- A stop signal logs `shutdown signal received; stopping` with the signal name.
- A panic is logged as `thread panicked` with its location, through the same
  format, by a hook installed in `init()`.

## Spans

Use spans for context that applies to many lines, not for timing every
function. HTTP requests already get one. For background work with identity,
open one span at the job boundary:

```rust
let span = tracing::info_span!("worker", vehicle_id = %vehicle_id);
async move { /* ... */ }.instrument(span).await;
```

Fields on an enclosing span must not be repeated on events inside it.

## Components that do not use `tracing`

- One-shot maintenance binaries in `src/bin` (backfills, repair and report
  tools) own their stdout as a report for the operator, so `println!` there is
  the output, not logging. Failures go to stderr and a non-zero exit code.
  A maintenance binary that wants progress lines uses `tracing` after
  calling `riviamigo_api::logging::init()` so its output matches the API; it
  never initializes its own subscriber. The long-running binaries
  (`riviamigo-api`, `riviamigo-restore-agent`) do the same.
- Library code under `src/` (everything but `src/bin`) never uses `println!`,
  `eprintln!`, or `dbg!`.
- Browser code uses `clientLog` and `reportClientError()`; there are no stray
  `console.*` calls outside `clientDiagnostics.ts`.

## Browser logging

`@riviamigo/ui/lib/clientDiagnostics` owns browser output, with the same ladder
and line shape as the server:

```text
[riviamigo][INFO] auth: signed in user_id=123e4567…
[riviamigo][DEBUG] api: request completed method=GET path=/v1/vehicles/<id> status=200 latency_ms=41 request_id=…
```

```ts
clientLog.info('auth', 'signed in', { user_id });
clientLog.debug('api', 'request completed', { method, path: redactPath(path), status, latency_ms });
clientLog.trace('live', 'frame received', { vehicle_id, count });
```

- The first argument is the subsystem (`app`, `auth`, `api`, `live`, `route`,
  `query`, `mutation`, `map`), the second a lowercase message with no trailing
  period, and values go in the fields object with the server's names.
  `pnpm logging:check` enforces the message style.
- The default threshold is `info`. Raise it with `riviamigoLog.setLevel('debug')`
  in the console (it is saved and applies after a reload), or set
  `localStorage['rm-log-level']`. `trace` replaces the former `rm-ws-debug`
  websocket inspector.
- Level meaning matches the server: `info` is lifecycle (app start, sign-in and
  sign-out, a live connection opening), `debug` is the decision trail (each API
  request outcome, navigation, reconnect scheduling, a mutation succeeding),
  `trace` is per-message detail (each request start, each websocket frame's
  shape). `reportClientError()` is the `warn`/`error` path for failures, with
  the deduplication described in the observability doc.
- The same never-log rules hold. Fields named like a password, token, email,
  VIN, coordinate, or address are dropped, UUIDs are shortened to eight
  characters except `request_id`, which stays whole so a browser line can be
  matched to the server line that carries the same `request_id`. Log paths with
  `redactPath()`, never a URL with a query string. Websocket frames log their
  field names and counts, never values.

## Turning levels up

`RUST_LOG` is a standard `tracing` filter. The default is:

```text
info,tower_http=warn
```

```bash
# a louder first-party app with quiet dependencies
RUST_LOG=riviamigo_api=debug,info

# a slimmer app: warnings and errors only
RUST_LOG=warn

# one subsystem at trace, everything else at info
RUST_LOG=info,riviamigo_api::ingestion=trace

# include the SQL sqlx executes
RUST_LOG=riviamigo_api=debug,sqlx=debug,info
```

Targets match the module path in each line, so you can copy it from a log line
into the filter.

## Enforcement

`pnpm logging:check` (part of `pnpm verify:ci` and the Quality workflow)
mechanically enforces what a script can: message style for `tracing` and
`clientLog` calls, the `error` field name, a ban on sensitive field names, no
`println!`/`eprintln!`/`dbg!` in library code, no private tracing subscriber,
and no `console.*` outside the diagnostics seam. Choosing the
right _level_ is a judgment call and stays in code review.

## Review checklist

When adding or changing logging, confirm:

1. The level answers the questions above, not "how important does this feel".
2. The line is not emitted per frame, row, or poll at `DEBUG` or above.
3. Values are fields, field names come from the table, and the message has no
   trailing period.
4. No secrets or personal data, and no log-and-return duplicate.
5. The failure path has a log at the right level and the success path of a
   significant action leaves an `INFO` or `DEBUG` trail.
