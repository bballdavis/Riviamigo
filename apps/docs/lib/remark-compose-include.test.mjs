import test from 'node:test';
import assert from 'node:assert/strict';
import {includeComposeFile} from './remark-compose-include.mjs';

test('includes the canonical production Compose file', () => {
  const compose = includeComposeFile('compose/docker-compose.yml');

  assert.match(compose, /^services:/m);
  assert.match(compose, /timescaledb:/);
});

test('rejects includes outside the repository root', () => {
  assert.throws(() => includeComposeFile('../README.md'), /Invalid documentation include path/);
});
