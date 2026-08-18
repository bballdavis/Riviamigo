import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan, DEFAULT_TEST_ROOT, HarnessError, inspectPackage } from './dev-harness.mjs';

const root = () => mkdtempSync(join(tmpdir(), 'riviamigo-test-'));
function tar(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8'); header.write('0000644\0', 100, 8, 'ascii'); header.write((data.length.toString(8).padStart(11, '0') + '\0'), 124, 12, 'ascii'); header[156] = 48;
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
function packageFile(dir, files = {}) {
  const members = { 'database.dump': 'PGDMP-test', 'backup-settings.json': '{}', ...files };
  const checksum = (name) => createHash('sha256').update(Buffer.from(members[name])).digest('hex');
  const size = (name) => Buffer.byteLength(members[name]);
  const manifest = { format: 'riviamigo-recovery-v1', format_version: 1, components: {
    database: { path: 'database.dump', sha256: checksum('database.dump'), size_bytes: size('database.dump') },
    backup_settings: { path: 'backup-settings.json', sha256: checksum('backup-settings.json'), size_bytes: size('backup-settings.json') },
  } };
  const archive = gzipSync(tar({ 'manifest.json': JSON.stringify(manifest), ...members }));
  const path = join(dir, 'verified.rma.tar.gz'); writeFileSync(path, archive); writeFileSync(`${path}.sha256`, `${createHash('sha256').update(archive).digest('hex')}  ${path}\n`); return path;
}
const image = (name) => `registry.example/${name}:1@sha256:${'a'.repeat(64)}`;
const base = (dir, overrides = {}) => {
  const composeFile = join(dir, 'docker-compose.test.yml');
  writeFileSync(composeFile, 'services:\n  riviamigo:\n    image: ${RIVIAMIGO_IMAGE_REF:?}\n  timescaledb:\n    image: timescale/timescaledb:2@sha256:' + 'b'.repeat(64) + '\n  redis:\n    image: redis:8@sha256:' + 'c'.repeat(64) + '\nnetworks:\n  riviamigo-prod-test-internal:\n    internal: true\n');
  return { packagePath: packageFile(dir), baselineImage: image('base'), devImage: image('dev'), testRoot: join(dir, 'target-test'), envFile: join(dir, '.env.test'), composeFile, port: 18066, project: 'riviamigo-test', reset: false, ...overrides };
};

test('rejects latest and unpinned images', () => {
  const dir = root(); writeFileSync(join(dir, '.env.test'), 'SAFE=1');
  assert.throws(() => buildPlan(base(dir, { baselineImage: 'repo/app:latest' })), HarnessError);
  assert.throws(() => buildPlan(base(dir, { devImage: 'repo/app:1' })), HarnessError);
});
test('rejects production path, port, and project', () => {
  const dir = root(); writeFileSync(join(dir, '.env.test'), 'SAFE=1');
  assert.throws(() => buildPlan(base(dir, { testRoot: '/share/Containers/Riviamigo-prod/data' })), /Production/);
  assert.throws(() => buildPlan(base(dir, { testRoot: '/share/Containers/Riviamigo-prod/testing/db' })), /Production/);
  assert.throws(() => buildPlan(base(dir, { port: 8066 })), /Production port/);
  assert.throws(() => buildPlan(base(dir, { project: 'riviamigo-prod' })), /test-labelled/);
  assert.doesNotThrow(() => buildPlan(base(dir, { project: 'riviamigo-prod-test' })));
});
test('accepts only the canonical production testing child and its mounts', () => {
  const dir = root(); writeFileSync(join(dir, '.env.test'), 'SAFE=1');
  const composeFile = join(dir, 'docker-compose.test.yml');
  const raw = base(dir, { testRoot: DEFAULT_TEST_ROOT, composeFile });
  writeFileSync(composeFile, 'services:\n  riviamigo:\n    image: ${RIVIAMIGO_IMAGE_REF:?}\n    volumes:\n      - /share/Containers/Riviamigo-prod/testing/db:/db\n');
  assert.doesNotThrow(() => buildPlan(raw));
  writeFileSync(composeFile, 'services:\n  riviamigo:\n    image: ${RIVIAMIGO_IMAGE_REF:?}\n    volumes:\n      - /share/Containers/Riviamigo-prod/db:/db\n');
  assert.throws(() => buildPlan(raw), /Compose/);
});
test('rejects traversal archive and missing manifest', () => {
  const dir = root();
  const traversal = packageFile(dir, { '../escape': 'bad' });
  assert.throws(() => inspectPackage(traversal), /Unsafe/);
  const missing = join(dir, 'missing.rma.tar.gz'); writeFileSync(missing, gzipSync(tar({ 'database.dump': 'PGDMP' })));
  assert.throws(() => inspectPackage(missing), /missing manifest/);
});
test('refuses populated storage without reset and allows explicit reset in safe root', () => {
  const dir = root(); writeFileSync(join(dir, '.env.test'), 'SAFE=1'); const target = join(dir, 'target-test'); mkdirSync(join(target, 'db'), { recursive: true }); writeFileSync(join(target, 'db', 'keep'), 'x');
  assert.throws(() => buildPlan(base(dir, { testRoot: target })), /populated/);
  assert.doesNotThrow(() => buildPlan(base(dir, { testRoot: target, reset: true })));
});
test('dry-run plan has machine-readable package, images, target, and phases', () => {
  const dir = root(); writeFileSync(join(dir, '.env.test'), 'SAFE=1'); const plan = buildPlan(base(dir));
  assert.equal(plan.kind, 'riviamigo-dev-harness-plan'); assert.ok(plan.package.path.endsWith('.rma.tar.gz')); assert.deepEqual(Object.keys(plan.images), ['baseline', 'dev']); assert.ok(plan.target.data.db); assert.ok(plan.phases.includes('restore-with-baseline-image')); assert.equal(plan.execution, 'dry-run');
});
