import assert from 'node:assert/strict';
import test from 'node:test';
import { selectExpiredDevelopmentVersionIds } from './select-expired-dev-image-versions.mjs';

test('selects only expired SHA-only development versions', () => {
  const versions = [[
    { id: 1, created_at: '2026-05-01T00:00:00Z', metadata: { container: { tags: ['sha-123456789abc'] } } },
    { id: 2, created_at: '2026-05-01T00:00:00Z', metadata: { container: { tags: ['edge', 'sha-123456789abc'] } } },
    { id: 3, created_at: '2026-05-01T00:00:00Z', metadata: { container: { tags: ['2026.05.0', 'latest'] } } },
    { id: 4, created_at: '2026-05-01T00:00:00Z', metadata: { container: { tags: [] } } },
    { id: 5, created_at: '2026-07-10T00:00:00Z', metadata: { container: { tags: ['sha-abcdefabcdef'] } } },
  ]];

  assert.deepEqual(selectExpiredDevelopmentVersionIds(versions, '2026-07-01T00:00:00Z'), ['1']);
});
