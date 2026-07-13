import assert from 'node:assert/strict';
import test from 'node:test';
import { nextReleaseVersion } from './next-release-version.mjs';

test('starts a Calendar Version month at patch zero', () => {
  assert.equal(nextReleaseVersion([], '2026.07'), '2026.07.0');
});

test('increments only matching Calendar Version tags', () => {
  assert.equal(
    nextReleaseVersion(['2026.06.9', '2026.07.0', '2026.07.3', 'not-a-release'], '2026.07'),
    '2026.07.4',
  );
});
