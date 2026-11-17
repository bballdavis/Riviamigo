#!/usr/bin/env node
// Enforces the mechanical parts of docs/architecture/logging.md:
// message style, field names, forbidden sensitive fields, and stray
// stdout/console output. Level choice is a judgment call and stays in review.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MACRO = /(?<![\w:])(?:tracing::)?(trace|debug|info|warn|error)!\s*\(/g;
const FORBIDDEN_FIELDS = new Set([
  'password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'cookie', 'authorization',
  'email', 'vin', 'lat', 'lon', 'lng', 'latitude', 'longitude', 'address',
]);
const BANNED_FIELD_ALIASES = new Map([
  ['err', 'error'],
  ['e', 'error'],
]);
// The browser diagnostics seam is the only place allowed to write to the console.
const CONSOLE_ALLOWLIST = new Set(['packages/ui/src/lib/clientDiagnostics.ts']);
const WEB_ROOTS = [
  'apps/web/src',
  'packages/ui/src',
  'packages/hooks/src',
  'packages/dashboards/src',
  'packages/types/src',
];

function walk(directory, accept) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (['node_modules', 'dist', 'coverage', 'target', '__tests__'].includes(entry)) continue;
    const candidate = join(directory, entry);
    if (statSync(candidate).isDirectory()) files.push(...walk(candidate, accept));
    else if (accept(candidate)) files.push(candidate);
  }
  return files;
}

const rel = (root, file) => relative(root, file).replaceAll('\\', '/');

/** Index of the matching close paren for the open paren at `start`, or -1. */
function matchParen(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      i = skipString(source, i);
      if (i < 0) return -1;
    } else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(source, start) {
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === '\\') i += 1;
    else if (source[i] === '"') return i;
  }
  return -1;
}

/** Split a macro argument list on top-level commas. */
function splitArgs(body) {
  const args = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"') {
      const end = skipString(body, i);
      if (end < 0) return args;
      current += body.slice(i, end + 1);
      i = end;
      continue;
    }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/** Style problems for every tracing macro in one Rust source string. */
export function tracingProblems(source) {
  const problems = [];
  for (const match of source.matchAll(MACRO)) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(source, open);
    if (close < 0) continue;
    const line = lineOf(source, match.index);
    const args = splitArgs(source.slice(open + 1, close));
    for (const arg of args) {
      const field = /^[%?]?\s*([A-Za-z_][\w.]*)\s*=(?!=)/.exec(arg)?.[1];
      if (!field) continue;
      if (BANNED_FIELD_ALIASES.has(field)) {
        problems.push({ line, message: `field \`${field}\` should be named \`${BANNED_FIELD_ALIASES.get(field)}\`` });
      }
      if (FORBIDDEN_FIELDS.has(field)) {
        problems.push({ line, message: `field \`${field}\` is sensitive and must not be logged` });
      }
    }
    const last = args.at(-1);
    if (!last || !last.startsWith('"')) continue;
    const text = last.slice(1, -1);
    if (/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(text)) problems.push({ line, message: `message "${text}" is an event code; write a short sentence` });
    else if (/[.!]$/.test(text)) problems.push({ line, message: `message "${text}" ends with punctuation` });
    if (/^[A-Z][a-z]/.test(text)) problems.push({ line, message: `message "${text}" should start lowercase` });
    if (/(?<!\{)\{[^{}]*\}(?!\})/.test(text)) {
      problems.push({ line, message: `message "${text}" interpolates values; use fields instead` });
    }
  }
  return problems;
}

/** Direct stdout/stderr writes in library code (everything but src/bin and tests). */
export function stdoutProblems(source) {
  const production = source.split(/#\[cfg\(test\)\]/)[0];
  const problems = [];
  for (const match of production.matchAll(/(?<![\w:])(println|eprintln|print|eprint|dbg)!\s*\(/g)) {
    problems.push({ line: lineOf(production, match.index), message: `\`${match[1]}!\` in library code; use tracing` });
  }
  return problems;
}

/** A second subscriber would bypass the shared format and filter. */
export function subscriberProblems(source) {
  const problems = [];
  for (const match of source.matchAll(/tracing_subscriber::fmt::(init|try_init)\b|tracing_subscriber::fmt\(\)/g)) {
    problems.push({ line: lineOf(source, match.index), message: 'own tracing subscriber; call riviamigo_api::logging::init()' });
  }
  return problems;
}

export function consoleProblems(source) {
  const problems = [];
  for (const match of source.matchAll(/\bconsole\.(log|debug|info|warn|error|group|groupCollapsed|trace)\b/g)) {
    problems.push({ line: lineOf(source, match.index), message: `console.${match[1]} outside the client diagnostics seam` });
  }
  return problems;
}

/** Message style for `clientLog.<level>('area', 'message', ...)` calls in browser code. */
export function clientLogProblems(source) {
  const problems = [];
  for (const match of source.matchAll(/\bclientLog\.(trace|debug|info|warn|error)\(\s*'([^']*)'\s*,\s*'([^']*)'/g)) {
    const [, , area, text] = match;
    const line = lineOf(source, match.index);
    if (!/^[a-z][a-z0-9_]*$/.test(area)) problems.push({ line, message: `clientLog area "${area}" should be a lowercase word` });
    if (/[.!]$/.test(text)) problems.push({ line, message: `message "${text}" ends with punctuation` });
    if (/^[A-Z][a-z]/.test(text)) problems.push({ line, message: `message "${text}" should start lowercase` });
    if (/\$\{/.test(text)) problems.push({ line, message: `message "${text}" interpolates values; use fields instead` });
  }
  return problems;
}

export function loggingFailures(root) {
  const failures = [];
  const apiSource = join(root, 'apps/api/src');
  const rustFiles = walk(apiSource, (file) => extname(file) === '.rs');
  for (const file of rustFiles) {
    const path = rel(root, file);
    const source = readFileSync(file, 'utf8');
    const isTest = /(^|\/)tests?(\.rs|\/)/.test(path.replace('apps/api/src/', ''));
    const problems = [...(isTest ? [] : tracingProblems(source))];
    if (path !== 'apps/api/src/logging.rs') problems.push(...subscriberProblems(source));
    if (!path.startsWith('apps/api/src/bin/') && !isTest) problems.push(...stdoutProblems(source));
    for (const { line, message } of problems) failures.push(`${path}:${line}: ${message}`);
  }
  for (const directory of WEB_ROOTS) {
    const files = walk(join(root, directory), (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|stories)\.[jt]sx?$/.test(file));
    for (const file of files) {
      const path = rel(root, file);
      const source = readFileSync(file, 'utf8');
      const problems = [...clientLogProblems(source)];
      if (!CONSOLE_ALLOWLIST.has(path)) problems.push(...consoleProblems(source));
      for (const { line, message } of problems) failures.push(`${path}:${line}: ${message}`);
    }
  }
  return failures;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const failures = loggingFailures(root);
  if (failures.length) {
    console.error(`Logging conventions (docs/architecture/logging.md) violated:\n${failures.map((f) => `- ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Logging conventions passed: tracing and clientLog message style, field names, sensitive-field ban, and stdout/console hygiene.');
}
