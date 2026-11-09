import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBuildVersion } from './resolve-build-version.mjs';

test('picks the highest release numerically and marks non-tag builds +dev', () => {
  assert.equal(resolveBuildVersion(['2026.09.4', '2026.10.1', '2026.10.0', '2026.10.10', '2026.10.9']), '2026.10.10+dev');
});

test('reports the exact tag when HEAD is the latest release', () => {
  assert.equal(resolveBuildVersion(['2026.09.4', '2026.10.1'], ['2026.10.1']), '2026.10.1');
});

test('ignores prerelease and unrelated tags; unknown without releases', () => {
  assert.equal(resolveBuildVersion(['2026.10.1-rc.1', 'v1', 'nightly']), 'unknown');
  assert.equal(resolveBuildVersion(['2026.10.1-rc.1', '2026.09.4']), '2026.09.4+dev');
});

test('candidate builds count commits since the release', () => {
  assert.equal(resolveBuildVersion(['2026.10.1'], [], 7), '2026.10.1+dev.7');
  assert.equal(resolveBuildVersion(['2026.10.1'], ['2026.10.1'], 0), '2026.10.1');
});
