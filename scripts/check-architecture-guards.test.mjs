import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { architectureGuardFailures, findCircularDependencies } from './check-architecture-guards.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'riviamigo-architecture-guards-'));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

test('reports raw UI and route transports', () => {
  const root = fixture({
    'packages/ui/src/Card.tsx': 'export const Card = () => fetch("/bad");',
    'apps/web/src/routes/index.tsx': 'new WebSocket("ws://bad");',
    'packages/hooks/src/index.ts': 'export {};',
    'packages/dashboards/src/index.ts': 'export {};',
    'packages/types/src/index.ts': 'export {};',
  });

  const failures = architectureGuardFailures(root).join('\n');
  assert.match(failures, /Shared UI must not create network transports/);
  assert.match(failures, /Route modules must use hooks rather than raw transports/);
});

test('finds a source-level cycle across package aliases', () => {
  const root = fixture({
    'packages/ui/src/index.ts': 'export * from "./theme";',
    'packages/ui/src/theme.ts': 'import "@riviamigo/hooks";',
    'packages/hooks/src/index.ts': 'import "@riviamigo/ui";',
    'packages/dashboards/src/index.ts': 'export {};',
    'packages/types/src/index.ts': 'export {};',
    'apps/web/src/routes/index.tsx': 'export {};',
  });

  assert.deepEqual(findCircularDependencies(root), [
    ['packages/ui/src/index.ts', 'packages/ui/src/theme.ts', 'packages/hooks/src/index.ts', 'packages/ui/src/index.ts'],
  ]);
});
