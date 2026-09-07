#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = [
  'apps/web/src',
  'packages/ui/src',
  'packages/dashboards/src',
  'packages/hooks/src',
  'packages/themes/src',
];
const extensions = new Set(['.ts', '.tsx', '.css']);
const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

// These files own color values rather than consume them. Keep this list narrow
// and explicit so a new production raw color fails the guard by default.
const allowedOwners = new Set([
  'packages/themes/src/index.ts',
  'packages/ui/src/lib/color.ts',
  'packages/ui/src/tokens/colors.ts',
  'packages/ui/src/tokens/globals.css',
]);

const expressions = [
  /#[0-9a-f]{3,8}\b/i,
  /\brgba?\s*\(/i,
  /\b(?:text|bg|border|ring|outline|decoration|shadow)-(?:white|black|blue|indigo|sky|green|red|orange|yellow|slate|zinc|stone)(?:\b|[/\-][\w.\[\]-]+)/i,
];

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    if (ignoredDirectories.has(entry)) return [];
    const path = join(directory, entry);
    const details = statSync(path);
    if (details.isDirectory()) return filesBelow(path);
    if (!extensions.has(extname(path)) || /\.(?:test|spec|stories)\.[jt]sx?$/.test(entry)) return [];
    return [path];
  });
}

export function colorTokenViolations(root) {
  const violations = [];
  for (const file of roots.flatMap((directory) => filesBelow(join(root, directory)))) {
    const path = relative(root, file).replaceAll('\\', '/');
    if (allowedOwners.has(path)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r\n|\n|\r/);
    lines.forEach((line, index) => {
      if (expressions.some((expression) => expression.test(line))) violations.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  return violations;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invoked === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const violations = colorTokenViolations(root);
  if (violations.length) {
    console.error(`Color-token violations found:\n${violations.map((item) => `- ${item}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Color-token guard passed.');
}
