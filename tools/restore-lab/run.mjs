#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const suppliedPackage = value('--package');
const sourceBuild = args.includes('--source-build');
const reuseImage = args.includes('--reuse-image');
const keep = args.includes('--keep');

if (!suppliedPackage) throw new Error('--package is required.');
const packagePath = resolve(suppliedPackage);
if (!existsSync(packagePath)) throw new Error(`Recovery package does not exist: ${packagePath}`);

const nonce = `${Date.now().toString(36)}-${process.pid}`;
const project = `riviamigo-restore-lab-${nonce}`;
const port = String(19080 + Math.floor(Math.random() * 800));
const tempRoot = mkdtempSync(join(tmpdir(), 'riviamigo-restore-lab-'));
const dataRoot = join(tempRoot, 'data');
const copiedPackage = join(tempRoot, basename(packagePath));
const envFile = join(tempRoot, 'restore.env');
const localRoot = join(root, 'tools', 'restore-lab', 'local');
const reportsRoot = join(localRoot, 'reports');
const reportPath = join(reportsRoot, `${nonce}.json`);
const fixtureRegistry = JSON.parse(
  readFileSync(join(root, 'tools', 'restore-lab', 'fixtures.json'), 'utf8')
);
const postgresPassword = `restore-db-${nonce}`;
const redisPassword = `restore-redis-${nonce}`;
const environment = {
  ...process.env,
  RIVIAMIGO_DATA_DIR: dataRoot.replaceAll('\\', '/'),
  RIVIAMIGO_ENV_FILE: envFile,
  RIVIAMIGO_ORIGIN_PORT: port,
};
const compose = [
  'compose',
  '-p',
  project,
  '--env-file',
  envFile,
  '-f',
  'compose/docker-compose.yml',
  ...(sourceBuild ? ['-f', 'compose/docker-compose.build.yml'] : []),
];

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: environment,
    ...options,
  });
}

function capture(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    ...options,
  }).trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sql(query) {
  return capture('docker', [
    ...compose,
    'exec',
    '-T',
    'timescaledb',
    'psql',
    '-U',
    'riviamigo',
    '-d',
    'riviamigo',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ]);
}

async function fetchJson(path) {
  const response = await fetch(`http://localhost:${port}${path}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

function parseManifest() {
  const output = capture('tar', ['-xOzf', copiedPackage, 'manifest.json']);
  return JSON.parse(output);
}

function getPath(valueToInspect, path) {
  return path.split('.').reduce((current, key) => current?.[key], valueToInspect);
}

function assertManifestExpectations(manifest, checkpoint) {
  for (const [path, expected] of Object.entries(checkpoint?.manifest_expectations ?? {})) {
    const actual = getPath(manifest, path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Release checkpoint ${checkpoint.id} expected manifest ${path}=${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`
      );
    }
  }
}

function manifestLedgerVersions(manifest) {
  const ledger = manifest.source?.migration_ledger;
  if (!Array.isArray(ledger) || ledger.length === 0) return [];
  const versions = ledger.map((entry) => entry.version);
  if (!versions.every((version) => Number.isInteger(version) && version > 0)) {
    throw new Error('Recovery manifest migration ledger contains an invalid version.');
  }
  for (let index = 1; index < versions.length; index += 1) {
    if (versions[index] !== versions[index - 1] + 1) {
      throw new Error('Recovery manifest migration ledger is not contiguous.');
    }
  }
  const declaredHead = manifest.source?.migration_version;
  if (declaredHead !== undefined && declaredHead !== versions.at(-1)) {
    throw new Error('Recovery manifest migration head does not match its ledger.');
  }
  return versions;
}

function targetLedgerVersions(restoreReport, manifest) {
  const targetLedger =
    restoreReport.plan?.target?.migration_ledger ??
    restoreReport.validation_report?.target_profile?.migration_ledger ??
    restoreReport.validation_report?.target_migration_ledger;
  if (Array.isArray(targetLedger) && targetLedger.length) {
    return targetLedger.map((entry) => entry.version ?? entry);
  }
  return manifestLedgerVersions(manifest);
}

function verifyDatabase(manifest, restoreReport) {
  const requiredRelations = [
    'riviamigo.users',
    'riviamigo.vehicles',
    'riviamigo.dashboards',
    'riviamigo.trips',
    'riviamigo.charge_sessions',
    'riviamigo.backup_runs',
    'riviamigo.backup_artifacts',
    'riviamigo.backup_restore_requests',
    'timeseries.telemetry',
  ];
  const relations = Object.fromEntries(
    requiredRelations.map((relation) => [
      relation,
      sql(`SELECT to_regclass('${relation}') IS NOT NULL`) === 't',
    ])
  );
  const missing = Object.entries(relations)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(`Restored database is missing required relations: ${missing.join(', ')}`);

  const counts = Object.fromEntries(
    [
      ['users', 'riviamigo.users'],
      ['vehicles', 'riviamigo.vehicles'],
      ['dashboards', 'riviamigo.dashboards'],
      ['trips', 'riviamigo.trips'],
      ['charge_sessions', 'riviamigo.charge_sessions'],
      ['telemetry', 'timeseries.telemetry'],
      ['backup_runs', 'riviamigo.backup_runs'],
      ['backup_artifacts', 'riviamigo.backup_artifacts'],
      ['restore_requests', 'riviamigo.backup_restore_requests'],
    ].map(([label, relation]) => [
      label,
      Number.parseInt(sql(`SELECT count(*) FROM ${relation}`), 10),
    ])
  );
  const migrationRows = sql(
    'SELECT version FROM public._sqlx_migrations WHERE success = TRUE ORDER BY version'
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(Number);
  const expectedMigrationRows = targetLedgerVersions(restoreReport, manifest);
  if (migrationRows.join(',') !== expectedMigrationRows.join(',')) {
    throw new Error(
      `Expected migration ledger ${expectedMigrationRows.join(',') || '(none)'}, received ${migrationRows.join(',') || '(none)'}.`
    );
  }
  for (const label of [
    'users',
    'vehicles',
    'dashboards',
    'telemetry',
    'trips',
    'charge_sessions',
  ]) {
    if (counts[label] < 1) throw new Error(`Restored ${label} data is empty.`);
  }
  for (const label of ['backup_runs', 'backup_artifacts', 'restore_requests']) {
    if (counts[label] < 1) throw new Error(`Restored operational history ${label} is empty.`);
  }
  const hypertable =
    sql(
      "SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_schema = 'timeseries' AND hypertable_name = 'telemetry')"
    ) === 't';
  if (!hypertable) throw new Error('timeseries.telemetry is not a TimescaleDB hypertable.');
  return { relations, counts, migration_rows: migrationRows, telemetry_hypertable: hypertable };
}

copyFileSync(packagePath, copiedPackage);
const originalChecksum = sha256(packagePath);
const releaseCheckpoint =
  fixtureRegistry.release_checkpoints?.find(
    (checkpoint) => checkpoint.sha256 === originalChecksum
  ) ?? null;
if (releaseCheckpoint && releaseCheckpoint.file_name !== basename(packagePath)) {
  throw new Error(
    `Release checkpoint ${releaseCheckpoint.id} does not match the supplied package filename.`
  );
}
if (sha256(copiedPackage) !== originalChecksum)
  throw new Error('Local package copy checksum mismatch.');
writeFileSync(
  envFile,
  [
    `DATABASE_URL=postgresql://riviamigo:${postgresPassword}@timescaledb:5432/riviamigo`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `REDIS_PASSWORD=${redisPassword}`,
    `REDIS_URL=redis://default:${redisPassword}@redis:6379`,
    `ALLOWED_ORIGINS=http://localhost:${port}`,
    `RIVIAMIGO_ORIGIN_PORT=${port}`,
    'COOKIE_INSECURE=1',
    'RIVIAMIGO_ENV=development',
    'BACKUP_ARTIFACT_DIR=/backups',
    'VEHICLE_IMAGE_CACHE_DIR=/data/cache/riviamigo/vehicle-images',
    'RUST_LOG=riviamigo_api=info,tower_http=info',
  ].join('\n') + '\n'
);
const backupSentinel = join(dataRoot, 'backups', 'restore-lab-host-catalog-sentinel');
mkdirSync(dirname(backupSentinel), { recursive: true });
writeFileSync(backupSentinel, 'host backup directory must survive restore\n');

let report;
try {
  const manifest = parseManifest();
  assertManifestExpectations(manifest, releaseCheckpoint);
  const sourceMigrationVersions = manifestLedgerVersions(manifest);
  const restoreArguments = [
    'scripts/restore-backup.mjs',
    '--package',
    copiedPackage,
    '--env-file',
    envFile,
    '--project',
    project,
    '--force',
    ...(sourceBuild ? ['--source-build'] : []),
    ...(reuseImage ? ['--skip-build'] : []),
  ];
  if (releaseCheckpoint?.expected_outcome === 'unsupported_migration_chain') {
    const result = spawnSync(process.execPath, restoreArguments, {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status === 0) {
      throw new Error(
        `Release checkpoint ${releaseCheckpoint.id} was restored, but it must be unsupported.`
      );
    }
    if (!/unsupported[_ ]migration[_ ]chain/i.test(output)) {
      throw new Error(
        `Release checkpoint ${releaseCheckpoint.id} failed without the expected unsupported_migration_chain reason: ${output.trim()}`
      );
    }
    report = {
      status: 'passed',
      created_at: new Date().toISOString(),
      package: {
        file_name: basename(packagePath),
        sha256: originalChecksum,
        format: manifest.format,
        format_version: manifest.format_version,
        source: manifest.source,
        release_checkpoint_id: releaseCheckpoint.id,
      },
      expected_outcome: releaseCheckpoint.expected_outcome,
      rejection_output: output.trim(),
      source_migration_versions: sourceMigrationVersions,
    };
  } else {
    run(process.execPath, restoreArguments);
    const setup = await fetchJson('/v1/auth/setup');
    if (setup.setup_required)
      throw new Error('Restored application unexpectedly requires owner setup.');
    run('docker', [
      ...compose,
      'exec',
      '-T',
      'riviamigo',
      'curl',
      '-fsS',
      'http://127.0.0.1:3002/health',
    ]);
    const restoreReportsRoot = join(dataRoot, 'backups', '.restore-reports');
    const restoreReportFiles = existsSync(restoreReportsRoot)
      ? readdirSync(restoreReportsRoot).filter((file) => file.endsWith('.json'))
      : [];
    if (restoreReportFiles.length !== 1)
      throw new Error(
        `Expected one durable host restore report, found ${restoreReportFiles.length}.`
      );
    const restoreReport = JSON.parse(
      readFileSync(join(restoreReportsRoot, restoreReportFiles[0]), 'utf8')
    );
    if (restoreReport.status !== 'completed')
      throw new Error(`Host restore report has unexpected status ${restoreReport.status}.`);
    const database = verifyDatabase(manifest, restoreReport);
    if (!existsSync(backupSentinel))
      throw new Error('Restore replaced or removed the host backup directory.');
    const artworkRoot = join(dataRoot, 'cache', 'riviamigo', 'vehicle-images');
    const artworkFiles = existsSync(artworkRoot)
      ? readdirSync(artworkRoot, { recursive: true, withFileTypes: true }).filter((entry) =>
          entry.isFile()
        ).length
      : 0;
    if (artworkFiles < 1) throw new Error('Restored vehicle artwork is missing.');
    if (sha256(packagePath) !== originalChecksum)
      throw new Error('Source recovery package changed during the lab run.');
    report = {
      status: 'passed',
      created_at: new Date().toISOString(),
      package: {
        file_name: basename(packagePath),
        sha256: originalChecksum,
        format: manifest.format,
        format_version: manifest.format_version,
        source: manifest.source,
        release_checkpoint_id: releaseCheckpoint?.id ?? null,
      },
      target: { source_build: sourceBuild, origin: `http://localhost:${port}` },
      setup_required: setup.setup_required,
      restore_supervisor_healthy: true,
      host_backup_directory_preserved: true,
      artwork_files: artworkFiles,
      database,
      restore_plan: restoreReport.plan,
      validation_report: restoreReport.validation_report,
      source_migration_versions: sourceMigrationVersions,
    };
  }
} catch (error) {
  report = {
    status: 'failed',
    created_at: new Date().toISOString(),
    package: { file_name: basename(packagePath), sha256: originalChecksum },
    error: error instanceof Error ? error.message : String(error),
  };
  spawnSync('docker', [...compose, 'logs', '--no-color', '--tail', '300'], {
    cwd: root,
    stdio: 'inherit',
    env: environment,
  });
  throw error;
} finally {
  mkdirSync(reportsRoot, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Restore lab report: ${reportPath}`);
  if (!keep) {
    spawnSync('docker', [...compose, 'down', '-v', '--remove-orphans'], {
      cwd: root,
      stdio: 'ignore',
      env: environment,
    });
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Restore lab retained: project=${project} data=${dataRoot}`);
  }
}
