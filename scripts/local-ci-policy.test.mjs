import assert from 'node:assert/strict';
import test from 'node:test';
import { selectHookGate } from './local-ci-policy.mjs';

test('hooks use the fast local gate by default', () => {
  for (const hook of ['pre-commit', 'pre-push']) {
    assert.equal(selectHookGate(), 'local', `${hook} should use the local gate`);
  }
});

test('the full local CI gate requires an explicit flag', () => {
  assert.equal(selectHookGate({ RIVIAMIGO_FULL_LOCAL_CI: '1' }), 'full');
});

test('the emergency bypass takes precedence over the full gate flag', () => {
  assert.equal(selectHookGate({ SKIP_LOCAL_CI: '1', RIVIAMIGO_FULL_LOCAL_CI: '1' }), 'bypass');
});
