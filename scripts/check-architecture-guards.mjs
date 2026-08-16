#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceExtensions = ['.ts', '.tsx'];
const ignoredPathSegment = new Set(['node_modules', 'dist', 'coverage', '.turbo', '__tests__']);
const packageRoots = new Map([
  ['@riviamigo/ui', 'packages/ui/src'],
  ['@riviamigo/hooks', 'packages/hooks/src'],
  ['@riviamigo/dashboards', 'packages/dashboards/src'],
  ['@riviamigo/types', 'packages/types/src'],
]);

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredPathSegment.has(entry)) continue;
    const candidate = join(directory, entry);
    const details = statSync(candidate);
    if (details.isDirectory()) files.push(...sourceFiles(candidate));
    else if (sourceExtensions.includes(extname(candidate)) && !/\.(test|stories)\.[jt]sx?$/.test(entry)) {
      files.push(candidate);
    }
  }
  return files;
}

function importSpecifiers(source) {
  return [
    ...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
}

function resolveCandidate(base) {
  for (const extension of sourceExtensions) {
    if (existsSync(`${base}${extension}`)) return `${base}${extension}`;
  }
  for (const extension of sourceExtensions) {
    const index = join(base, `index${extension}`);
    if (existsSync(index)) return index;
  }
  return undefined;
}

function resolveImport(root, fromFile, specifier) {
  if (specifier.startsWith('.')) return resolveCandidate(resolve(dirname(fromFile), specifier));

  for (const [packageName, packageRoot] of packageRoots) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      const suffix = specifier.slice(packageName.length).replace(/^\//, '');
      return resolveCandidate(join(root, packageRoot, suffix));
    }
  }

  return undefined;
}

export function findCircularDependencies(root) {
  const roots = [
    'apps/web/src',
    'packages/ui/src',
    'packages/hooks/src',
    'packages/dashboards/src',
    'packages/types/src',
  ].map((path) => join(root, path));
  const files = roots.flatMap(sourceFiles);
  const graph = new Map(
    files.map((file) => [
      file,
      importSpecifiers(readFileSync(file, 'utf8'))
        .map((specifier) => resolveImport(root, file, specifier))
        .filter((target) => target && files.includes(target)),
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];

  function visit(file) {
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      cycles.push([...stack.slice(start), file].map((entry) => relative(root, entry)));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of files) visit(file);
  return cycles;
}

function findMatches(root, directory, expression) {
  return sourceFiles(join(root, directory))
    .filter((file) => expression.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file));
}

export function architectureGuardFailures(root) {
  const failures = [];
  const uiTransport = findMatches(
    root,
    'packages/ui/src',
    /\bfetch\s*\(|new\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|\baxios\s*(?:\.|\()/,
  );
  if (uiTransport.length) {
    failures.push(`Shared UI must not create network transports: ${uiTransport.join(', ')}`);
  }

  const routeTransport = findMatches(
    root,
    'apps/web/src/routes',
    /\bfetch\s*\(|new\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|\baxios\s*(?:\.|\()/,
  );
  if (routeTransport.length) {
    failures.push(`Route modules must use hooks rather than raw transports: ${routeTransport.join(', ')}`);
  }

  const cycles = findCircularDependencies(root);
  if (cycles.length) {
    failures.push(`Circular source dependencies are forbidden:\n${cycles.map((cycle) => `  - ${cycle.join(' -> ')}`).join('\n')}`);
  }

  return failures;
}

export function runArchitectureGuards(root) {
  const failures = architectureGuardFailures(root);
  try {
    execFileSync(process.execPath, ['scripts/sync-dashboard-defaults.mjs', '--check'], {
      cwd: root,
      stdio: 'pipe',
    });
  } catch (error) {
    failures.push(`Dashboard defaults are not in sync:\n${error.stderr?.toString().trim() || error.message}`);
  }
  try {
    execFileSync(process.execPath, ['scripts/check-api-route-security.mjs'], {
      cwd: root,
      stdio: 'pipe',
    });
  } catch (error) {
    failures.push(`API route security guard failed:\n${error.stderr?.toString().trim() || error.message}`);
  }
  return failures;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const failures = runArchitectureGuards(root);
  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join('\n'));
    process.exit(1);
  }
  console.log('Architecture guards passed: shared UI and routes own no raw transports, dashboard defaults are synced, route policy is current, and source dependencies are acyclic.');
}
