import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { transformCompose } from './generate-synology-compose.mjs';

const root = resolve(import.meta.dirname, '..');

test('Synology transform keeps services and removes unsupported resource controls', () => {
  const source = parse(readFileSync(resolve(root, 'compose/docker-compose.yml'), 'utf8'));
  const synology = transformCompose(readFileSync(resolve(root, 'compose/docker-compose.yml'), 'utf8'));

  assert.deepEqual(Object.keys(synology.services).sort(), Object.keys(source.services).sort());
  assert.equal(
    synology.services.riviamigo.ports[0],
    '127.0.0.1:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080',
  );
  assert.match(
    synology.services.riviamigo.volumes[0],
    /\$\{RIVIAMIGO_DATA_DIR:\?Set RIVIAMIGO_DATA_DIR to an absolute Synology path\}/,
  );

  const serialized = JSON.stringify(synology);
  assert.doesNotMatch(serialized, /"cpus"|"cpu_period"|"cpu_quota"|"pids"/);
  assert.equal(synology.services.timescaledb.healthcheck.start_period, '5m');
  assert.match(JSON.stringify(synology.services.riviamigo.env_file), /\.env\.synology/);
});
