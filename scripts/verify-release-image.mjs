#!/usr/bin/env node
/**
 * Build the same multi-platform image as the release workflows without
 * pushing it. The OCI output verifies both platform builds and is removed
 * when the command finishes.
 *
 * Usage:
 *   pnpm verify:release-image
 *   pnpm verify:release-image -- --no-cache
 *   node scripts/verify-release-image.mjs --timeout-minutes 45
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const platforms = value('--platforms', 'linux/amd64,linux/arm64');
const timeoutMinutes = Number(value('--timeout-minutes', '45'));
const noCache = args.includes('--no-cache');

if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
  throw new Error('--timeout-minutes must be a positive number.');
}

const output = join(tmpdir(), `riviamigo-release-image-${Date.now()}.oci`);
const dockerArgs = [
  'buildx',
  'build',
  '--progress=plain',
  '--platform',
  platforms,
  '--output',
  `type=oci,dest=${output}`,
  '--file',
  './compose/Dockerfile',
  ...(noCache ? ['--no-cache'] : []),
  '.',
];

console.log(`Building release image for ${platforms}.`);
if (noCache) console.log('Build cache is disabled.');
console.log(`The build will time out after ${timeoutMinutes} minutes.`);

const child = spawn('docker', dockerArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(
  () => {
    console.error(`Release image build exceeded ${timeoutMinutes} minutes.`);
    child.kill();
  },
  timeoutMinutes * 60 * 1000
);

try {
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  if (exitCode !== 0) throw new Error(`docker buildx exited with code ${exitCode}.`);
  console.log('Release image build passed for every requested platform.');
} finally {
  clearTimeout(timeout);
  rmSync(output, { force: true });
}
