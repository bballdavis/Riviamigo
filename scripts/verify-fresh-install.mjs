#!/usr/bin/env node
/**
 * Disposable new-user verification. Run from a clean worktree:
 *   node scripts/verify-fresh-install.mjs --mode standard --production-env /path/to/fresh.env --source-build
 *   node scripts/verify-fresh-install.mjs --mode synology --production-env /path/to/fresh.env
 * The env file is intentionally caller-owned: it must contain valid production
 * secrets and is never copied into this repository or logged by this script.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const mode = value('--mode') ?? 'all';
const productionEnv = value('--production-env');
const imageTag = value('--image-tag');
const sourceBuild = args.includes('--source-build');
const project = `riviamigo-fresh-${Date.now().toString(36)}`;
const port = String(18080 + Math.floor(Math.random() * 1000));
const composeFile =
  mode === 'synology' ? 'compose/docker-compose.synology.yml' : 'compose/docker-compose.yml';
const compose = [
  'compose',
  '-p',
  project,
  '-f',
  composeFile,
  ...(sourceBuild ? ['-f', 'compose/docker-compose.build.yml'] : []),
];
let productionStarted = false;
let productionEnvironment;
let productionDataRoot;

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
}

function ensureCleanWorktree() {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (status)
    throw new Error(
      'Fresh-install verification requires a clean worktree. Run it from an isolated worktree or checkout.'
    );
}

async function waitFor(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function readEnvValue(file, name) {
  const prefix = `${name}=`;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix) && !entry.startsWith('#'));
  if (!line) return undefined;

  const rawValue = line.slice(prefix.length).trim();
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function readSetupToken(file) {
  const inline = readEnvValue(file, 'RIVIAMIGO_SETUP_TOKEN');
  if (inline) return inline;

  const tokenFile = readEnvValue(file, 'RIVIAMIGO_SETUP_TOKEN_FILE');
  if (tokenFile && existsSync(tokenFile)) return readFileSync(tokenFile, 'utf8').trimEnd();
  return undefined;
}

async function verifyOwnerSetup(baseUrl) {
  await waitFor(`${baseUrl}/health`);
  const setup = await fetch(`${baseUrl}/v1/auth/setup`).then((response) => response.json());
  if (!setup.setup_required) throw new Error('Fresh stack unexpectedly already has a user.');
  const setupToken = setup.setup_proof_required ? readSetupToken(productionEnv) : undefined;
  if (setup.setup_proof_required && !setupToken)
    throw new Error(
      'Production first-owner verification requires RIVIAMIGO_SETUP_TOKEN in the supplied env file.'
    );
  const first = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'owner@example.test',
      password: 'fresh-install-password',
      ...(setupToken ? { setup_token: setupToken } : {}),
    }),
  });
  if (first.status !== 201)
    throw new Error(`First owner registration failed with ${first.status}.`);
  const firstBody = await first.json();
  const accessToken = firstBody.access_token;
  if (!accessToken) throw new Error('First owner registration did not return an access token.');
  await verifyBundledDashboards(baseUrl, accessToken);
  const closed = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'second@example.test', password: 'fresh-install-password' }),
  });
  if (closed.status !== 403)
    throw new Error(`Registration remained open after owner setup (status ${closed.status}).`);
}

async function verifyBundledDashboards(baseUrl, accessToken) {
  const response = await fetch(`${baseUrl}/v1/dashboards`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Fresh dashboard list failed with ${response.status}.`);

  const rows = await response.json();
  const expectedFiles = ['dashboard', 'battery', 'efficiency', 'charging', 'trips'];
  if (
    rows.filter((row) => row.owner_id == null && row.is_default === true).length !==
    expectedFiles.length
  ) {
    throw new Error('Fresh install did not seed exactly five system dashboards.');
  }

  for (const slug of expectedFiles) {
    const expected = JSON.parse(
      readFileSync(
        resolve(root, 'packages', 'dashboards', 'src', 'defaults', `${slug}.json`),
        'utf8'
      )
    );
    const row = rows.find((entry) => entry.owner_id == null && entry.slug === expected.slug);
    if (!row) throw new Error(`Fresh install is missing the ${expected.slug} system dashboard.`);
    if (JSON.stringify(sortJson(row.config)) !== JSON.stringify(sortJson(expected))) {
      throw new Error(
        `Fresh install ${expected.slug} dashboard does not match its bundled baseline.`
      );
    }
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

async function verifyProduction() {
  if (!productionEnv || !existsSync(productionEnv))
    throw new Error('--production-env must point to a valid, ephemeral production env file.');
  productionDataRoot = mkdtempSync(join(tmpdir(), 'riviamigo-fresh-data-'));
  const environment = {
    ...process.env,
    RIVIAMIGO_ORIGIN_PORT: port,
    RIVIAMIGO_ENV_FILE: resolve(productionEnv),
    RIVIAMIGO_DATA_DIR: productionDataRoot.replaceAll('\\', '/'),
    ...(imageTag ? { IMAGE_TAG: imageTag } : {}),
  };
  productionEnvironment = environment;
  run('sh', ['compose/prepare-data.sh'], { env: environment });
  run('docker', [...compose, '--env-file', productionEnv, 'config', '--quiet'], {
    env: environment,
  });
  run(
    'docker',
    [...compose, '--env-file', productionEnv, 'up', ...(sourceBuild ? ['--build'] : []), '-d'],
    { env: environment }
  );
  productionStarted = true;
  await verifyOwnerSetup(`http://localhost:${port}`);
  run('docker', [...compose, '--env-file', productionEnv, 'restart', 'riviamigo'], {
    env: productionEnvironment,
  });
  await waitFor(`http://localhost:${port}/health`);
  const persistedSetup = await fetch(`http://localhost:${port}/v1/auth/setup`).then((response) =>
    response.json()
  );
  if (persistedSetup.setup_required)
    throw new Error(`${composeFile} restart did not preserve the first owner.`);
}

function printProductionLogs() {
  if (!productionStarted) return;
  console.error('Published production smoke-test container logs:');
  spawnSync(
    'docker',
    [...compose, '--env-file', productionEnv, 'logs', '--no-color', '--tail', '200', 'riviamigo'],
    { cwd: root, stdio: 'inherit', env: productionEnvironment }
  );
}

function verifyDevSmoke() {
  const env = { ...process.env, DEV_COMPOSE_PROJECT_NAME: `${project}-dev` };
  run('pnpm', ['run', 'dev:stack', '--', '--once'], { env, shell: process.platform === 'win32' });
}

function cleanupProductionDataRoot() {
  if (!productionDataRoot) return;
  try {
    rmSync(productionDataRoot, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error;
    // PostgreSQL and Redis run as container users and can leave root-owned
    // files in the bind-mounted disposable directory. Remove only this
    // generated temp root through a short-lived root container, then retry.
    const cleanup = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--user',
        '0:0',
        '--mount',
        `type=bind,source=${productionDataRoot},target=/cleanup`,
        'alpine:3.22.1',
        'sh',
        '-c',
        'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?*',
      ],
      { cwd: root, stdio: 'inherit' }
    );
    if (cleanup.status !== 0) throw error;
    rmSync(productionDataRoot, { recursive: true, force: true });
  }
}

try {
  ensureCleanWorktree();
  if (!['all', 'standard', 'synology', 'production', 'dev'].includes(mode))
    throw new Error('--mode must be all, standard, synology, production, or dev.');
  if (mode === 'all' || mode === 'dev') verifyDevSmoke();
  if (mode === 'all' || mode === 'standard' || mode === 'production' || mode === 'synology')
    await verifyProduction();
  console.log('Fresh-install verification passed.');
} catch (error) {
  printProductionLogs();
  throw error;
} finally {
  if (productionStarted)
    spawnSync(
      'docker',
      [...compose, '--env-file', productionEnv, 'down', '-v', '--remove-orphans'],
      { cwd: root, stdio: 'inherit', env: productionEnvironment }
    );
  cleanupProductionDataRoot();
}
