#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
const reportPath = join(root, 'tools', 'restore-lab', 'local', 'reports', `s3-${nonce}.json`);
let report = { status: 'failed', created_at: new Date().toISOString() };

function imageIdentity(project, envFile, env) {
  const container = execFileSync('docker', [...composeArgs(project, envFile), 'ps', '-q', 'riviamigo'],
    { cwd: root, env, encoding: 'utf8' }).trim();
  return execFileSync('docker', ['inspect', '--format', '{{.Image}}', container],
    { cwd: root, encoding: 'utf8' }).trim();
}

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
    `S3_ENDPOINT=http://host.docker.internal:${garagePort}`,
    'S3_ALLOW_DEVELOPMENT_GARAGE=true',
    'COOKIE_INSECURE=true',
    'BACKUP_ARTIFACT_DIR=/backups',
    'VEHICLE_IMAGE_CACHE_DIR=/data/cache/riviamigo/vehicle-images',
    'RUST_LOG=riviamigo_api=info,riviamigo_restore_agent=error,tower_http=info',
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
  projects.push({ project, envFile, env });
  run('docker', [...composeArgs(project, envFile), 'up', ...(sourceBuild ? ['--build'] : []), '-d'], { env });
}

function runDataCommand(dataDir, script) {
  run('docker', ['run', '--rm', '--user', '0:0', '--mount', `type=bind,source=${dataDir},target=/data`, 'alpine:3.22.1', 'sh', '-ceu', script]);
}

async function waitForBackupCompletion(baseUrl, token, runId) {
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    const overview = await request(baseUrl, '/v1/admin/backups?per_page=100', { token });
    const run = overview.recent_runs?.find((candidate) => candidate.id === runId);
    if (run?.status === 'failed' || run?.status === 'canceled') {
      throw new Error(`Backup run ${runId} ${run.status}: ${run.error_message || 'no error message'}`);
    }
    if (run?.status === 'succeeded') {
      const artifacts = overview.artifacts?.filter((artifact) => artifact.run_id === runId) ?? [];
      if (artifacts.some((artifact) => artifact.storage_type === 'local') && artifacts.some((artifact) => artifact.storage_type === 's3')) {
        return { run, artifacts };
      }
      throw new Error(`Backup run ${runId} succeeded without both local and S3 artifacts.`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Backup run ${runId} did not complete before the timeout.`);
}

function prepareDataDirectory(dataDir) {
  // Docker creates missing bind-mounted subdirectories as root. The API image
  // intentionally runs as UID 1001, so prepare the disposable drill paths
  // before the service starts instead of weakening the production image.
  mkdirSync(dataDir, { recursive: true });
  runDataCommand(
    dataDir,
    'mkdir -p /data/backups /data/cache && (chown 1001:1001 /data/backups /data/cache && chmod 0770 /data/backups /data/cache || chmod 0777 /data/backups /data/cache)'
  );
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
  const cleanupRelative = relative(resolve(tmpdir()), resolve(tempRoot));
  if (!cleanupRelative || cleanupRelative.startsWith('..') || !basename(tempRoot).startsWith('riviamigo-s3-drill-'))
    throw new Error('Refusing cleanup outside the disposable S3 drill directory.');
  const cleanup = spawnSync('docker', ['run', '--rm', '--user', '0:0', '--mount', `type=bind,source=${tempRoot},target=/cleanup`, 'alpine:3.22.1', 'sh', '-c', 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?*'], { cwd: root, stdio: 'ignore' });
  if (cleanup.status === 0) rmSync(tempRoot, { recursive: true, force: true });
}

try {
  run('docker', ['compose', '-p', garageProject, '-f', 'compose/docker-compose.dev.yml', 'up', '-d', '--wait', 'garage'], { env: { ...process.env, DEV_GARAGE_PORT: String(garagePort), DEV_GARAGE_ADMIN_PORT: String(garagePort + 3) } });
  initializeGarage();
  const endpoint = `http://host.docker.internal:${garagePort}`;

  const sourceData = join(tempRoot, 'source');
  const sourceEnv = environmentFile('source', sourcePort);
  prepareDataDirectory(sourceData);
  startStack(sourceProject, sourceData, sourceEnv, sourcePort);
  const sourceUrl = `http://localhost:${sourcePort}`;
  await waitFor(`${sourceUrl}/health`);
  const sourceToken = await register(sourceUrl, 'source-owner@example.test', sourcePassword);
  createArtworkSentinel(sourceData);
  await request(sourceUrl, '/v1/admin/backups/settings', { token: sourceToken, method: 'PUT', body: backupSettings(endpoint) });
  await request(sourceUrl, '/v1/admin/backups/s3/test', { token: sourceToken, method: 'POST', body: backupSettings(endpoint) });
  const backup = await request(sourceUrl, '/v1/admin/backups/run', { token: sourceToken, method: 'POST' });
  await waitForBackupCompletion(sourceUrl, sourceToken, backup.run.id);
  removeLocalPackages(sourceData);

  const targetData = join(tempRoot, 'target');
  const targetEnv = environmentFile('target', targetPort);
  prepareDataDirectory(targetData);
  startStack(targetProject, targetData, targetEnv, targetPort);
  const targetUrl = `http://localhost:${targetPort}`;
  await waitFor(`${targetUrl}/health`);
  const targetToken = await register(targetUrl, 'target-owner@example.test', targetPassword);
  await request(targetUrl, '/v1/admin/backups/settings', { token: targetToken, method: 'PUT', body: backupSettings(endpoint) });
  const overview = await request(targetUrl, '/v1/admin/backups', { token: targetToken });
  const remote = overview.artifacts?.find((artifact) => artifact.storage_type === 's3');
  if (!remote) throw new Error('Clean target did not discover the Garage recovery package.');
  // Exercise the Linux runtime's no-follow workspace boundary before the
  // successful restore. The escape destination is disposable fixture storage.
  runDataCommand(targetData, 'mkdir -p /data/cache/workspace-escape; chown 1001:1001 /data/cache/workspace-escape; ln -s /data/cache/workspace-escape /data/backups/.recovery-work');
  try {
    const rejected = await fetch(`${targetUrl}/v1/admin/backups/restores/preflight`, {
      method: 'POST', headers: { authorization: `Bearer ${targetToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ artifact_id: remote.id }),
    });
    await rejected.arrayBuffer();
    if (rejected.ok) throw new Error('Preflight followed a symlinked recovery workspace.');
    runDataCommand(targetData, 'test -z "$(ls -A /data/cache/workspace-escape)"; test -z "$(ls -A /data/backups/.remote-staging)"');
  } finally {
    runDataCommand(targetData, 'rm /data/backups/.recovery-work; rmdir /data/cache/workspace-escape');
  }
  const preflight = await request(targetUrl, '/v1/admin/backups/restores/preflight', { token: targetToken, method: 'POST', body: { artifact_id: remote.id } });
  if (!preflight.plan?.compatible) throw new Error(`Remote restore preflight was blocked: ${JSON.stringify(preflight.plan?.blocking_errors ?? [])}`);
  const started = await request(targetUrl, '/v1/admin/backups/restores', { token: targetToken, method: 'POST', body: {
    artifact_id: remote.id,
    confirmation_phrase: 'RESTORE',
    notes: 'Automated S3 drill',
    plan_id: preflight.plan.plan_id,
    package_checksum_sha256: preflight.plan.package_checksum_sha256,
  } });
  const deadline = Date.now() + 360000;
  let phase;
  while (Date.now() < deadline) {
    let job;
    try {
      const response = await fetch(`${targetUrl}/v1/restore-runtime/jobs/${started.job.id}`, { headers: { 'x-riviamigo-restore-token': started.capability_token } });
      if (!response.ok) throw new Error(`restore job status returned HTTP ${response.status}`);
      job = await response.json();
    } catch {
      // The target may briefly restart while the restore agent swaps the
      // isolated candidate back into service. Keep polling during that
      // expected transition; terminal job errors are handled below.
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
      continue;
    }
    phase = job.phase;
    if (phase === 'failed') {
      throw new Error(`Remote restore failed: ${job.error_message || 'restore agent returned no error message'}`);
    }
    if (phase === 'completed') break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  if (phase !== 'completed') throw new Error(`Remote restore did not complete; final phase was ${phase ?? 'unknown'}.`);
  await waitFor(`${targetUrl}/health`);
  const oldSession = await fetch(`${targetUrl}/v1/auth/me`, { headers: { authorization: `Bearer ${targetToken}` } });
  if (![401, 403].includes(oldSession.status)) throw new Error('The previous target session remained usable after restore.');
  const restoredToken = await login(targetUrl, 'source-owner@example.test', sourcePassword);
  const dashboards = await request(targetUrl, '/v1/dashboards', { token: restoredToken });
  if (!Array.isArray(dashboards) || dashboards.length < 5) throw new Error('Restored source dashboards were not available.');
  verifyArtworkSentinel(targetData);
  const restoredOverview = await request(targetUrl, '/v1/admin/backups', { token: restoredToken });
  if (restoredOverview.settings.has_secret_key) throw new Error('The S3 secret key was unexpectedly present after restore.');
  await request(targetUrl, '/v1/admin/backups/settings', { token: restoredToken, method: 'PUT', body: backupSettings(endpoint) });
  await request(targetUrl, '/v1/admin/backups/s3/test', { token: restoredToken, method: 'POST', body: backupSettings(endpoint) });
  const sourceImage = imageIdentity(sourceProject, sourceEnv, projects[0].env);
  const targetImage = imageIdentity(targetProject, targetEnv, projects[1].env);
  if (sourceImage !== targetImage) throw new Error('Source and target used different application images.');
  report = {
    status: 'passed', created_at: new Date().toISOString(), image_id: targetImage,
    package_sha256: preflight.plan.package_checksum_sha256,
    local_source_removed: true, remote_discovered: true, preflight_compatible: true,
    workspace_symlink_rejected: true,
    in_app_restore_completed: true, previous_session_rejected: true,
    restored_password_login: true, restored_dashboard_count: dashboards.length,
    artwork_restored: true, s3_secret_discarded: true, s3_reconfigured_and_tested: true,
  };
  console.log('S3 backup and clean-target restore drill passed.');
} catch (error) {
  for (const item of projects) spawnSync('docker', [...composeArgs(item.project, item.envFile), 'logs', '--no-color', '--tail', '200'], { cwd: root, stdio: 'inherit', env: item.env });
  throw error;
} finally {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`S3 restore drill report: ${reportPath}`);
  for (const item of projects.reverse()) spawnSync('docker', [...composeArgs(item.project, item.envFile), 'down', '-v', '--remove-orphans'], { cwd: root, stdio: 'ignore', env: item.env });
  spawnSync('docker', ['compose', '-p', garageProject, '-f', 'compose/docker-compose.dev.yml', 'down', '-v', '--remove-orphans'], { cwd: root, stdio: 'ignore', env: { ...process.env, DEV_GARAGE_PORT: String(garagePort), DEV_GARAGE_ADMIN_PORT: String(garagePort + 3) } });
  cleanupData();
}
