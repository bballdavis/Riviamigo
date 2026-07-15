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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
}

function capture(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8', ...options }).trim();
}

async function waitForDatabase(postgresUser) {
  const deadline = Date.now() + 120000;
  const args = [
    ...composeArgs(), 'exec', '-T', 'timescaledb',
    'pg_isready', '-U', postgresUser, '-d', 'riviamigo',
  ];
  while (Date.now() < deadline) {
    const result = spawnSync('docker', args, { cwd: root, stdio: 'ignore' });
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
    INSERT INTO riviamigo.backup_settings (
      id, enabled, frequency, run_at, timezone, day_of_week, day_of_month,
      retention_count, target_type, endpoint, region, bucket, prefix, access_key,
      secret_key_encrypted, updated_at, updated_by
    )
    SELECT TRUE, enabled, frequency, run_at::time, timezone, day_of_week, day_of_month,
      retention_count, target_type, endpoint, region, bucket, prefix, access_key,
      NULL, now(), NULL
    FROM jsonb_to_record('${jsonLiteral}'::jsonb) AS x(
      enabled boolean, frequency text, run_at text, timezone text,
      day_of_week smallint, day_of_month smallint, retention_count integer,
      target_type text, endpoint text, region text, bucket text, prefix text,
      access_key text
    )
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency,
      run_at = EXCLUDED.run_at, timezone = EXCLUDED.timezone,
      day_of_week = EXCLUDED.day_of_week, day_of_month = EXCLUDED.day_of_month,
      retention_count = EXCLUDED.retention_count, target_type = EXCLUDED.target_type,
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
  const result = spawnSync('docker', [
    ...composeArgs(), 'exec', '-T', 'timescaledb', 'pg_restore', '-U', postgresUser, '-d', 'riviamigo',
    '--no-owner', '--no-privileges', '--clean', '--if-exists', '--exit-on-error',
  ], { cwd: root, input: readFileSync(dumpPath), stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pg_restore failed with exit code ${result.status}.`);
}

function restoreArtwork(staging) {
  const cachePath = join(staging, 'vehicle-image-cache');
  run('docker', [
    ...composeArgs(), 'run', '--rm', '--no-deps', '--entrypoint', '/bin/sh',
    '-v', `${cachePath}:/restore-cache:ro`, 'api', '-c',
    'mkdir -p /data/vehicle-image-cache && rm -rf /data/vehicle-image-cache/* && cp -a /restore-cache/. /data/vehicle-image-cache/',
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

  run('docker', [...composeArgs(), 'stop', 'api', 'nginx']);
  run('docker', [...composeArgs(), 'up', '-d', 'timescaledb']);
  await waitForDatabase(postgresUser);
  ensureDatabaseState(postgresUser);
  if (force) clearApplicationDatabase(postgresUser);
  restoreDatabase(postgresUser, join(staging, 'database.dump'));
  restoreBackupSettings(postgresUser, staging);
  restoreArtwork(staging);
  run('docker', [...composeArgs(), 'up', ...(sourceBuild ? ['--build'] : []), '-d', 'api', 'nginx']);

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
