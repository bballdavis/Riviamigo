#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationDirectory = resolve(root, 'apps/api/migrations');
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  throw new Error(`migration integrity failed: ${message}`);
}

function git(argumentsList, options = {}) {
  try {
    return execFileSync('git', argumentsList, {
      cwd: root,
      encoding: options.encoding ?? 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (options.allowFailure) return null;
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    fail(`git ${argumentsList.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function parseMigrationFile(fileName) {
  const match = /^(\d{4,})_([a-z][a-z0-9_]*)\.sql$/.exec(fileName);
  if (!match) fail(`${fileName} must match NNNN_description.sql using lowercase names`);
  const version = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(version) || version < 1) fail(`${fileName} has an invalid version`);
  return { fileName, version, description: match[2] };
}

function readMigration(file) {
  const bytes = readFileSync(resolve(migrationDirectory, file.fileName));
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`${file.fileName} is not valid UTF-8`);
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail(`${file.fileName} must not contain a UTF-8 BOM`);
  }
  if (bytes.includes(0x0d))
    fail(`${file.fileName} contains CRLF or a lone CR; migrations must use LF`);
  if (!bytes.length) fail(`${file.fileName} is empty`);
  if (bytes[bytes.length - 1] !== 0x0a) fail(`${file.fileName} must end with one LF newline`);
  if (bytes.includes(0x00)) fail(`${file.fileName} contains a NUL byte`);
  return {
    ...file,
    checksumSha384: createHash('sha384').update(bytes).digest('hex'),
    bytes,
  };
}

function currentCatalog() {
  const files = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => parseMigrationFile(entry.name))
    .sort((left, right) => left.version - right.version);
  if (files.length === 0) fail('no SQL migrations were found');
  if (files[0].version !== 1) fail('migration catalog must start at version 0001');
  const versions = new Set();
  for (const file of files) {
    if (versions.has(file.version)) fail(`duplicate migration version ${file.version}`);
    versions.add(file.version);
  }
  for (let index = 1; index < files.length; index += 1) {
    if (files[index].version !== files[index - 1].version + 1) {
      fail(
        `migration versions must be contiguous and ordered: ${files[index - 1].fileName}, ${files[index].fileName}`
      );
    }
  }
  const migrations = files.map(readMigration);
  const digestInput = JSON.stringify(
    migrations.map(({ version, description, checksumSha384 }) => ({
      version,
      description,
      checksum_sha384: checksumSha384,
    }))
  );
  return {
    migrations,
    digest: createHash('sha256').update(digestInput, 'utf8').digest('hex'),
  };
}

function baseMigrationFiles(baseRef) {
  const output = git(['ls-tree', '-r', '--name-only', baseRef, '--', 'apps/api/migrations']);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replace(/^apps\/api\/migrations\//, ''))
    .filter((fileName) => fileName.endsWith('.sql'));
}

function baseFile(baseRef, fileName) {
  return git(['show', `${baseRef}:apps/api/migrations/${fileName}`], { encoding: 'buffer' });
}

function resolveBaseRef() {
  const explicit =
    option('--base-ref') || process.env.GITHUB_BASE_SHA || process.env.GITHUB_BASE_REF;
  const candidates = [
    explicit,
    explicit && `origin/${explicit}`,
    'origin/main',
    'main',
    'HEAD^',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = git(['rev-parse', '--verify', `${candidate}^{commit}`], {
      allowFailure: true,
    });
    if (resolved) return candidate;
  }
  return null;
}

function isOneTimeBaselineCutover(baseFiles, currentFiles) {
  // This exact five-file-to-one-file shape is the single public-release cutover.
  // Once it merges, the merge base can no longer satisfy this condition.
  const base = baseFiles
    .map(parseMigrationFile)
    .sort((left, right) => left.version - right.version);
  const current = currentFiles
    .map(parseMigrationFile)
    .sort((left, right) => left.version - right.version);
  return (
    base.length === 5 &&
    base.every((file, index) => file.version === index + 1) &&
    current.length === 1 &&
    current[0].version === 1
  );
}

function enforceMergeBaseImmutability(catalog) {
  const baseRef = resolveBaseRef();
  if (!baseRef) {
    console.warn('migration integrity: no merge base was available; current-tree checks still ran');
    return;
  }
  const currentFiles = catalog.migrations.map(({ fileName }) => fileName);
  const baseFiles = baseMigrationFiles(baseRef);
  const baseSet = new Set(baseFiles);
  const currentSet = new Set(currentFiles);
  const cutover = isOneTimeBaselineCutover(baseFiles, currentFiles);
  const changed = [];

  if (cutover) {
    const currentBaseline = catalog.migrations.find((migration) => migration.version === 1);
    const previousBaseline = baseFile(
      baseRef,
      baseFiles.find((fileName) => parseMigrationFile(fileName).version === 1)
    );
    if (currentBaseline?.bytes.equals(previousBaseline)) {
      fail(
        'the one-time baseline cutover must replace 0001_initial_schema.sql with the complete schema'
      );
    }
  }

  for (const fileName of baseFiles) {
    if (!currentSet.has(fileName)) {
      const version = parseMigrationFile(fileName).version;
      if (!(cutover && version > 1))
        changed.push(`deleted previously merged migration ${fileName}`);
      continue;
    }
    const current = catalog.migrations.find((migration) => migration.fileName === fileName);
    const previous = baseFile(baseRef, fileName);
    if (!previous || !current.bytes.equals(previous)) {
      if (!(cutover && parseMigrationFile(fileName).version === 1)) {
        changed.push(`modified previously merged migration ${fileName}`);
      }
    }
  }

  const baseVersions = baseFiles.map((fileName) => parseMigrationFile(fileName).version);
  const maximumBaseVersion = Math.max(0, ...baseVersions);
  for (const fileName of currentFiles) {
    if (
      !baseSet.has(fileName) &&
      parseMigrationFile(fileName).version <= maximumBaseVersion &&
      !cutover
    ) {
      changed.push(
        `added migration ${fileName} without appending after version ${maximumBaseVersion}`
      );
    }
  }

  if (changed.length) fail(changed.join('; '));
  if (cutover) {
    console.warn(
      `migration integrity: recognized the explicit one-time baseline cutover from ${baseFiles.length} migrations at ${baseRef}`
    );
  }
  console.log(`migration integrity: merge-base immutability passed against ${baseRef}`);
}

const catalog = currentCatalog();
enforceMergeBaseImmutability(catalog);
console.log(
  `migration integrity: ${catalog.migrations.length} migration(s), catalog digest ${catalog.digest}`
);
