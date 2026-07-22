# Rivian graph exploration harness

This is a local-only, read-only harness for inventorying Rivian GraphQL
Parallax topics and inspecting their protobuf wire shapes. It runs independently
of the Riviamigo API, web app, Redis, and ingestion workers.

## Safety boundary

- The harness sends only GraphQL WebSocket connection and subscription messages.
- It does not send vehicle commands, mutations, wake requests, or application DB writes.
- The default credential provider reads Riviamigo's encrypted token bundle and
  Age identity from local Postgres, then decrypts the bundle only in memory.
- Raw captures can contain VIN, location, SSID, or other private vehicle data.
  Every output is constrained to `tools/graph-exploration/local/`, which is
  ignored both by the repository and by a deny-by-default nested `.gitignore`.
- Payloads are never printed by `inventory`. `inspect` prints protobuf field
  numbers, wire types, sizes, and short hashes, but not length-delimited values.

Do not copy real captures into tracked fixtures. Only synthetic or deliberately
minimized and reviewed fixtures belong in Git.

## Build and authenticate

From the repository root:

```powershell
cargo build --manifest-path tools/graph-exploration/Cargo.toml
pnpm graph:explore -- auth
```

The default development database URL is
`postgresql://riviamigo:devpassword@localhost:5432/riviamigo`. Override it with
`DATABASE_URL` or `--database-url`. If several vehicles are enrolled, select an
internal Riviamigo vehicle UUID with `--vehicle`.

No Rivian password, access token, or refresh token should be placed in an
environment variable, command argument, or `.env` file.

## Capture

Capture the production allowlist for 15 minutes:

```powershell
pnpm graph:explore -- capture --duration-seconds 900
```

Run a bounded topic-discovery capture:

```powershell
pnpm graph:explore -- capture --all-topics `
  --duration-seconds 300 `
  --max-events 25000 `
  --max-megabytes 50
```

`--all-topics` deliberately omits the optional `rvms` variable. Always retain
the duration, event-count, and byte limits. Specific topics can instead be
selected with repeated `--topic` arguments.

The collector reconnects after WebSocket disconnects and Rivian connection-TTL
closures while preserving the original overall duration and size limits.

### Background capture on Windows

Build first, then launch the executable in a hidden background process. Keep all
redirected logs under the ignored local directory:

```powershell
$repo = (Get-Location).Path
$exe = Join-Path $repo 'tools\graph-exploration\target\debug\riviamigo-graph-exploration.exe'
$capture = Join-Path $repo 'tools\graph-exploration\local\captures\background.jsonl'
$stdout = Join-Path $repo 'tools\graph-exploration\local\background.stdout.log'
$stderr = Join-Path $repo 'tools\graph-exploration\local\background.stderr.log'

$process = Start-Process -FilePath $exe `
  -ArgumentList @(
    'capture', '--all-topics',
    '--duration-seconds', '21600',
    '--max-events', '500000',
    '--max-megabytes', '250',
    '--output', $capture
  ) `
  -WorkingDirectory $repo `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

$process.Id
```

Check the exact process and capture growth:

```powershell
Get-Process -Id <pid>
Get-Item tools/graph-exploration/local/captures/background.jsonl
```

To stop early, use only the PID returned by `Start-Process`, after confirming its
executable path points to this harness:

```powershell
Get-Process -Id <pid> | Select-Object Id, Path
Stop-Process -Id <pid>
```

## Explore locally

```powershell
pnpm graph:explore -- inventory tools/graph-exploration/local/captures/<capture>.jsonl
pnpm graph:explore -- inspect tools/graph-exploration/local/captures/<capture>.jsonl --event 1
pnpm graph:explore -- observe wifi-connected --note "Vehicle awake on known 5 GHz network"
```

Observation notes provide timestamps for correlating controlled state changes
with payload hashes. Avoid putting precise addresses, credentials, or secrets in
notes.

## Initial discovery

A 30-second unrestricted smoke capture on July 21, 2026 returned 53 topics. It
confirmed that connectivity-related protobuf data is published under at least:

- `vehicle.network.state`
- `vehicle.setting.network`

The raw payloads remain local. Topic names and wire structure are evidence, but
field semantics, enums, signal units, and freshness must be proven through
descriptors or repeated controlled observations before application integration.

## Verification

```powershell
cargo fmt --manifest-path tools/graph-exploration/Cargo.toml -- --check
cargo test --manifest-path tools/graph-exploration/Cargo.toml
git check-ignore tools/graph-exploration/local/captures/example.jsonl
git status --short
```
