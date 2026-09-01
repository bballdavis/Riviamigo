import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateDistinctRuntimePorts, deriveDevComposeProjectName } from './dev.mjs';

test('derives isolated Compose projects for separate checkouts', () => {
  const first = deriveDevComposeProjectName('C:\\work\\Riviamigo', {});
  const repeated = deriveDevComposeProjectName('C:\\work\\Riviamigo', {});
  const second = deriveDevComposeProjectName('C:\\work\\Riviamigo-theme-system', {});

  assert.match(first, /^riviamigo-[a-z0-9_-]+-[a-f0-9]{8}$/);
  assert.equal(repeated, first);
  assert.notEqual(second, first);
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
