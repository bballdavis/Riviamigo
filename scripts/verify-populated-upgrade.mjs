#!/usr/bin/env node
/**
 * Verify the release-safe 0007 upgrade against a populated disposable database.
 *
 * The fixture is deliberately synthetic and is never pointed at a live database:
 * it migrates only through 0006, seeds 250,000 payloads, then starts the
 * candidate API so startup applies 0007 and owns the resumable backfill.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDisposableUpgradeDatabase } from './lib/database-reset-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'apps/api');
const migrationDir = mkdtempSync(join(tmpdir(), 'riviamigo-populated-upgrade-'));
const restoreAgentKey = join(migrationDir, 'restore-agent-key');
writeFileSync(restoreAgentKey, 'populated-upgrade-fixture-key\n', { mode: 0o600 });
const databaseUrl = assertDisposableUpgradeDatabase(process.env);
const port = Number(process.env.UPGRADE_API_PORT ?? 3121);
const baseUrl = `http://127.0.0.1:${port}`;
const payloadCount = 250_000;
const expectedIdentityCount = 200_000;
const upgradeImage = process.env.UPGRADE_IMAGE;
const upgradePlatform = process.env.UPGRADE_PLATFORM;
const containerName = `riviamigo-populated-upgrade-${process.pid}`;
const apiBinary = resolve(apiDir, 'target', 'debug', `riviamigo-api${process.platform === 'win32' ? '.exe' : ''}`);
const fixtureBinary = resolve(
  apiDir,
  'target',
  'debug',
  `charge_identity_upgrade_fixture${process.platform === 'win32' ? '.exe' : ''}`
);

if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('UPGRADE_API_PORT must be an integer between 1024 and 65535.');

const commandEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PGOPTIONS: '-c search_path=public',
};
const runtimeDatabaseUrl = new URL(databaseUrl);
runtimeDatabaseUrl.search =
  '?options=-c%20search_path%3Driviamigo,timeseries,public';
const apiEnv = {
  ...commandEnv,
  DATABASE_URL: runtimeDatabaseUrl.toString(),
  RIVIAMIGO_ENV: 'development',
  PORT: String(port),
  RIVIAMIGO_BIND_ADDRESS: '127.0.0.1',
  ALLOWED_ORIGINS: `${baseUrl},http://localhost:${port}`,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  BACKUP_ARTIFACT_DIR: migrationDir,
  VEHICLE_IMAGE_CACHE_DIR: join(migrationDir, 'vehicle-images'),
  RESTORE_AGENT_KEY_FILE: join(migrationDir, 'restore-agent-key'),
  CHARGE_IDENTITY_BACKFILL_BATCH_SIZE: '1000',
  CHARGE_IDENTITY_BACKFILL_PAUSE_MS: '250',
};
const containerDatabaseUrl = upgradeImage
  ? new URL(runtimeDatabaseUrl)
  : undefined;
if (containerDatabaseUrl) containerDatabaseUrl.hostname = 'host.docker.internal';

let apiProcess;
let apiOutput = '';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: apiDir,
    env: commandEnv,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
}

function runFixture(mode) {
  try {
    return execFileSync(fixtureBinary, [mode], {
      cwd: apiDir,
      env: commandEnv,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('');
    if (output) process.stdout.write(output);
    return null;
  }
}

function parseStats(output) {
  const match = output.match(/status=(\S+) pending=(\d+) payloads=(\d+) identities=(\d+)/);
  if (!match) throw new Error(`Could not parse fixture stats: ${output}`);
  return {
    status: match[1],
    pending: Number(match[2]),
    payloads: Number(match[3]),
    identities: Number(match[4]),
  };
}

function fixtureStats() {
  const output = runFixture('--stats');
  if (!output) throw new Error('Fixture stats command failed.');
  process.stdout.write(output);
  return parseStats(output);
}

function installPreUpgradeMigrations() {
  const migrationFiles = readdirSync(resolve(apiDir, 'migrations'))
    .filter((name) => /^000[1-6]_.*\.sql$/.test(name))
    .sort();
  if (migrationFiles.length !== 6)
    throw new Error(`Expected exactly six pre-0007 migrations, found ${migrationFiles.length}.`);
  for (const file of migrationFiles) copyFileSync(resolve(apiDir, 'migrations', file), join(migrationDir, file));
}

function resetUpgradeDatabase() {
  try {
    run('cargo', ['sqlx', 'database', 'drop', '-y', '--force'], { stdio: 'pipe' });
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('');
    if (!/does not exist/i.test(output)) throw error;
  }
  run('cargo', ['sqlx', 'database', 'create']);
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (apiProcess?.exitCode !== null && apiProcess?.exitCode !== undefined)
      throw new Error(`API exited with code ${apiProcess.exitCode} before becoming healthy.\n${apiOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The API is still applying fast startup schema or bootstrapping dependencies.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health.\n${apiOutput}`);
}

async function waitForProgress(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stats = fixtureStats();
    if (stats.pending > 0 && stats.pending < payloadCount) return stats;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error('The API did not demonstrate partial backfill progress before the timeout.');
}

async function waitForCompletion(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = runFixture('--check-complete');
    if (output) {
      process.stdout.write(output);
      return parseStats(output);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  }
  throw new Error('The populated charge identity backfill did not complete before the timeout.');
}

function startApi() {
  apiOutput = '';
  const command = upgradeImage ? 'docker' : apiBinary;
  const args = upgradeImage
    ? [
        'run',
        '--rm',
        '--name',
        containerName,
        '--platform',
        upgradePlatform ?? 'linux/amd64',
        '--add-host',
        'host.docker.internal:host-gateway',
        '-p',
        `${port}:8080`,
        '-e',
        `DATABASE_URL=${containerDatabaseUrl}`,
        '-e',
        `REDIS_URL=${apiEnv.REDIS_URL.replace('127.0.0.1', 'host.docker.internal')}`,
        '-e',
        'RIVIAMIGO_ENV=development',
        '-e',
        'PORT=3001',
        '-e',
        'RIVIAMIGO_BIND_ADDRESS=127.0.0.1',
        '-e',
        `ALLOWED_ORIGINS=${baseUrl}`,
        '-e',
        'COOKIE_INSECURE=true',
        '-e',
        'BACKUP_ARTIFACT_DIR=/backups',
        '-e',
        'RESTORE_AGENT_KEY_FILE=/backups/.restore-agent-key',
        '-e',
        'CHARGE_IDENTITY_BACKFILL_BATCH_SIZE=1000',
        '-e',
        'CHARGE_IDENTITY_BACKFILL_PAUSE_MS=250',
        '-v',
        `${restoreAgentKey}:/backups/.restore-agent-key:ro`,
        upgradeImage,
      ]
    : [];
  apiProcess = spawn(command, args, {
    cwd: upgradeImage ? root : apiDir,
    env: upgradeImage ? process.env : apiEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  apiProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    apiOutput += text;
    process.stdout.write(`[upgrade-api] ${text}`);
  });
  apiProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    apiOutput += text;
    process.stderr.write(`[upgrade-api] ${text}`);
  });
  return apiProcess;
}

async function stopApi() {
  if (!apiProcess) return;
  const processToStop = apiProcess;
  apiProcess = undefined;
  if (processToStop.exitCode === null) processToStop.kill('SIGTERM');
  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      if (processToStop.exitCode === null) processToStop.kill('SIGKILL');
      resolveStop();
    }, 10_000);
    processToStop.once('close', () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
  if (upgradeImage) {
    try {
      execFileSync('docker', ['rm', '--force', containerName], {
        cwd: root,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // --rm normally removed the container when docker run exited.
    }
  }
}

async function main() {
  console.log(`Using disposable upgrade database ${new URL(databaseUrl).pathname.slice(1)}.`);
  installPreUpgradeMigrations();
  resetUpgradeDatabase();
  run('cargo', ['sqlx', 'migrate', 'run', '--source', migrationDir]);
  run('cargo', ['build', '--bin', 'riviamigo-api', '--bin', 'charge_identity_upgrade_fixture']);
  const seeded = runFixture('--seed');
  if (!seeded) throw new Error('Synthetic charge payload fixture seeding failed.');
  process.stdout.write(seeded);

  if (!existsSync(apiBinary) || !existsSync(fixtureBinary))
    throw new Error('Expected candidate API and fixture binaries were not built.');

  startApi();
  await waitForHealth(120_000);
  const healthyBeforeCompletion = await waitForProgress(120_000);
  if (healthyBeforeCompletion.pending <= 0 || healthyBeforeCompletion.pending >= payloadCount)
    throw new Error('Health did not precede a still-pending backfill.');
  console.log('Health-first startup confirmed while the populated backfill was still pending.');

  await stopApi();
  const interrupted = fixtureStats();
  if (interrupted.pending <= 0)
    throw new Error('The interruption checkpoint unexpectedly had no pending rows.');
  console.log(`Interrupted with ${interrupted.pending} pending rows; restarting the candidate API.`);

  startApi();
  await waitForHealth(120_000);
  const completed = await waitForCompletion(600_000);
  if (
    completed.pending !== 0 ||
    completed.payloads !== payloadCount ||
    completed.identities !== expectedIdentityCount
  ) {
    throw new Error(`Unexpected completed fixture state: ${JSON.stringify(completed)}`);
  }
  await stopApi();

  startApi();
  await waitForHealth(120_000);
  const idempotent = runFixture('--check-complete');
  if (!idempotent) throw new Error('Completed fixture failed after the second API restart.');
  process.stdout.write(idempotent);
  console.log('Restart-safe completion and duplicate-free identity count confirmed.');
  await stopApi();
}

try {
  await main();
  console.log('Populated charge identity upgrade verification passed.');
} finally {
  await stopApi();
  rmSync(migrationDir, { recursive: true, force: true });
}
