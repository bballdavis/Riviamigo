import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateDistinctRuntimePorts,
  deriveDevComposeProjectName,
  parseComposeIdentityMetadata,
  parseComposePortMetadata,
} from './dev.mjs';

test('uses the shared riviamigo Compose project by default', () => {
  assert.equal(deriveDevComposeProjectName('C:\\work\\Riviamigo', {}), 'riviamigo');
  assert.equal(deriveDevComposeProjectName('C:\\work\\Riviamigo-theme-system', {}), 'riviamigo');
});

test('honors explicit development and general Compose project overrides', () => {
  assert.equal(
    deriveDevComposeProjectName('C:\\work\\Riviamigo', {
      DEV_COMPOSE_PROJECT_NAME: 'charging-test',
      COMPOSE_PROJECT_NAME: 'general-test',
    }),
    'charging-test',
  );
  assert.equal(
    deriveDevComposeProjectName('C:\\work\\Riviamigo', { COMPOSE_PROJECT_NAME: 'general-test' }),
    'general-test',
  );
});

test('allocates distinct ports when service overrides collide', async () => {
  const probes = [];
  const allocated = await allocateDistinctRuntimePorts([
    { key: 'api', start: 3003, label: 'API' },
    { key: 'restoreAgent', start: 3003, label: 'Restore agent' },
    { key: 'web', start: 3003, label: 'Web' },
  ], async (start, label, _maxTries, reservedPorts) => {
    probes.push({ label, reserved: [...reservedPorts] });
    let candidate = start;
    while (reservedPorts.has(candidate)) candidate += 1;
    return candidate;
  });

  assert.deepEqual(allocated, { api: 3003, restoreAgent: 3004, web: 3005 });
  assert.deepEqual(probes, [
    { label: 'API', reserved: [] },
    { label: 'Restore agent', reserved: [3003] },
    { label: 'Web', reserved: [3003, 3004] },
  ]);
});

test('parses newline-delimited Compose publishers by service and target port', () => {
  const metadata = parseComposePortMetadata([
    JSON.stringify({ Service: 'timescaledb', State: 'running', Publishers: [{ TargetPort: 5432, PublishedPort: 15432 }] }),
    JSON.stringify({ Service: 'redis', State: 'exited', Publishers: [{ TargetPort: 6379, PublishedPort: 16379 }] }),
    JSON.stringify({ Service: 'garage', State: 'running', Publishers: [
      { TargetPort: 3900, PublishedPort: 13900 },
      { TargetPort: 3903, PublishedPort: 13903 },
    ] }),
  ].join('\n'));

  assert.deepEqual(metadata.get('timescaledb:5432'), { port: 15432, running: true });
  assert.deepEqual(metadata.get('redis:6379'), { port: 16379, running: false });
  assert.deepEqual(metadata.get('garage:3903'), { port: 13903, running: true });
});

test('accepts current development Compose identity from labels', () => {
  const output = [
    { Service: 'timescaledb', Labels: 'com.docker.compose.project.config_files=C:\\Work\\Riviamigo\\compose\\docker-compose.dev.yml,com.docker.compose.project.service=timescaledb' },
    { Service: 'redis', Labels: { 'com.docker.compose.project.config_files': 'C:\\Work\\Riviamigo\\compose\\docker-compose.dev.yml' } },
    { Service: 'garage', ConfigFiles: ['c:/work/riviamigo/compose/docker-compose.dev.yml'] },
  ].map(JSON.stringify).join('\n');

  const identity = parseComposeIdentityMetadata(output, 'C:/WORK/Riviamigo/compose/docker-compose.dev.yml');
  assert.equal(identity.valid, true);
  assert.deepEqual(identity.composeFiles, ['c:/work/riviamigo/compose/docker-compose.dev.yml']);
});

test('rejects a production and development Compose identity from Docker labels', () => {
  const output = JSON.stringify({
    Service: 'timescaledb',
    Labels: 'com.docker.compose.project.config_files=C:\\Work\\Riviamigo\\compose\\docker-compose.yml,C:\\Work\\Riviamigo\\compose\\docker-compose.dev.yml,com.docker.compose.project.service=timescaledb',
  });

  const identity = parseComposeIdentityMetadata(output, 'C:/WORK/Riviamigo/compose/docker-compose.dev.yml');
  assert.equal(identity.valid, false);
  assert.equal(identity.reason, 'production Compose config file');
});

test('rejects production-shaped and missing Compose identity metadata', () => {
  const expected = 'C:/work/Riviamigo/compose/docker-compose.dev.yml';
  const production = parseComposeIdentityMetadata(
    JSON.stringify({ Service: 'timescaledb', Labels: { 'com.docker.compose.project.config_files': 'C:/work/Riviamigo/compose/docker-compose.yml' } }),
    expected,
  );
  const missing = parseComposeIdentityMetadata(JSON.stringify({ Service: 'redis', State: 'running' }), expected);

  assert.equal(production.valid, false);
  assert.equal(production.reason, 'unexpected Compose config file');
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, 'missing identity metadata');
});

test('rejects mixed Compose identity metadata across existing records', () => {
  const output = [
    { Service: 'timescaledb', ConfigFiles: ['C:/work/Riviamigo/compose/docker-compose.dev.yml'] },
    { Service: 'redis', ConfigFiles: ['C:/work/Riviamigo/compose/docker-compose.dev.yml', 'C:/work/Riviamigo/compose/override.yml'] },
  ].map(JSON.stringify).join('\n');

  const identity = parseComposeIdentityMetadata(output, 'C:/work/Riviamigo/compose/docker-compose.dev.yml');
  assert.equal(identity.valid, false);
  assert.equal(identity.reason, 'mixed Compose config files');
});

test('reuses running shared infrastructure ports and reserves them from host ports', async () => {
  const probes = [];
  const allocated = await allocateDistinctRuntimePorts([
    { key: 'api', start: 15432, label: 'API' },
    { key: 'postgres', start: 5432, label: 'PostgreSQL' },
    { key: 'redis', start: 6379, label: 'Redis' },
    { key: 'garageApi', start: 3900, label: 'Garage API' },
    { key: 'garageAdmin', start: 3903, label: 'Garage admin' },
  ], async (start, label, _maxTries, reservedPorts) => {
    probes.push({ start, label, reserved: [...reservedPorts] });
    let candidate = start;
    while (reservedPorts.has(candidate)) candidate += 1;
    return candidate;
  }, new Map([
    ['postgres', 15432],
    ['redis', 16379],
    ['garageApi', 13900],
    ['garageAdmin', 13903],
  ]));

  assert.deepEqual(allocated, {
    api: 15433, postgres: 15432, redis: 16379, garageApi: 13900, garageAdmin: 13903,
  });
  assert.deepEqual(probes, [{ start: 15432, label: 'API', reserved: [15432, 16379, 13900, 13903] }]);
});
