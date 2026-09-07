import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateDistinctRuntimePorts } from './dev.mjs';

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
