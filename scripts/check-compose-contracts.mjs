import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { renderSynologyCompose } from './generate-synology-compose.mjs';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  throw new Error(`compose:check failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key);
    walk(child, visit);
  }
}

const standardText = read('compose/docker-compose.yml');
const buildText = read('compose/docker-compose.build.yml');
const devText = read('compose/docker-compose.dev.yml');
const dockerfileText = read('compose/Dockerfile');
const synologyText = read('compose/docker-compose.synology.yml');
const dsmSynologyText = read('compose/synology/docker-compose.yml');
const standard = parse(standardText);
const build = parse(buildText);
const dev = parse(devText);
const synology = parse(synologyText);
const standardServices = Object.keys(standard.services ?? {}).sort();
const synologyServices = Object.keys(synology.services ?? {}).sort();

assert(
  JSON.stringify(standardServices) === JSON.stringify(synologyServices),
  'standard and Synology Compose files must have the same service set'
);

for (const service of ['riviamigo', 'timescaledb', 'redis']) {
  assert(
    standard.services[service].image === synology.services[service].image,
    `${service} must use the same image in both deployment files`
  );
}

assert(
  standard.services.riviamigo.ports?.includes(
    '${RIVIAMIGO_HOST_BIND_ADDRESS:-0.0.0.0}:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080'
  ),
  'standard Compose must use normal host publication'
);
assert(
  dev.services.api.environment?.COOKIE_INSECURE === 'true' &&
    dev.services.api.environment?.RIVIAMIGO_ENV === 'development',
  'development Compose must omit Secure refresh cookies for HTTP browser reloads'
);
assert(
  !Object.hasOwn(standard.services.riviamigo.environment ?? {}, 'COOKIE_INSECURE'),
  'standard Compose must not enable development-only insecure cookies'
);
assert(
  synology.services.riviamigo.ports?.includes('127.0.0.1:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080'),
  'Synology Compose must publish the app on loopback'
);
assert(
  synologyText.includes(
    '${RIVIAMIGO_DATA_DIR:?Set RIVIAMIGO_DATA_DIR to an absolute Synology path}'
  ),
  'Synology Compose must require an absolute data directory'
);
assert(
  standard.services.riviamigo.deploy?.resources?.limits?.cpus === '1.00',
  'standard Compose must retain the app CPU limit'
);
assert(
  standard.services.timescaledb.deploy?.resources?.limits?.cpus === '2.00',
  'standard Compose must retain the database CPU limit'
);
assert(
  standard.services.riviamigo.deploy?.resources?.limits?.pids === 256,
  'standard Compose must retain the app PID limit'
);
assert(
  standard.services.timescaledb.healthcheck?.start_period !== '5m',
  'standard Compose must not inherit the Synology-only TimescaleDB start period'
);
assert(
  standard.services['riviamigo-init'].networks?.includes('internal'),
  'the init service must share the internal database network'
);
assert(
  synology.services['riviamigo-init'].networks?.includes('internal'),
  'the Synology init service must share the internal database network'
);
for (const service of ['riviamigo-init', 'riviamigo']) {
  assert(
    build.services?.[service]?.image === 'riviamigo:local',
    `the source-build overlay must run ${service} from the candidate image`
  );
}
assert(
  dockerfileText.includes('rust:1.97.1-slim-bookworm@') &&
    dockerfileText.includes('postgres:18.4-bookworm@'),
  'the Rust builder and runtime must retain a compatible Bookworm glibc baseline'
);

for (const forbiddenKey of ['cpus', 'cpu_period', 'cpu_quota', 'pids']) {
  walk(synology, (key) => {
    assert(key !== forbiddenKey, `Synology Compose must not contain ${forbiddenKey}`);
  });
}

assert(!synologyText.includes('5432:'), 'Synology Compose must not publish PostgreSQL');
assert(!synologyText.includes('6379:'), 'Synology Compose must not publish Redis');
assert(
  synologyText === renderSynologyCompose(standardText),
  'generated Synology Compose is stale; run pnpm compose:synology:generate'
);
assert(dsmSynologyText === synologyText, 'DSM Compose and compatibility alias must match');
assert(synology.services.timescaledb.healthcheck.start_period === '5m', 'Synology TimescaleDB must allow five minutes for first boot');
assert(!synologyText.includes('pids:'), 'Synology Compose must not include PID limits');

console.log('compose:check passed');
