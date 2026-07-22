#!/usr/bin/env node
/**
 * Restore a Riviamigo recovery package into a clean or explicitly-forced
 * Compose installation.
 *
 * Usage:
 *   node scripts/restore-backup.mjs --package ./backup.rma.tar.gz \
 *     --env-file ./.env --source-build
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function argument(name, fallback = undefined) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const packagePath = resolve(requiredArgument('--package'));
const envFile = resolve(argument('--env-file', '.env'));
const project = argument('--project', `riviamigo-restore-${Date.now().toString(36)}`);
const force = args.includes('--force');
const sourceBuild = args.includes('--source-build');

if (!existsSync(packagePath)) throw new Error(`Recovery package does not exist: ${packagePath}`);
if (!existsSync(envFile)) throw new Error(`Compose env file does not exist: ${envFile}`);
const composeEnvironment = { ...process.env, RIVIAMIGO_ENV_FILE: envFile };

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: composeEnvironment, ...options });
}

function capture(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8', env: composeEnvironment, ...options }).trim();
}

async function waitForDatabase(postgresUser) {
  const deadline = Date.now() + 120000;
  const args = [
    ...composeArgs(), 'exec', '-T', 'timescaledb',
    'pg_isready', '-U', postgresUser, '-d', 'riviamigo',
  ];
  while (Date.now() < deadline) {
    const result = spawnSync('docker', args, { cwd: root, stdio: 'ignore', env: composeEnvironment });
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error('Timed out waiting for PostgreSQL to become ready.');
}

function composeArgs() {
  return [
    'compose', '-p', project, '--env-file', envFile,
    '-f', 'compose/docker-compose.yml',
    ...(sourceBuild ? ['-f', 'compose/docker-compose.build.yml'] : []),
  ];
}

function readEnvValue(name) {
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}

function validateArchiveEntries(entries) {
  for (const rawEntry of entries) {
    const entry = rawEntry.replace(/\r$/, '');
    if (!entry || entry === './') continue;
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.includes('\0')) {
      throw new Error(`Unsafe absolute archive path: ${entry}`);
    }
    if (normalized.split('/').includes('..')) {
      throw new Error(`Unsafe parent archive path: ${entry}`);
    }
    if (!['manifest.json', 'database.dump', 'backup-settings.json'].includes(normalized)
      && !normalized.startsWith('vehicle-image-cache/')) {
      throw new Error(`Unexpected recovery package member: ${entry}`);
    }
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function verifyManifest(staging) {
  const manifestPath = join(staging, 'manifest.json');
  const dumpPath = join(staging, 'database.dump');
  if (!existsSync(manifestPath) || !existsSync(dumpPath)) {
    throw new Error('Recovery package must contain manifest.json and database.dump.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assertEqual(manifest.format, 'riviamigo-recovery-v1', 'Unsupported recovery package format');
  assertEqual(manifest.format_version, 1, 'Unsupported recovery package version');
  const database = manifest.components?.database;
  if (!database?.sha256) throw new Error('Recovery manifest is missing the database checksum.');
  assertEqual(sha256(dumpPath), database.sha256, 'Database dump checksum mismatch');

  const settings = manifest.components?.backup_settings;
  const settingsPath = join(staging, 'backup-settings.json');
  if (!settings?.sha256 || !existsSync(settingsPath)) {
    throw new Error('Recovery manifest is missing backup-settings.json or its checksum.');
  }
  assertEqual(sha256(settingsPath), settings.sha256, 'Backup settings checksum mismatch');

  const cacheFiles = manifest.components?.vehicle_image_cache?.files ?? [];
  for (const file of cacheFiles) {
    const relative = file.path?.replace(/^vehicle-image-cache\//, '');
    if (!relative || relative.includes('..') || relative.startsWith('/') || relative.includes('\\')) {
      throw new Error(`Unsafe cache path in manifest: ${file.path}`);
    }
    const path = join(staging, 'vehicle-image-cache', relative);
    if (!existsSync(path)) throw new Error(`Manifest cache file is missing: ${file.path}`);
    assertEqual(sha256(path), file.sha256, `Cache checksum mismatch for ${file.path}`);
  }
  return manifest;
}

function restoreBackupSettings(postgresUser, staging) {
  const settings = JSON.parse(readFileSync(join(staging, 'backup-settings.json'), 'utf8'));
  if (!settings.present) return;

  const jsonLiteral = JSON.stringify(settings).replaceAll("'", "''");
  const sql = `
    ALTER TABLE riviamigo.backup_settings
      ADD COLUMN IF NOT EXISTS local_enabled boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS s3_enabled boolean NOT NULL DEFAULT false;
    INSERT INTO riviamigo.backup_settings (
      id, enabled, frequency, run_at, timezone, day_of_week, day_of_month,
      retention_count, local_enabled, s3_enabled, target_type, endpoint, region, bucket, prefix, access_key,
      secret_key_encrypted, updated_at, updated_by
    )
    SELECT TRUE, enabled, frequency, run_at::time, timezone, day_of_week, day_of_month,
      retention_count, COALESCE(local_enabled, TRUE), COALESCE(s3_enabled, FALSE), target_type, endpoint, region, bucket, prefix, access_key,
      NULL, now(), NULL
    FROM jsonb_to_record('${jsonLiteral}'::jsonb) AS x(
      enabled boolean, frequency text, run_at text, timezone text,
      day_of_week smallint, day_of_month smallint, retention_count integer,
      local_enabled boolean, s3_enabled boolean,
      target_type text, endpoint text, region text, bucket text, prefix text,
      access_key text
    )
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency,
      run_at = EXCLUDED.run_at, timezone = EXCLUDED.timezone,
      day_of_week = EXCLUDED.day_of_week, day_of_month = EXCLUDED.day_of_month,
      retention_count = EXCLUDED.retention_count, local_enabled = EXCLUDED.local_enabled,
      s3_enabled = EXCLUDED.s3_enabled, target_type = EXCLUDED.target_type,
      endpoint = EXCLUDED.endpoint, region = EXCLUDED.region, bucket = EXCLUDED.bucket,
      prefix = EXCLUDED.prefix, access_key = EXCLUDED.access_key,
      secret_key_encrypted = NULL, updated_at = now(), updated_by = NULL;
  `;
  run('docker', [
    ...composeArgs(), 'exec', '-T', 'timescaledb', 'psql', '-U', postgresUser,
    '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);
}

function ensureDatabaseState(postgresUser) {
  const query = "SELECT CASE WHEN to_regclass('riviamigo.users') IS NULL THEN 'empty' WHEN EXISTS (SELECT 1 FROM riviamigo.users LIMIT 1) THEN 'nonempty' ELSE 'empty' END";
  const state = capture('docker', [
    ...composeArgs(), 'exec', '-T', 'timescaledb', 'psql', '-U', postgresUser, '-d', 'riviamigo', '-At', '-c', query,
  ]);
  if (state === 'nonempty' && !force) {
    throw new Error('Target database already contains users. Use --force only when replacing this installation is intentional.');
  }
}

function clearApplicationDatabase(postgresUser) {
  const sql = [
    'DROP SCHEMA IF EXISTS riviamigo CASCADE;',
    'DROP SCHEMA IF EXISTS timeseries CASCADE;',
    'DROP TABLE IF EXISTS dashboards CASCADE;',
    'DROP TABLE IF EXISTS _sqlx_migrations CASCADE;',
    'CREATE SCHEMA IF NOT EXISTS public;',
  ].join(' ');
  run('docker', [
    ...composeArgs(), 'exec', '-T', 'timescaledb', 'psql', '-U', postgresUser, '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);
}

function restoreDatabase(postgresUser, dumpPath) {
  const remoteDump = '/tmp/riviamigo-restore.dump';
  const remoteToc = '/tmp/riviamigo-restore.toc';
  const execArgs = [...composeArgs(), 'exec', '-T', 'timescaledb'];
  try {
    const copy = spawnSync('docker', [...execArgs, 'sh', '-c', `cat > ${remoteDump}`], {
      cwd: root, input: readFileSync(dumpPath), stdio: ['pipe', 'inherit', 'inherit'], env: composeEnvironment,
    });
    if (copy.error) throw copy.error;
    if (copy.status !== 0) throw new Error(`Could not stage database.dump in the PostgreSQL container (exit ${copy.status}).`);

    run('docker', [
      ...execArgs, 'psql', '-U', postgresUser, '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-c',
      'CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();',
    ]);
    const toc = capture('docker', [...execArgs, 'pg_restore', '--list', remoteDump])
      .split(/\r?\n/)
      .filter((line) => !line.includes(' TABLE DATA riviamigo external_connection_activity '))
      .join('\n');
    const tocCopy = spawnSync('docker', [...execArgs, 'sh', '-c', `cat > ${remoteToc}`], {
      cwd: root, input: `${toc}\n`, stdio: ['pipe', 'inherit', 'inherit'], env: composeEnvironment,
    });
    if (tocCopy.error) throw tocCopy.error;
    if (tocCopy.status !== 0) throw new Error(`Could not stage the PostgreSQL restore list (exit ${tocCopy.status}).`);
    const result = spawnSync('docker', [
      ...execArgs, 'pg_restore', '-U', postgresUser, '-d', 'riviamigo',
      '--no-owner', '--no-privileges', '--clean', '--if-exists', '--exit-on-error', '--single-transaction',
      `--use-list=${remoteToc}`, remoteDump,
    ], { cwd: root, stdio: 'inherit', env: composeEnvironment });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`pg_restore failed with exit code ${result.status}.`);
    run('docker', [
      ...execArgs, 'psql', '-U', postgresUser, '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-c',
      'SELECT timescaledb_post_restore();',
    ]);
  } finally {
    spawnSync('docker', [...execArgs, 'rm', '-f', remoteDump, remoteToc], {
      cwd: root, stdio: 'ignore', env: composeEnvironment,
    });
  }
}

function migrationLedgerEntries(sourceVersion) {
  const migrationsDir = join(root, 'apps', 'api', 'migrations');
  const migrations = readdirSync(migrationsDir)
    .map((fileName) => {
      const match = /^(\d+)_([^.]+)\.sql$/.exec(fileName);
      if (!match) return null;
      const version = Number.parseInt(match[1], 10);
      return {
        version,
        description: match[2].replaceAll("'", "''"),
        checksum: createHash('sha384').update(readFileSync(join(migrationsDir, fileName))).digest('hex'),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.version - right.version);
  const latest = migrations.at(-1)?.version ?? 0;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > latest) {
    throw new Error(`Recovery package migration version ${sourceVersion} is not supported by this release (latest ${latest}).`);
  }
  return migrations.filter((migration) => migration.version <= sourceVersion);
}

function restoreMigrationLedger(postgresUser, manifest) {
  const sourceVersion = manifest.source?.migration_version;
  const entries = migrationLedgerEntries(sourceVersion);
  const values = entries
    .map((entry) => `(${entry.version}, '${entry.description}', TRUE, decode('${entry.checksum}', 'hex'), 0)`)
    .join(',\n      ');
  const sql = `
    CREATE SCHEMA IF NOT EXISTS public;
    CREATE TABLE IF NOT EXISTS public._sqlx_migrations (
      version BIGINT PRIMARY KEY,
      description TEXT NOT NULL,
      installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
      success BOOLEAN NOT NULL,
      checksum BYTEA NOT NULL,
      execution_time BIGINT NOT NULL
    );
    DROP TABLE IF EXISTS riviamigo._sqlx_migrations;
    DELETE FROM public._sqlx_migrations;
    INSERT INTO public._sqlx_migrations (version, description, success, checksum, execution_time)
    VALUES ${values};
  `;
  run('docker', [
    ...composeArgs(), 'exec', '-T', 'timescaledb', 'psql', '-U', postgresUser,
    '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);
}

function restoreArtwork(staging) {
  const cachePath = join(staging, 'vehicle-image-cache');
  run('docker', [
    ...composeArgs(), 'run', '--rm', '--no-deps', '--entrypoint', '/bin/sh',
    '-v', `${cachePath}:/restore-cache:ro`, 'riviamigo', '-c',
    'mkdir -p /data/cache/riviamigo/vehicle-images && rm -rf /data/cache/riviamigo/vehicle-images/* && cp -a /restore-cache/. /data/cache/riviamigo/vehicle-images/',
  ]);
}

async function waitForHealth(url) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const staging = mkdtempSync(join(tmpdir(), 'riviamigo-restore-'));
try {
  const entries = capture('tar', ['-tzf', packagePath]).split(/\r?\n/).filter(Boolean);
  validateArchiveEntries(entries);
  run('tar', ['-xzf', packagePath, '-C', staging]);
  const manifest = verifyManifest(staging);
  const postgresUser = readEnvValue('POSTGRES_USER') ?? 'riviamigo';

  run('docker', [...composeArgs(), 'stop', 'riviamigo']);
  run('docker', [...composeArgs(), 'up', '-d', 'timescaledb']);
  await waitForDatabase(postgresUser);
  ensureDatabaseState(postgresUser);
  if (force) clearApplicationDatabase(postgresUser);
  restoreDatabase(postgresUser, join(staging, 'database.dump'));
  restoreMigrationLedger(postgresUser, manifest);
  restoreBackupSettings(postgresUser, staging);
  restoreArtwork(staging);
  run('docker', [...composeArgs(), 'up', ...(sourceBuild ? ['--build'] : []), '-d', 'riviamigo']);

  const port = readEnvValue('RIVIAMIGO_ORIGIN_PORT') ?? '8080';
  await waitForHealth(`http://localhost:${port}/health`);
  const setup = await fetch(`http://localhost:${port}/v1/auth/setup`).then((response) => response.json());
  if (setup.setup_required) throw new Error('Restore completed but the application reports that setup is still required.');

  console.log(`Restore completed from ${manifest.source?.app_version ?? 'unknown'} into ${project}.`);
  console.log('Provider credentials were intentionally redacted. Reconnect Rivian and other external providers in Settings.');
  console.log('Redis live state, browser sessions, and backup artifact history were intentionally not restored.');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
