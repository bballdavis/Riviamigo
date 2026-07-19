#!/usr/bin/env node
/**
 * Disposable new-user verification. Run from a clean worktree:
 *   node scripts/verify-fresh-install.mjs --mode all --production-env /path/to/fresh.env --source-build
 * The env file is intentionally caller-owned: it must contain valid production
 * secrets and is never copied into this repository or logged by this script.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
const compose = [
  'compose',
  '-p',
  project,
  '-f',
  'compose/docker-compose.yml',
  ...(sourceBuild ? ['-f', 'compose/docker-compose.build.yml'] : []),
];
let productionStarted = false;
let productionEnvironment;

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

async function verifyOwnerSetup(baseUrl) {
  await waitFor(`${baseUrl}/health`);
  const setup = await fetch(`${baseUrl}/v1/auth/setup`).then((response) => response.json());
  if (!setup.setup_required) throw new Error('Fresh stack unexpectedly already has a user.');
  const first = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'fresh-install-password' }),
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
  const environment = {
    ...process.env,
    RIVIAMIGO_ORIGIN_PORT: port,
    RIVIAMIGO_ENV_FILE: resolve(productionEnv),
    ...(imageTag ? { IMAGE_TAG: imageTag } : {}),
  };
  productionEnvironment = environment;
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
}

function printProductionLogs() {
  if (!productionStarted) return;
  console.error('Published production smoke-test container logs:');
  spawnSync(
    'docker',
    [...compose, '--env-file', productionEnv, 'logs', '--no-color', '--tail', '200', 'app'],
    { cwd: root, stdio: 'inherit', env: productionEnvironment }
  );
}

function verifyDevSmoke() {
  const env = { ...process.env, DEV_COMPOSE_PROJECT_NAME: `${project}-dev` };
  run('pnpm', ['run', 'dev:stack', '--', '--once'], { env, shell: process.platform === 'win32' });
}

try {
  ensureCleanWorktree();
  if (!['all', 'production', 'dev'].includes(mode))
    throw new Error('--mode must be all, production, or dev.');
  if (mode === 'all' || mode === 'dev') verifyDevSmoke();
  if (mode === 'all' || mode === 'production') await verifyProduction();
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
}
