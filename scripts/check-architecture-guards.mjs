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

function sourceFiles(directory, extensions = sourceExtensions) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredPathSegment.has(entry)) continue;
    const candidate = join(directory, entry);
    const details = statSync(candidate);
    if (details.isDirectory()) files.push(...sourceFiles(candidate, extensions));
    else if (extensions.includes(extname(candidate)) && !/\.(test|stories)\.[jt]sx?$/.test(entry)) {
      files.push(candidate);
    }
  }
  return files;
}

function sourceFilesIn(root, directories, extensions = sourceExtensions) {
  return directories.flatMap((directory) => {
    const absolute = join(root, directory);
    return existsSync(absolute) && statSync(absolute).isDirectory() ? sourceFiles(absolute, extensions) : [];
  });
}

function relativePath(root, file) {
  return relative(root, file).replaceAll('\\', '/');
}

function countLines(source) {
  const lines = source.split(/\r\n|\n|\r/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function readArchitectureBudgets(root) {
  const path = join(root, 'config/architecture-budgets.json');
  if (!existsSync(path)) {
    throw new Error(`Missing required architecture budget configuration: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function patternRuleFailures(root, patterns = {}) {
  const failures = [];
  for (const [name, rule] of Object.entries(patterns)) {
    if (rule.enabled === false) continue;
    const flags = rule.flags ?? 'm';
    const expression = new RegExp(rule.pattern, flags);
    const countExpression = new RegExp(rule.pattern, flags.includes('g') ? flags : `${flags}g`);
    const allow = new Set(rule.allow ?? []);
    const files = sourceFilesIn(root, rule.directories ?? [], rule.extensions ?? sourceExtensions);
    const matches = files
      .filter((file) => expression.test(readFileSync(file, 'utf8')))
      .map((file) => relativePath(root, file));
    const matchCount = files.reduce(
      (count, file) => count + (readFileSync(file, 'utf8').match(countExpression)?.length ?? 0),
      0,
    );
    const violations = matches.filter((file) => !allow.has(file));
    if (violations.length) {
      failures.push(`${rule.message ?? name} (${violations.join(', ')})`);
    }
    if (rule.maxMatches !== undefined && matchCount > rule.maxMatches) {
      failures.push(`${rule.message ?? name} has ${matchCount} matches; budget is ${rule.maxMatches}`);
    }
  }
  return failures;
}

function hotspotBudgetFailures(root, hotspots = {}) {
  const failures = [];
  for (const [path, budget] of Object.entries(hotspots)) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      failures.push(`Architecture hotspot is missing from its budget: ${path}`);
      continue;
    }
    const source = readFileSync(absolute, 'utf8');
    const lines = countLines(source);
    const bytes = Buffer.byteLength(source.replace(/\r\n?/g, '\n'));
    if (budget.maxLines !== undefined && lines > budget.maxLines) {
      failures.push(`${path} grew to ${lines} lines; budget is ${budget.maxLines}`);
    }
    if (budget.maxBytes !== undefined && bytes > budget.maxBytes) {
      failures.push(`${path} grew to ${bytes} bytes; budget is ${budget.maxBytes}`);
    }
  }
  return failures;
}

function orchestrationBudgetFailures(root, orchestration = {}) {
  const maxLines = orchestration.maxLines;
  if (!maxLines || !orchestration.roots?.length) return [];
  const existingExceptions = new Set(Object.keys(orchestration.existingExceptions ?? {}));
  const offenders = sourceFilesIn(root, orchestration.roots, orchestration.extensions ?? ['.ts', '.tsx', '.rs'])
    .filter((file) => countLines(readFileSync(file, 'utf8')) > maxLines)
    .map((file) => relativePath(root, file))
    .filter((file) => !existingExceptions.has(file));
  return offenders.length
    ? [`New orchestration files over ${maxLines} lines require an architecture-budget exception: ${offenders.join(', ')}`]
    : [];
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
  const files = roots.flatMap((directory) => (existsSync(directory) ? sourceFiles(directory) : []));
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
      cycles.push(
        [...stack.slice(start), file].map((entry) => relative(root, entry).replaceAll('\\', '/')),
      );
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
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return sourceFiles(absolute)
    .filter((file) => expression.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file));
}

export function architectureGuardFailures(root) {
  const failures = [];
  let budgets = {};
  try {
    budgets = readArchitectureBudgets(root);
  } catch (error) {
    failures.push(`Architecture budget configuration is invalid: ${error.message}`);
  }

  failures.push(...patternRuleFailures(root, budgets.patterns));
  failures.push(...hotspotBudgetFailures(root, budgets.hotspots));
  failures.push(...orchestrationBudgetFailures(root, budgets.orchestration));

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
  console.log('Architecture guards passed: budgets and duplicate-pattern ratchets are within limits, shared UI and routes own no raw transports, dashboard defaults are synced, route policy is current, and source dependencies are acyclic.');
}
