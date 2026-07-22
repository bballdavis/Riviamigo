#!/usr/bin/env node
/**
 * Compose orchestration for the shared Rust restore engine.
 *
 * Usage:
 *   node scripts/restore-backup.mjs --package ./backup.rma.tar.gz \
 *     --env-file ./.env --source-build
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const requiredArgument = (name) => {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const packagePath = resolve(requiredArgument('--package'));
const envFile = resolve(argument('--env-file', '.env'));
const project = argument('--project', `riviamigo-restore-${Date.now().toString(36)}`);
const force = args.includes('--force');
const sourceBuild = args.includes('--source-build');
const skipBuild = args.includes('--skip-build');
if (!existsSync(packagePath)) throw new Error(`Recovery package does not exist: ${packagePath}`);
if (!existsSync(envFile)) throw new Error(`Compose env file does not exist: ${envFile}`);

const environment = { ...process.env, RIVIAMIGO_ENV_FILE: envFile };
const compose = [
  'compose', '-p', project, '--env-file', envFile,
  '-f', 'compose/docker-compose.yml',
  ...(sourceBuild ? ['-f', 'compose/docker-compose.build.yml'] : []),
];
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, {
  cwd: root,
  stdio: 'inherit',
  env: environment,
  ...options,
});
const readEnvValue = (name) => {
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
};

async function waitForDatabase() {
  const postgresUser = readEnvValue('POSTGRES_USER') ?? 'riviamigo';
  const deadline = Date.now() + 120_000;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    const result = spawnSync('docker', [
      ...compose, 'exec', '-T', 'timescaledb', 'psql',
      '-U', postgresUser, '-d', 'riviamigo', '-At', '-c', 'SELECT 1',
    ], { cwd: root, stdio: 'ignore', env: environment });
    stableChecks = result.status === 0 ? stableChecks + 1 : 0;
    if (stableChecks >= 5) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error('Timed out waiting for stable PostgreSQL readiness.');
}

async function waitForHealth(url) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The application is expected to be unavailable while the database swaps.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const engineRun = (command, extraArgs = []) => run('docker', [
  ...compose,
  'run', '--rm', '--no-deps',
  '--entrypoint', '/app/riviamigo-restore-agent',
  ...(command === 'host-restore' ? ['-v', `${packagePath}:/restore-package:ro`] : []),
  'riviamigo', command,
  ...(command === 'host-restore' ? ['/restore-package'] : []),
  ...extraArgs,
]);

let candidateActivated = false;
let candidatePrepared = false;
try {
  if (sourceBuild && !skipBuild) run('docker', [...compose, 'build', 'riviamigo']);
  run('docker', [...compose, 'up', '-d', 'timescaledb']);
  await waitForDatabase();
  engineRun('host-restore', force ? ['--force'] : []);
  candidatePrepared = true;

  run('docker', [...compose, 'stop', 'riviamigo']);
  engineRun('host-activate');
  candidateActivated = true;

  run('docker', [...compose, 'up', '-d', 'riviamigo']);
  const port = readEnvValue('RIVIAMIGO_ORIGIN_PORT') ?? '8080';
  const origin = `http://localhost:${port}`;
  await waitForHealth(`${origin}/health`);
  const setup = await fetch(`${origin}/v1/auth/setup`).then((response) => response.json());
  if (setup.setup_required) throw new Error('Restored application unexpectedly requires setup.');

  engineRun('host-finalize');
  candidateActivated = false;
  candidatePrepared = false;
  console.log(`Restore completed into Compose project ${project}.`);
  console.log('Provider credentials and live sessions were intentionally excluded and require reauthentication.');
} catch (error) {
  if (candidatePrepared) {
    spawnSync('docker', [...compose, 'stop', 'riviamigo'], { cwd: root, stdio: 'inherit', env: environment });
    try {
      engineRun('host-rollback');
      if (candidateActivated) {
        run('docker', [...compose, 'up', '-d', 'riviamigo']);
        console.error('Restore verification failed; the previous database and artwork were restored.');
      } else {
        console.error('Restore preparation failed; the isolated candidate was discarded.');
      }
    } catch (rollbackError) {
      console.error('Automatic rollback failed. The retained restore state must be recovered before retrying.', rollbackError);
    }
  }
  throw error;
}
