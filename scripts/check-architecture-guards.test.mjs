import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { architectureGuardFailures, findCircularDependencies } from './check-architecture-guards.mjs';

function fixture(files, { withBudgets = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'riviamigo-architecture-guards-'));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, source);
  }
  if (withBudgets && !Object.hasOwn(files, 'config/architecture-budgets.json')) {
    const target = join(root, 'config/architecture-budgets.json');
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, '{}');
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

test('reports configured duplicate interaction patterns outside their allowlists', () => {
  const root = fixture({
    'apps/web/src/BadControls.tsx': `
      window.alert('bad');
      window.confirm('bad');
      <div role="switch" />;
      createPortal(null, document.body);
      new CustomEvent('riviamigo:toast', { detail: {} });
      new CustomEvent('riviamigo:toast', { detail: {} });
      const query = { queryKey: [] };
      export default query;
    `,
    'config/architecture-budgets.json': JSON.stringify({
      patterns: {
        windowAlert: {
          pattern: String.raw`window\.alert\s*\(`,
          directories: ['apps/web/src'],
          maxMatches: 0,
          message: 'alert forbidden',
        },
        windowConfirm: {
          pattern: String.raw`window\.confirm\s*\(`,
          directories: ['apps/web/src'],
          message: 'confirm forbidden',
        },
        roleSwitch: {
          pattern: String.raw`role\s*=\s*["']switch["']`,
          directories: ['apps/web/src'],
          message: 'switch forbidden',
        },
        directPortal: {
          pattern: String.raw`createPortal\s*\(`,
          directories: ['apps/web/src'],
          message: 'portal forbidden',
        },
        directToastDispatch: {
          pattern: String.raw`new\s+CustomEvent\s*\(\s*["']riviamigo:toast["']`,
          directories: ['apps/web/src'],
          maxMatches: 1,
          message: 'toast forbidden',
        },
        rawQueryKey: {
          pattern: String.raw`queryKey\s*:\s*\[`,
          directories: ['apps/web/src'],
          message: 'query key forbidden',
        },
      },
    }),
    'packages/ui/src/index.ts': 'export {};',
    'packages/hooks/src/index.ts': 'export {};',
    'packages/dashboards/src/index.ts': 'export {};',
    'packages/types/src/index.ts': 'export {};',
  });

  const failures = architectureGuardFailures(root).join('\n');
  assert.match(failures, /alert forbidden/);
  assert.match(failures, /alert forbidden has 1 matches; budget is 0/);
  assert.match(failures, /confirm forbidden/);
  assert.match(failures, /switch forbidden/);
  assert.match(failures, /portal forbidden/);
  assert.match(failures, /toast forbidden/);
  assert.match(failures, /toast forbidden has 2 matches; budget is 1/);
  assert.match(failures, /query key forbidden/);
});

test('enforces hotspot line and byte ratchets', () => {
  const root = fixture({
    'apps/web/src/TooLarge.tsx': 'one\ntwo\nthree\n',
    'config/architecture-budgets.json': JSON.stringify({
      hotspots: {
        'apps/web/src/TooLarge.tsx': { maxLines: 2, maxBytes: 5 },
      },
    }),
    'packages/ui/src/index.ts': 'export {};',
    'packages/hooks/src/index.ts': 'export {};',
    'packages/dashboards/src/index.ts': 'export {};',
    'packages/types/src/index.ts': 'export {};',
  });

  const failures = architectureGuardFailures(root).join('\n');
  assert.match(failures, /TooLarge\.tsx grew to 3 lines; budget is 2/);
  assert.match(failures, /TooLarge\.tsx grew to 14 bytes; budget is 5/);
});

test('ratchets duplicated Rust time-range resolvers', () => {
  const root = fixture({
    'apps/api/src/routes/one.rs': 'fn resolve_time_bounds() {}',
    'apps/api/src/routes/two.rs': 'fn resolve_time_bounds() {}',
    'config/architecture-budgets.json': JSON.stringify({
      patterns: {
        resolveTimeBounds: {
          pattern: String.raw`^\s*(?:pub\s+)?fn\s+resolve_time_bounds\s*\(`,
          directories: ['apps/api/src/routes'],
          extensions: ['.rs'],
          maxMatches: 1,
          message: 'time range forbidden',
        },
      },
    }),
    'packages/ui/src/index.ts': 'export {};',
    'packages/hooks/src/index.ts': 'export {};',
    'packages/dashboards/src/index.ts': 'export {};',
    'packages/types/src/index.ts': 'export {};',
  });

  const failures = architectureGuardFailures(root).join('\n');
  assert.match(failures, /time range forbidden has 2 matches; budget is 1/);
});

test('requires an exception for new orchestration files over the threshold', () => {
  const root = fixture({
    'apps/web/src/TooOrchestrated.tsx': 'one\ntwo\nthree\n',
    'config/architecture-budgets.json': JSON.stringify({
      orchestration: {
        maxLines: 2,
        roots: ['apps/web/src'],
        extensions: ['.tsx'],
        existingExceptions: {},
      },
    }),
    'packages/ui/src/index.ts': 'export {};',
    'packages/hooks/src/index.ts': 'export {};',
    'packages/dashboards/src/index.ts': 'export {};',
    'packages/types/src/index.ts': 'export {};',
  });

  const failures = architectureGuardFailures(root).join('\n');
  assert.match(failures, /New orchestration files over 2 lines require an architecture-budget exception/);
});

test('fails closed when architecture budgets are missing', () => {
  const root = fixture(
    {
      'packages/ui/src/index.ts': 'export {};',
      'packages/hooks/src/index.ts': 'export {};',
      'packages/dashboards/src/index.ts': 'export {};',
      'packages/types/src/index.ts': 'export {};',
    },
    { withBudgets: false },
  );

  const failures = architectureGuardFailures(root).join('\n');
  assert.match(failures, /Missing required architecture budget configuration/);
});
