import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const fail = (message) => { throw new Error(`compose:check failed: ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

const standardText = read('compose/docker-compose.yml');
const standard = parse(standardText);
const build = parse(read('compose/docker-compose.build.yml'));
const dev = parse(read('compose/docker-compose.dev.yml'));

assert(
  JSON.stringify(Object.keys(standard.services ?? {}).sort()) === JSON.stringify(['parallax', 'redis', 'riviamigo', 'timescaledb']),
  'standard Compose must contain only the universal production services'
);
assert(
  standard.services.riviamigo.ports?.includes(
    '${RIVIAMIGO_HOST_BIND_ADDRESS:-0.0.0.0}:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080'
  ),
  'standard Compose must use configurable host publication'
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
assert(!Object.hasOwn(standard.services, 'riviamigo-init'), 'standard Compose must not contain a completed init service');
assert(build.services?.riviamigo?.image === 'riviamigo:local', 'source-build overlay must run riviamigo from the candidate image');
assert(standard.services.riviamigo.volumes?.some((volume) => volume.includes('RIVIAMIGO_BACKUPS_SOURCE')), 'backup storage must be independently configurable');
assert(standard.services.timescaledb.volumes?.some((volume) => volume.includes('RIVIAMIGO_DB_SOURCE')), 'database storage must be independently configurable');
assert(standard.services.timescaledb.healthcheck.start_period === '300s' && standard.services.timescaledb.healthcheck.retries === 30, 'database healthcheck must tolerate slow first initialization');
assert(
  ['riviamigo-db', 'riviamigo-redis', 'riviamigo-backups', 'riviamigo-cache'].every((name) =>
    Object.hasOwn(standard.volumes ?? {}, name)
  ),
  'standard Compose must declare default Docker-managed volumes'
);
assert(!standardText.includes('pids:'), 'standard Compose must not set a host PID limit');
assert(!standardText.includes('cpus:'), 'standard Compose must not set a host CPU quota');
assert(!fs.existsSync(path.join(root, 'compose/docker-compose.synology.yml')), 'Synology must not have a second authored Compose file');

console.log('compose:check passed');
