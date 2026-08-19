#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'compose/docker-compose.yml');
const targetPath = resolve(root, 'compose/docker-compose.synology.yml');
const generatedHeader = [
  '# GENERATED FILE — DO NOT EDIT DIRECTLY.',
  '# Source: compose/docker-compose.yml',
  '# Generator: scripts/generate-synology-compose.mjs',
].join('\n');

const forbiddenCpuKeys = new Set(['cpus', 'cpu_period', 'cpu_quota']);

function transformCompose(source) {
  const compose = parse(source);
  const app = compose?.services?.riviamigo;
  if (!app) throw new Error('standard Compose is missing the riviamigo service');

  app.ports = (app.ports ?? []).map((port) => {
    if (port === '${RIVIAMIGO_HOST_BIND_ADDRESS:-0.0.0.0}:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080') {
      return '127.0.0.1:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080';
    }
    return port;
  });

  function transform(value) {
    if (Array.isArray(value)) return value.map(transform);
    if (!value || typeof value !== 'object') {
      if (typeof value !== 'string') return value;
      return value
        .replaceAll(
          '${RIVIAMIGO_DATA_DIR:-../data}',
          '${RIVIAMIGO_DATA_DIR:?Set RIVIAMIGO_DATA_DIR to an absolute Synology path}'
        )
        .replaceAll('${RIVIAMIGO_ENV_FILE:-../.env}', '${RIVIAMIGO_ENV_FILE:-.env.synology}');
    }

    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (!forbiddenCpuKeys.has(key)) result[key] = transform(child);
    }
    return result;
  }

  return transform(compose);
}

function renderSynologyCompose(source) {
  return `${generatedHeader}\n${stringify(transformCompose(source), { lineWidth: 0 })}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rendered = renderSynologyCompose(readFileSync(sourcePath, 'utf8'));
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(targetPath, 'utf8');
    } catch {
      // The missing file is reported by the same stale-file path below.
    }
    if (current !== rendered) {
      console.error('Synology Compose is stale. Run pnpm compose:synology:generate.');
      process.exitCode = 1;
    } else {
      console.log('Synology Compose is current.');
    }
  } else {
    writeFileSync(targetPath, rendered, 'utf8');
    console.log(`Generated ${targetPath}`);
  }
}

export { forbiddenCpuKeys, renderSynologyCompose, transformCompose };
