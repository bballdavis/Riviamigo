#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogsOnly = process.argv.includes('--catalogs-only');
const failures = [];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

function walk(directory, filename) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    if (
      ['.git', 'node_modules', 'dist', 'coverage', '.turbo', 'storybook-static'].includes(entry)
    ) {
      continue;
    }
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) results.push(...walk(path, filename));
    else if (entry === filename) results.push(path);
  }
  return results;
}

function walkExtensions(directory, extensions) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    if (
      ['.git', 'node_modules', 'dist', 'coverage', '.turbo', 'storybook-static'].includes(entry)
    ) {
      continue;
    }
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) results.push(...walkExtensions(path, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) results.push(path);
  }
  return results;
}

const workspaceYaml = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
const catalogMatch = workspaceYaml.match(/^catalog:\r?\n((?:^[ ]{2}.+\r?\n?)*)/m);
if (!catalogMatch) failures.push('pnpm-workspace.yaml must define a default catalog.');

const catalogNames = new Set(
  (catalogMatch?.[1] ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^  ['\"]?([^'\"]+?)['\"]?:\s/)?.[1])
    .filter(Boolean)
);

for (const manifestPath of walk(root, 'package.json')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (catalogNames.has(name) && version !== 'catalog:') {
        failures.push(`${relative(root, manifestPath)}: ${name} must use catalog: in ${section}.`);
      }
    }
  }
}

if (!catalogsOnly) {
  const baseline = readJson('config/dependency-baselines.json');
  const rootPackage = readJson('package.json');
  const packageManager = rootPackage.packageManager?.match(/^pnpm@([^+]+)/)?.[1];
  if (packageManager !== baseline.pnpm) {
    failures.push(
      `packageManager pnpm ${packageManager ?? 'missing'} does not match ${baseline.pnpm}.`
    );
  }
  const requiredNodePrefix = `>=${baseline.node.split('.').slice(0, 2).join('.')}`;
  if (!rootPackage.engines?.node?.startsWith(requiredNodePrefix)) {
    failures.push(`Node engine must start with ${requiredNodePrefix}.`);
  }

  const expectedPatterns = [
    ['rust-toolchain.toml', `channel = "${baseline.rust}"`],
    ['apps/api/Cargo.toml', `rust-version = "${baseline.rust.split('.').slice(0, 2).join('.')}"`],
    ['compose/Dockerfile', `rust:${baseline.rust}-slim`],
    ['compose/Dockerfile', `node:${baseline.node}-alpine`],
    ['compose/Dockerfile', `postgres:${baseline.postgres}-bookworm`],
    ['apps/api/Dockerfile', `rust:${baseline.rust}-slim`],
    ['apps/api/Dockerfile', `postgres:${baseline.postgres}-bookworm`],
    ['compose/docker-compose.yml', `timescale/timescaledb:${baseline.timescaledb}`],
    ['compose/docker-compose.yml', `redis:${baseline.redis}`],
    ['compose/docker-compose.dev.yml', `timescale/timescaledb:${baseline.timescaledb}`],
    ['compose/docker-compose.dev.yml', `redis:${baseline.redis}`],
    ['compose/docker-compose.dev.yml', `dxflrs/garage:v${baseline.garage}`],
  ];

  for (const [path, expected] of expectedPatterns) {
    const contents = readFileSync(resolve(root, path), 'utf8');
    if (!contents.includes(expected)) failures.push(`${path} must contain ${expected}.`);
  }

  for (const workflow of walkExtensions(resolve(root, '.github', 'workflows'), ['.yml', '.yaml'])) {
    const contents = readFileSync(workflow, 'utf8');
    for (const match of contents.matchAll(/node-version:\s*['\"]?([0-9]+)/g)) {
      if (match[1] !== baseline.node.split('.')[0]) {
        failures.push(`${relative(root, workflow)} still references Node ${match[1]}.`);
      }
    }
    for (const match of contents.matchAll(
      /NODE_VERSION:\s*['"]?([0-9]+(?:\.[0-9]+(?:\.[0-9]+)?)?)/g
    )) {
      if (match[1] !== baseline.node) {
        failures.push(
          `${relative(root, workflow)} pins NODE_VERSION ${match[1]}; expected ${baseline.node}.`
        );
      }
    }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(
  catalogsOnly ? 'Dependency catalogs are consistent.' : 'Dependency policy is consistent.'
);
