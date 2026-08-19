#!/usr/bin/env node
/**
 * Bounded production-package -> isolated dev upgrade harness.
 * This file owns policy and preflight only; Komodo remains the caller/owner.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { chmodSync, copyFileSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_ROOT = '/share/Containers/Riviamigo-prod';
export const DEFAULT_TEST_ROOT = `${PRODUCTION_ROOT}/testing`;
const SHA256 = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST = /@sha256:([a-f0-9]{64})$/i;
const PACKAGE_NAME = /\.rma\.tar\.gz$/i;

export class HarnessError extends Error {}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const packagePath = valueAfter(args, '--package');
  const latestDir = valueAfter(args, '--latest-package-dir');
  const baselineImage = valueAfter(args, '--baseline-image');
  const devImage = valueAfter(args, '--dev-image');
  const testRoot = valueAfter(args, '--test-root') ?? DEFAULT_TEST_ROOT;
  const envFile = valueAfter(args, '--env-file');
  const composeFile = valueAfter(args, '--compose-file');
  const project = valueAfter(args, '--project');
  const komodoRevision = valueAfter(args, '--komodo-revision') ?? process.env.KOMODO_STACK_REVISION;
  const sourceSha = valueAfter(args, '--source-sha');
  const prereleaseTag = valueAfter(args, '--prerelease-tag');
  const composeSourceSha = valueAfter(args, '--compose-source-sha');
  const healthHost = valueAfter(args, '--health-host') ?? '127.0.0.1';
  const portText = valueAfter(args, '--port') ?? '8067';
  const port = Number(portText);
  const knownWithValue = new Set(['--package', '--latest-package-dir', '--baseline-image', '--dev-image', '--test-root', '--env-file', '--compose-file', '--port', '--project', '--komodo-revision', '--health-host', '--source-sha', '--prerelease-tag', '--compose-source-sha']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('-') && !knownWithValue.has(arg) && arg !== '--dry-run' && arg !== '--plan' && arg !== '--execute' && arg !== '--reset-test-storage' && arg !== '--sha256') {
      throw new HarnessError(`Unknown argument: ${arg}`);
    }
    if (knownWithValue.has(arg) && (!args[index + 1] || args[index + 1].startsWith('-'))) throw new HarnessError(`${arg} requires a value.`);
  }
  const suppliedSha = valueAfter(args, '--sha256');
  if (args.includes('--sha256') && (!suppliedSha || !SHA256.test(suppliedSha))) throw new HarnessError('--sha256 must be 64 hexadecimal characters.');
  if (packagePath && latestDir) throw new HarnessError('Use exactly one of --package or --latest-package-dir.');
  if (!packagePath && !latestDir) throw new HarnessError('--package or --latest-package-dir is required.');
  if (!baselineImage || !devImage) throw new HarnessError('--baseline-image and --dev-image are required.');
  if (!envFile) throw new HarnessError('--env-file is required.');
  if (!composeFile) throw new HarnessError('--compose-file is required; do not use the production Compose file implicitly.');
  if (!project) throw new HarnessError('--project is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HarnessError('--port must be an integer from 1 to 65535.');
  if (port === 8066) throw new HarnessError('Production port 8066 is not allowed.');
  return { packagePath, latestDir, baselineImage, devImage, testRoot, envFile, composeFile, project, port, healthHost, komodoRevision, sourceSha, prereleaseTag, composeSourceSha, suppliedSha, reset: args.includes('--reset-test-storage'), execute: args.includes('--execute'), dryRun: args.includes('--dry-run') || args.includes('--plan') || !args.includes('--execute') };
}

function under(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function assertImage(ref, label) {
  if (/:latest(?:$|@)/i.test(ref) || /(^|[/:])latest$/i.test(ref)) throw new HarnessError(`${label} must not use tag latest.`);
  if (!IMAGE_DIGEST.test(ref)) throw new HarnessError(`${label} must be pinned with @sha256:<64 hex>.`);
  return ref;
}

function imageInfo(ref) { return { ref, digest: ref.match(IMAGE_DIGEST)[1].toLowerCase() }; }

function assertTestRoot(root) {
  const resolved = resolve(root);
  const canonical = resolve(DEFAULT_TEST_ROOT);
  if (under(resolved, resolve(PRODUCTION_ROOT))) {
    if (resolved.toLowerCase() !== canonical.toLowerCase()) throw new HarnessError(`Production path is not an allowed test target; use ${DEFAULT_TEST_ROOT}.`);
    return resolved;
  }
  const labelled = resolved.toLowerCase().split(/[\\/]/).some((part) => /^(test|tests|tmp|temp|dev|harness)$/.test(part) || /(?:^|[-_])(test|dev|harness)(?:[-_]|$)/.test(part));
  if (!under(resolved, canonical) && !labelled) throw new HarnessError('Target root must be under the test root or explicitly test-labelled.');
  return resolved;
}

function containsDisallowedProductionPath(text) {
  const normalized = text.replaceAll('\\', '/').toLowerCase();
  const testRoot = DEFAULT_TEST_ROOT.toLowerCase();
  for (const match of normalized.matchAll(/\/share\/containers\/riviamigo-prod(?:\/[a-z0-9._-]+)*/gi)) {
    if (!match[0].startsWith(`${testRoot}/`)) return true;
  }
  return false;
}

function assertProject(project) {
  const lower = project.toLowerCase();
  const productionName = /(?:^|[-_.])prod(?:uction)?(?:$|[-_.])/.test(lower) && !/(?:^|[-_.])prod-test(?:$|[-_.])/.test(lower);
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(project) || productionName || !/(?:^|[-_.])(test|dev|harness|clone)(?:$|[-_.])/i.test(project)) throw new HarnessError('Project must be an explicitly test-labelled identifier.');
}

function choosePackage(input, cwd = process.cwd()) {
  if (input.packagePath) return resolve(cwd, input.packagePath);
  const directory = resolve(cwd, input.latestDir);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new HarnessError('Latest-package directory does not exist or is not a directory.');
  const candidates = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && PACKAGE_NAME.test(entry.name)).map((entry) => join(directory, entry.name));
  if (!candidates.length) throw new HarnessError('No .rma.tar.gz package found in the bounded package directory.');
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || a.localeCompare(b))[0];
}

function packageInsideLiveData(packagePath) {
  const normalized = packagePath.replaceAll('\\', '/').toLowerCase();
  const productionBackupRoot = resolve(join(PRODUCTION_ROOT, 'backups'));
  if (under(packagePath, productionBackupRoot)) return false;
  return (under(packagePath, resolve(PRODUCTION_ROOT)) && !under(packagePath, productionBackupRoot))
    || /(?:^|\/)(?:postgres(?:ql)?|pgdata|timescaledb|database|live-data)(?:\/|$)/.test(normalized);
}

function tarEntries(buffer) {
  const entries = [];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const path = `${prefix ? `${prefix}/` : ''}${name}`.replaceAll('\\', '/');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) throw new HarnessError('Recovery archive has an invalid member size.');
    if (path.startsWith('/') || path.split('/').includes('..') || isAbsolute(path)) throw new HarnessError(`Unsafe recovery archive member: ${path}`);
    const type = header[156];
    if (type !== 0 && type !== 48 && type !== 53) throw new HarnessError(`Unsupported recovery archive member type: ${path}`);
    entries.push({ path, size, type, data: type === 0 || type === 48 ? buffer.subarray(offset + 512, offset + 512 + size) : undefined });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function inspectPackage(packagePath, suppliedSha, { requireChecksum = false } = {}) {
  if (!existsSync(packagePath) || !lstatSync(packagePath).isFile()) throw new HarnessError(`Recovery package does not exist: ${packagePath}`);
  const resolvedPackagePath = realpathSync(packagePath);
  if (packageInsideLiveData(resolvedPackagePath)) throw new HarnessError('Recovery package may not be inside PostgreSQL live data.');
  const bytes = readFileSync(resolvedPackagePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const sidecar = `${resolvedPackagePath}.sha256`;
  let expected = suppliedSha;
  if (!expected && existsSync(sidecar)) expected = readFileSync(sidecar, 'utf8').match(/[a-f0-9]{64}/i)?.[0];
  if (requireChecksum && !expected) throw new HarnessError('Recovery package SHA-256 requires --sha256 or a matching .sha256 sidecar.');
  if (expected && expected.toLowerCase() !== hash) throw new HarnessError('Recovery package SHA-256 does not match the supplied verification value.');
  let entries;
  try { entries = tarEntries(gunzipSync(bytes)); } catch (error) { throw new HarnessError(`Invalid recovery archive: ${error.message}`); }
  const byName = new Map();
  const fileChecksums = new Map();
  const fileSizes = new Map();
  for (const entry of entries) {
    if (byName.has(entry.path)) throw new HarnessError(`Recovery archive contains a duplicate member: ${entry.path}`);
    byName.set(entry.path, entry);
    if (entry.type === 0 || entry.type === 48) {
      fileChecksums.set(entry.path, createHash('sha256').update(entry.data).digest('hex'));
      fileSizes.set(entry.path, entry.size);
    }
  }
  const manifestEntry = byName.get('manifest.json');
  if (!manifestEntry) throw new HarnessError('Recovery package is missing manifest.json.');
  for (const required of ['database.dump', 'backup-settings.json']) if (!byName.has(required)) throw new HarnessError(`Recovery package is missing ${required}.`);
  if (byName.get('database.dump').data.subarray(0, 5).toString() !== 'PGDMP') throw new HarnessError('Recovery package database.dump is not a PostgreSQL custom-format dump.');
  let manifest;
  try { manifest = JSON.parse(manifestEntry.data.toString('utf8')); } catch { throw new HarnessError('Recovery manifest is invalid JSON.'); }
  if (![`riviamigo-recovery-v1`, `riviamigo-recovery-v2`, `riviamigo-recovery-v3`].includes(manifest.format) || ![1, 2, 3].includes(manifest.format_version)) throw new HarnessError('Unsupported recovery package format.');
  const verifyComponent = (name, expectedPath, { requireContract = false } = {}) => {
    const component = manifest.components?.[name];
    if (!component || typeof component !== 'object') throw new HarnessError(`Recovery manifest is missing component ${name}.`);
    if (requireContract && (component.version !== 1 || typeof component.restore_policy !== 'string' || !component.restore_policy || !Array.isArray(component.redactions))) throw new HarnessError(`Recovery component ${name} has an invalid contract.`);
    const path = component.path ?? expectedPath;
    if (path !== expectedPath || typeof component.sha256 !== 'string' || fileChecksums.get(path) !== component.sha256 || fileSizes.get(path) !== component.size_bytes) throw new HarnessError(`Recovery package checksum or size mismatch for ${expectedPath}.`);
  };
  verifyComponent('database', 'database.dump');
  verifyComponent('backup_settings', 'backup-settings.json');
  if (manifest.format_version >= 2) {
    for (const signal of ['postgres_major', 'migration_version', 'migration_ledger', 'schema_fingerprint']) if (manifest.source?.[signal] === undefined) throw new HarnessError(`Recovery manifest is missing source.${signal}.`);
    if (!Number.isInteger(manifest.restore?.engine_version) || manifest.restore.engine_version < 1 || manifest.restore.engine_version > 3) throw new HarnessError(`Recovery package requires unsupported restore engine version ${manifest.restore?.engine_version ?? 'unknown'}.`);
    const ledger = manifest.source.migration_ledger;
    if (!Array.isArray(ledger) || ledger.length === 0 || !Number.isInteger(manifest.source.migration_version) || manifest.source.migration_version < 1) throw new HarnessError('Recovery migration ledger is incomplete.');
    let previous = 0;
    for (const entry of ledger) {
      if (!Number.isInteger(entry?.version) || entry.version < 1 || entry.version <= previous || typeof entry.checksum_sha384 !== 'string' || !entry.checksum_sha384) throw new HarnessError('Recovery migration ledger is invalid.');
      previous = entry.version;
    }
    if (previous !== manifest.source.migration_version) throw new HarnessError('Recovery migration ledger does not end at the declared migration version.');
    if (manifest.format_version === 3) for (const signal of ['migration_chain_id', 'migration_catalog_digest', 'schema_contract_version', 'app_version']) if (typeof manifest.source?.[signal] !== 'string' || !manifest.source[signal]) throw new HarnessError(`Recovery v3 manifest is missing source.${signal}.`);
    verifyComponent('operational_history', 'operational-history.json', { requireContract: true });
    for (const name of ['database', 'backup_settings']) {
      const component = manifest.components?.[name];
      if (component.version !== 1 || typeof component.restore_policy !== 'string' || !component.restore_policy || !Array.isArray(component.redactions)) throw new HarnessError(`Recovery component ${name} has an invalid contract.`);
    }
  }
  const artwork = manifest.components?.vehicle_image_cache;
  if (artwork?.files) for (const file of artwork.files) if (typeof file?.path !== 'string' || fileChecksums.get(file.path) !== file.sha256 || fileSizes.get(file.path) !== file.size_bytes) throw new HarnessError(`Recovery artwork checksum or size mismatch for ${file?.path ?? 'unknown file'}.`);
  return { path: resolvedPackagePath, sha256: hash, bytes: bytes.length, members: entries.length, manifest: { format: manifest.format, format_version: manifest.format_version, migrationVersion: manifest.source?.migration_version ?? null } };
}

export function buildPlan(raw, cwd = process.cwd()) {
  const packagePath = choosePackage(raw, cwd);
  const testRoot = assertTestRoot(resolve(cwd, raw.testRoot));
  assertProject(raw.project);
  if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535 || raw.port === 8066) throw new HarnessError('Production port 8066 or an invalid port is not allowed.');
  assertImage(raw.baselineImage, 'Baseline image');
  assertImage(raw.devImage, 'Dev image');
  const envFile = resolve(cwd, raw.envFile);
  if (!existsSync(envFile) || !lstatSync(envFile).isFile()) throw new HarnessError(`Environment file does not exist: ${envFile}`);
  const testSecretsRoot = resolve(join(DEFAULT_TEST_ROOT, 'secrets'));
  if (under(envFile, resolve(PRODUCTION_ROOT)) && !under(envFile, testSecretsRoot)) throw new HarnessError('Production env files may not be copied into the test harness.');
  const composeFile = resolve(cwd, raw.composeFile);
  if (!existsSync(composeFile) || !lstatSync(composeFile).isFile()) throw new HarnessError(`Compose file does not exist: ${composeFile}`);
  const composeText = readFileSync(composeFile, 'utf8');
  if (/\blatest\b/i.test(composeText) || containsDisallowedProductionPath(composeText) || /(?:^|\D)8066(?:\D|$)/.test(composeText) || /t3_proxy|traefik|riviamigo-prod-internal/i.test(composeText)) {
    throw new HarnessError('Compose file contains production or mutable-image configuration.');
  }
  const pkg = inspectPackage(packagePath, raw.suppliedSha, { requireChecksum: true });
  const dataPaths = Object.fromEntries(['db', 'redis', 'backups', 'cache'].map((name) => [name, join(testRoot, name)]));
  const populated = Object.values(dataPaths).filter((path) => existsSync(path) && readdirSync(path).length > 0);
  if (populated.length && !raw.reset) throw new HarnessError('Target storage is populated; pass --reset-test-storage to replace it.');
  if (raw.reset && Object.values(dataPaths).some((path) => !under(path, testRoot))) throw new HarnessError('Refusing to reset storage outside the exact test root.');
  const createdAt = new Date().toISOString();
  return { version: 1, kind: 'riviamigo-dev-harness-plan', createdAt, package: pkg, images: { baseline: imageInfo(raw.baselineImage), dev: imageInfo(raw.devImage) }, provenance: { sourceSha: raw.sourceSha ?? 'not-provided', prereleaseTag: raw.prereleaseTag ?? 'not-provided', composeSourceSha: raw.composeSourceSha ?? 'not-provided' }, target: { root: testRoot, data: dataPaths, state: join(testRoot, 'harness-state.json'), lock: join(testRoot, 'harness.lock.json'), envFile, composeFile, port: raw.port, healthHost: raw.healthHost, project: raw.project, komodoRevision: raw.komodoRevision ?? 'not-provided' }, phases: ['preflight', ...(raw.reset ? ['reset-test-storage'] : []), 'stage-package-read-only', 'restore-with-baseline-image', 'verify-baseline-data', 'upgrade-to-dev-image', 'verify-dev-health', 'record-komodo-readback'], destructive: Boolean(raw.reset), execution: raw.execute ? 'execute' : 'dry-run' };
}

export function help() {
  return `Usage: node scripts/dev-harness.mjs [options]\n\nRequired: --package PATH or --latest-package-dir DIR, --baseline-image REF, --dev-image REF, --test-root PATH, --env-file PATH, --compose-file PATH, --port PORT, --project NAME\nOptional: --sha256 HASH, --source-sha SHA, --prerelease-tag TAG, --compose-source-sha SHA, --health-host HOST, --komodo-revision REV, --reset-test-storage, --dry-run/--plan (default), --execute\nImages require immutable @sha256 digests. Execution invokes the existing isolated restore script, then upgrades only the test Compose project; Komodo is not called.`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function stagePackage(plan) {
  const staging = join(plan.target.data.backups, '.dev-harness');
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  const staged = join(staging, basename(plan.package.path));
  copyFileSync(plan.package.path, staged);
  try { chmodSync(staged, 0o444); } catch { /* Windows does not expose POSIX modes. */ }
  return staged;
}

function resetTestData(plan) {
  for (const path of Object.values(plan.target.data)) {
    if (!under(path, plan.target.root) || path === plan.target.root) throw new HarnessError('Refusing to reset a path outside the exact test root.');
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new HarnessError(`Refusing to reset symlinked test storage: ${path}`);
    rmSync(path, { recursive: true, force: true });
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}

function imageEnvLines(image) {
  const lines = [`RIVIAMIGO_IMAGE_REF=${image.ref}`];
  const match = image.ref.match(/^(.*)\/([^/:]+):([^@]+)@sha256:([a-f0-9]{64})$/i);
  if (match) {
    lines.push(`RIVIAMIGO_IMAGE_REGISTRY=${match[1]}`);
    lines.push(`IMAGE_TAG=${match[3]}@sha256:${match[4]}`);
  }
  return lines;
}

export function writeHarnessEnv(source, destination, image, plan) {
  const sourceLines = readFileSync(source, 'utf8').split(/\r?\n/);
  const isDevelopment = sourceLines.some((line) => /^\s*RIVIAMIGO_ENV\s*=\s*development\s*$/i.test(line));
  const overrideKeys = new Set([
    'RIVIAMIGO_IMAGE_REF', 'RIVIAMIGO_IMAGE_REGISTRY', 'IMAGE_TAG', 'RIVIAMIGO_DATA_DIR',
    'RIVIAMIGO_ORIGIN_PORT', 'RIVIAMIGO_HOST_BIND_ADDRESS', 'COMPOSE_PROJECT_NAME', 'RIVIAMIGO_ENV_FILE',
    'RIVIAMIGO_HEALTH_HOST',
  ]);
  const retained = sourceLines.filter((line) => {
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    return !key || (!overrideKeys.has(key) && !(isDevelopment && key === 'COOKIE_INSECURE'));
  });
  if (isDevelopment) retained.push('COOKIE_INSECURE=true');
  retained.push(...imageEnvLines(image), `RIVIAMIGO_DATA_DIR=${plan.target.root}`, `RIVIAMIGO_ORIGIN_PORT=${plan.target.port}`, `RIVIAMIGO_HOST_BIND_ADDRESS=${plan.target.healthHost}`, `RIVIAMIGO_HEALTH_HOST=${plan.target.healthHost}`, `COMPOSE_PROJECT_NAME=${plan.target.project}`, `RIVIAMIGO_ENV_FILE=${destination}`);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  writeFileSync(destination, `${retained.filter((line, index, all) => line || index < all.length - 1).join('\n')}\n`, { mode: 0o600 });
}

function composeArgs(plan, envFile, extra = []) {
  return ['compose', '-p', plan.target.project, '--env-file', envFile, '-f', plan.target.composeFile, ...extra];
}

function runCompose(plan, envFile, extra) {
  return execFileSync('docker', composeArgs(plan, envFile, extra), {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    stdio: 'inherit',
    env: { ...process.env, RIVIAMIGO_ENV_FILE: envFile },
  });
}

function captureCompose(plan, envFile, extra) {
  return execFileSync('docker', composeArgs(plan, envFile, extra), {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    encoding: 'utf8',
    env: { ...process.env, RIVIAMIGO_ENV_FILE: envFile },
  }).trim();
}

async function waitForHealth(plan) {
  const origin = `http://${plan.target.healthHost}:${plan.target.port}`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return origin;
    } catch { /* Compose services may still be starting. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new HarnessError(`Timed out waiting for ${origin}/health.`);
}

async function verifyApplication(plan) {
  const origin = await waitForHealth(plan);
  const setup = await fetch(`${origin}/v1/auth/setup`).then((response) => response.json());
  if (setup.setup_required) throw new HarnessError('Restored test application unexpectedly requires setup.');
  return { origin, setupRequired: Boolean(setup.setup_required) };
}

function verifyData(plan, envFile) {
  const query = "SELECT (SELECT count(*) FROM riviamigo.users) || ',' || (SELECT count(*) FROM riviamigo.dashboards) || ',' || (SELECT count(*) FROM riviamigo.vehicles) || ',' || (SELECT count(*) FROM timeseries.telemetry) || ',' || (SELECT count(*) FROM riviamigo.vehicle_images) || ',' || (SELECT count(*) FROM riviamigo.vehicle_credentials)";
  const values = captureCompose(plan, envFile, ['exec', '-T', 'timescaledb', 'psql', '-U', 'riviamigo', '-d', 'riviamigo', '-At', '-c', query]).split(',').map((value) => Number.parseInt(value, 10));
  if (values.length !== 6 || values.some((value) => !Number.isSafeInteger(value))) throw new HarnessError('Test database data verification returned an invalid result.');
  if (values[0] < 1) throw new HarnessError('Restored test database contains no users.');
  return { users: values[0], dashboards: values[1], vehicles: values[2], telemetry: values[3], artwork: values[4], providerCredentials: values[5] };
}

function lockValue(plan, phase, extras = {}) {
  return { kind: 'riviamigo-dev-harness-lock', version: 1, phase, updatedAt: new Date().toISOString(), package: plan.package, images: plan.images, provenance: plan.provenance, target: plan.target, ...extras };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) { console.log(help()); return; }
  try {
    const raw = parseArgs(args);
    const plan = buildPlan(raw);
    if (raw.dryRun) { console.log(JSON.stringify(plan, null, 2)); return; }
    mkdirSync(plan.target.root, { recursive: true });
    const statePath = plan.target.state;
    writeJson(plan.target.lock, lockValue(plan, 'preflight', { acquiredAt: new Date().toISOString() }));
    resetTestData(plan);
    const stagedPackage = stagePackage(plan);
    const harnessDir = join(plan.target.root, '.dev-harness');
    const baselineEnv = join(harnessDir, 'baseline.env');
    const devEnv = join(harnessDir, 'dev.env');
    writeHarnessEnv(raw.envFile, baselineEnv, plan.images.baseline, plan);
    writeHarnessEnv(raw.envFile, devEnv, plan.images.dev, plan);
    writeJson(statePath, { ...plan, phase: 'restore-with-baseline-image', stagedPackage, startedAt: new Date().toISOString() });
    const restore = join(dirname(fileURLToPath(import.meta.url)), 'restore-backup.mjs');
    execFileSync(process.execPath, [restore, '--package', stagedPackage, '--env-file', baselineEnv, '--compose-file', plan.target.composeFile, '--project', plan.target.project, '--skip-build'], { cwd: dirname(dirname(restore)), stdio: 'inherit', env: { ...process.env, RIVIAMIGO_ENV_FILE: baselineEnv } });
    const baselineData = verifyData(plan, baselineEnv);
    writeJson(plan.target.lock, lockValue(plan, 'baseline-verified', { stagedPackage, baselineData }));
    writeJson(statePath, { ...plan, phase: 'upgrade-to-dev-image', stagedPackage, baselineData, baselineVerifiedAt: new Date().toISOString() });
    runCompose(plan, devEnv, ['up', '-d', '--no-build']);
    const health = await verifyApplication(plan);
    const devData = verifyData(plan, devEnv);
    const completed = { ...plan, phase: 'complete', stagedPackage, baselineData, devData, health, migrationTransition: { from: plan.images.baseline, to: plan.images.dev, database: 'test-only', rollback: 'fresh-storage-restore' }, completedAt: new Date().toISOString() };
    writeJson(statePath, completed);
    writeJson(plan.target.lock, lockValue(plan, 'complete', { stagedPackage, baselineData, devData, health, migrationTransition: completed.migrationTransition }));
    console.log(`Dev harness completed for ${plan.target.project}; production was not targeted.`);
  } catch (error) { console.error(`dev-harness: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
