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
const fixtureRegistry = JSON.parse(readFileSync(join(root, 'tools', 'restore-lab', 'fixtures.json'), 'utf8'));
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

function verifyDatabase() {
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
  if (migrationRows.join(',') !== '1,2,3,4,5') {
    throw new Error(`Expected migrations 1 through 5, received ${migrationRows.join(',')}.`);
  }
  for (const label of ['users', 'vehicles', 'dashboards', 'telemetry', 'trips', 'charge_sessions']) {
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
const registeredFixture = fixtureRegistry.fixtures.find((fixture) => fixture.sha256 === originalChecksum) ?? null;
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
  run(process.execPath, [
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
  ]);
  const manifest = parseManifest();
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
  const database = verifyDatabase();
  if (!existsSync(backupSentinel)) throw new Error('Restore replaced or removed the host backup directory.');
  const artworkRoot = join(dataRoot, 'cache', 'riviamigo', 'vehicle-images');
  const artworkFiles = existsSync(artworkRoot)
    ? readdirSync(artworkRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length
    : 0;
  if (artworkFiles < 1) throw new Error('Restored vehicle artwork is missing.');
  if (sha256(packagePath) !== originalChecksum)
    throw new Error('Source recovery package changed during the lab run.');
  const restoreReportsRoot = join(dataRoot, 'backups', '.restore-reports');
  const restoreReportFiles = existsSync(restoreReportsRoot)
    ? readdirSync(restoreReportsRoot).filter((file) => file.endsWith('.json'))
    : [];
  if (restoreReportFiles.length !== 1)
    throw new Error(`Expected one durable host restore report, found ${restoreReportFiles.length}.`);
  const restoreReport = JSON.parse(
    readFileSync(join(restoreReportsRoot, restoreReportFiles[0]), 'utf8')
  );
  if (restoreReport.status !== 'completed')
    throw new Error(`Host restore report has unexpected status ${restoreReport.status}.`);
  if (registeredFixture?.expected_transform) {
    const applied = restoreReport.validation_report?.applied_transforms?.map((entry) => entry.id) ?? [];
    if (!applied.includes(registeredFixture.expected_transform)) {
      throw new Error(
        `Expected transform ${registeredFixture.expected_transform}; applied ${applied.join(', ') || 'none'}.`
      );
    }
  }
  if (registeredFixture?.expected_profile && restoreReport.validation_report?.legacy_profile !== registeredFixture.expected_profile) {
    throw new Error(
      `Expected profile ${registeredFixture.expected_profile}; received ${restoreReport.validation_report?.legacy_profile ?? 'none'}.`
    );
  }
  if (registeredFixture?.expected_migrations_applied) {
    const applied = restoreReport.validation_report?.migrations_applied ?? [];
    if (applied.join(',') !== registeredFixture.expected_migrations_applied.join(',')) {
      throw new Error(
        `Expected migrations ${registeredFixture.expected_migrations_applied.join(',')}; applied ${applied.join(',') || 'none'}.`
      );
    }
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
      fixture_id: registeredFixture?.id ?? null,
    },
    target: { source_build: sourceBuild, origin: `http://localhost:${port}` },
    setup_required: setup.setup_required,
    restore_supervisor_healthy: true,
    host_backup_directory_preserved: true,
    artwork_files: artworkFiles,
    database,
    restore_plan: restoreReport.plan,
    validation_report: restoreReport.validation_report,
  };
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
