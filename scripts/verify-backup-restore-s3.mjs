#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nonce = Date.now().toString(36);
const sourceBuild = process.argv.includes('--source-build');
const garageProject = `riviamigo-s3-drill-${nonce}`;
const sourceProject = `${garageProject}-source`;
const targetProject = `${garageProject}-target`;
const garagePort = 23900 + Math.floor(Math.random() * 500);
const sourcePort = garagePort + 1000;
const targetPort = garagePort + 2000;
const tempRoot = mkdtempSync(join(tmpdir(), 'riviamigo-s3-drill-'));
const prefix = `drill/${nonce}`;
const sourcePassword = `source-${nonce}-password`;
const targetPassword = `target-${nonce}-password`;
const s3AccessKey = 'GKdeadbeef0000000000000000000000';
const s3SecretKey = 'deadbeef0000000000000000000000000000000000000000000000000000cafe';
const projects = [];

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function initializeGarage() {
  const garage = ['compose', '-p', garageProject, '-f', 'compose/docker-compose.dev.yml', 'exec', '-T', 'garage', '/garage', '-c', '/config/garage.toml'];
  const nodeId = execFileSync('docker', [...garage, 'node', 'id'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/)[0];
  run('docker', [...garage, 'layout', 'assign', nodeId, '-z', 'dc1', '-c', '1G']);
  run('docker', [...garage, 'layout', 'apply', '--version', '1']);
  run('docker', [...garage, 'key', 'import', '--yes', '-n', 'dev-key', s3AccessKey, s3SecretKey]);
  run('docker', [...garage, 'bucket', 'create', 'riviamigo']);
  run('docker', [...garage, 'bucket', 'allow', '--read', '--write', '--owner', 'riviamigo', '--key', s3AccessKey]);
}

async function waitFor(url, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* retry */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function environmentFile(name, port) {
  const path = join(tempRoot, `${name}.env`);
  writeFileSync(path, [
    `DATABASE_URL=postgresql://riviamigo:${name}-db-password@timescaledb:5432/riviamigo`,
    `POSTGRES_PASSWORD=${name}-db-password`,
    `REDIS_PASSWORD=${name}-redis-password`,
    `REDIS_URL=redis://default:${name}-redis-password@redis:6379`,
    `ALLOWED_ORIGINS=http://localhost:${port}`,
    'RIVIAMIGO_ENV=development',
    'COOKIE_INSECURE=1',
    'BACKUP_ARTIFACT_DIR=/backups',
    'VEHICLE_IMAGE_CACHE_DIR=/data/cache/riviamigo/vehicle-images',
    'RUST_LOG=riviamigo_api=info,tower_http=info',
  ].join('\n') + '\n');
  return path;
}

function composeArgs(project, envFile) {
  return ['compose', '-p', project, '-f', 'compose/docker-compose.yml', '-f', 'compose/docker-compose.backup-drill.yml', ...(sourceBuild ? ['-f', 'compose/docker-compose.build.yml'] : []), '--env-file', envFile];
}

async function request(baseUrl, path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  return payload;
}

async function register(baseUrl, email, password) {
  const result = await request(baseUrl, '/v1/auth/register', { method: 'POST', body: { email, password } });
  if (!result.access_token) throw new Error('Registration did not return an access token.');
  return result.access_token;
}

async function login(baseUrl, email, password) {
  const result = await request(baseUrl, '/v1/auth/login', { method: 'POST', body: { email, password } });
  if (!result.access_token) throw new Error('Login did not return an access token.');
  return result.access_token;
}

function backupSettings(endpoint) {
  return {
    enabled: false, frequency: 'daily', run_at: '03:00', timezone: 'UTC', day_of_week: null, day_of_month: null,
    retention_count: 3, local_enabled: true, s3_enabled: true, target_type: 's3', endpoint, region: 'garage',
    bucket: 'riviamigo', prefix, access_key: s3AccessKey, secret_key: s3SecretKey,
  };
}

function startStack(project, dataDir, envFile, port) {
  const env = { ...process.env, RIVIAMIGO_DATA_DIR: dataDir.replaceAll('\\', '/'), RIVIAMIGO_ENV_FILE: envFile, RIVIAMIGO_ORIGIN_PORT: String(port) };
  run('docker', [...composeArgs(project, envFile), 'up', ...(sourceBuild ? ['--build'] : []), '-d'], { env });
  projects.push({ project, envFile, env });
}

function runDataCommand(dataDir, script) {
  run('docker', ['run', '--rm', '--user', '0:0', '--mount', `type=bind,source=${dataDir},target=/data`, 'alpine:3.22.1', 'sh', '-ceu', script]);
}

function createArtworkSentinel(dataDir) {
  runDataCommand(dataDir, `mkdir -p /data/cache/riviamigo/vehicle-images/drill && printf %s '${nonce}' > /data/cache/riviamigo/vehicle-images/drill/sentinel.txt`);
}

function removeLocalPackages(dataDir) {
  runDataCommand(dataDir, `find /data/backups -type f -name '*.rma.tar.gz' -delete`);
}

function verifyArtworkSentinel(dataDir) {
  runDataCommand(dataDir, `test "$(cat /data/cache/riviamigo/vehicle-images/drill/sentinel.txt)" = '${nonce}'`);
}

function cleanupData() {
  const cleanup = spawnSync('docker', ['run', '--rm', '--user', '0:0', '--mount', `type=bind,source=${tempRoot},target=/cleanup`, 'alpine:3.22.1', 'sh', '-c', 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?*'], { cwd: root, stdio: 'ignore' });
  if (cleanup.status === 0) rmSync(tempRoot, { recursive: true, force: true });
}

try {
  run('docker', ['compose', '-p', garageProject, '-f', 'compose/docker-compose.dev.yml', 'up', '-d', '--wait', 'garage'], { env: { ...process.env, DEV_GARAGE_PORT: String(garagePort), DEV_GARAGE_ADMIN_PORT: String(garagePort + 3) } });
  initializeGarage();
  const endpoint = `http://host.docker.internal:${garagePort}`;

  const sourceData = join(tempRoot, 'source');
  const sourceEnv = environmentFile('source', sourcePort);
  startStack(sourceProject, sourceData, sourceEnv, sourcePort);
  const sourceUrl = `http://localhost:${sourcePort}`;
  await waitFor(`${sourceUrl}/health`);
  const sourceToken = await register(sourceUrl, 'source-owner@example.test', sourcePassword);
  createArtworkSentinel(sourceData);
  await request(sourceUrl, '/v1/admin/backups/settings', { token: sourceToken, method: 'PUT', body: backupSettings(endpoint) });
  await request(sourceUrl, '/v1/admin/backups/s3/test', { token: sourceToken, method: 'POST', body: backupSettings(endpoint) });
  const backup = await request(sourceUrl, '/v1/admin/backups/run', { token: sourceToken, method: 'POST' });
  if (!backup.artifacts?.some((artifact) => artifact.storage_type === 'local') || !backup.artifacts?.some((artifact) => artifact.storage_type === 's3')) throw new Error('Combined backup did not publish both Local and S3 artifacts.');
  removeLocalPackages(sourceData);

  const targetData = join(tempRoot, 'target');
  const targetEnv = environmentFile('target', targetPort);
  startStack(targetProject, targetData, targetEnv, targetPort);
  const targetUrl = `http://localhost:${targetPort}`;
  await waitFor(`${targetUrl}/health`);
  const targetToken = await register(targetUrl, 'target-owner@example.test', targetPassword);
  await request(targetUrl, '/v1/admin/backups/settings', { token: targetToken, method: 'PUT', body: backupSettings(endpoint) });
  const overview = await request(targetUrl, '/v1/admin/backups', { token: targetToken });
  const remote = overview.artifacts?.find((artifact) => artifact.storage_type === 's3');
  if (!remote) throw new Error('Clean target did not discover the Garage recovery package.');
  const started = await request(targetUrl, '/v1/admin/backups/restores', { token: targetToken, method: 'POST', body: { artifact_id: remote.id, confirmation_phrase: 'RESTORE', notes: 'Automated S3 drill' } });
  const deadline = Date.now() + 360000;
  let phase;
  while (Date.now() < deadline) {
    try {
      const job = await fetch(`${targetUrl}/v1/restore-runtime/jobs/${started.job.id}`, { headers: { 'x-riviamigo-restore-token': started.capability_token } }).then((response) => response.json());
      phase = job.phase;
      if (phase === 'failed') throw new Error(job.error_message || 'Remote restore failed.');
      if (phase === 'completed') break;
    } catch (error) { if (String(error).includes('Remote restore failed')) throw error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  if (phase !== 'completed') throw new Error(`Remote restore did not complete; final phase was ${phase ?? 'unknown'}.`);
  await waitFor(`${targetUrl}/health`);
  const restoredToken = await login(targetUrl, 'source-owner@example.test', sourcePassword);
  const dashboards = await request(targetUrl, '/v1/dashboards', { token: restoredToken });
  if (!Array.isArray(dashboards) || dashboards.length < 5) throw new Error('Restored source dashboards were not available.');
  verifyArtworkSentinel(targetData);
  const restoredOverview = await request(targetUrl, '/v1/admin/backups', { token: restoredToken });
  if (restoredOverview.settings.has_secret_key) throw new Error('The S3 secret key was unexpectedly present after restore.');
  await request(targetUrl, '/v1/admin/backups/settings', { token: restoredToken, method: 'PUT', body: backupSettings(endpoint) });
  await request(targetUrl, '/v1/admin/backups/s3/test', { token: restoredToken, method: 'POST', body: backupSettings(endpoint) });
  console.log('S3 backup and clean-target restore drill passed.');
} catch (error) {
  for (const item of projects) spawnSync('docker', [...composeArgs(item.project, item.envFile), 'logs', '--no-color', '--tail', '200'], { cwd: root, stdio: 'inherit', env: item.env });
  throw error;
} finally {
  for (const item of projects.reverse()) spawnSync('docker', [...composeArgs(item.project, item.envFile), 'down', '-v', '--remove-orphans'], { cwd: root, stdio: 'ignore', env: item.env });
  spawnSync('docker', ['compose', '-p', garageProject, '-f', 'compose/docker-compose.dev.yml', 'down', '-v', '--remove-orphans'], { cwd: root, stdio: 'ignore', env: { ...process.env, DEV_GARAGE_PORT: String(garagePort), DEV_GARAGE_ADMIN_PORT: String(garagePort + 3) } });
  cleanupData();
}
