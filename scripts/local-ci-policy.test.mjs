import assert from 'node:assert/strict';
import test from 'node:test';
import { ghPrCreateArgs, selectHookGate, selectPushBase } from './local-ci-policy.mjs';

test('hooks use the fast local gate by default', () => {
  for (const hook of ['pre-commit', 'pre-push']) {
    assert.equal(selectHookGate({}, { hook }), 'local', `${hook} should use the local gate`);
  }
  assert.equal(selectHookGate(), 'local');
});

test('the full local CI gate requires an explicit flag', () => {
  assert.equal(selectHookGate({ RIVIAMIGO_FULL_LOCAL_CI: '1' }), 'full');
});

test('the emergency bypass takes precedence over the full gate flag', () => {
  assert.equal(selectHookGate({ SKIP_LOCAL_CI: '1', RIVIAMIGO_FULL_LOCAL_CI: '1' }), 'bypass');
  assert.equal(
    selectHookGate({ SKIP_LOCAL_CI: '1' }, { hook: 'pre-push', changedPaths: ['apps/api/src/main.rs'] }),
    'bypass',
  );
});

test('a push that changes the API runs the database-backed API gate', () => {
  for (const path of ['apps/api/src/services/external_connections.rs', 'apps/api/tests/auth_integration.rs', 'apps/api/migrations/0001.sql']) {
    assert.equal(selectHookGate({}, { hook: 'pre-push', changedPaths: ['docs/index.md', path] }), 'api', path);
  }
});

test('frontend-only pushes and every commit keep the fast gate', () => {
  assert.equal(selectHookGate({}, { hook: 'pre-push', changedPaths: ['apps/web/src/main.tsx', 'packages/ui/src/index.ts'] }), 'local');
  assert.equal(selectHookGate({}, { hook: 'pre-commit', changedPaths: ['apps/api/src/main.rs'] }), 'local');
  // A sibling directory sharing the prefix text is not the API.
  assert.equal(selectHookGate({}, { hook: 'pre-push', changedPaths: ['apps/api-docs/readme.md'] }), 'local');
});

test('the push base is the integration branch the feature branch is closest to', () => {
  assert.deepEqual(
    selectPushBase([
      { ref: 'origin/dev', mergeBase: 'a', aheadCount: 2 },
      { ref: 'origin/main', mergeBase: 'b', aheadCount: 30 },
    ])?.ref,
    'origin/dev',
  );
  assert.equal(selectPushBase([{ ref: 'origin/dev', mergeBase: '', aheadCount: null }]), null);
});

test('pr:create forwards gh arguments without the pnpm separator', () => {
  assert.deepEqual(ghPrCreateArgs(['--', '--base', 'dev', '--title', 'fix(ci): x']), ['--base', 'dev', '--title', 'fix(ci): x']);
  assert.deepEqual(ghPrCreateArgs(['--base', 'dev']), ['--base', 'dev']);
  assert.deepEqual(ghPrCreateArgs([]), []);
});
