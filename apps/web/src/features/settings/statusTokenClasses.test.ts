import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tailwind defines the status colors as `status-positive|warning|danger|info`
 * (see packages/config/tailwind/base.ts). Bare `warning`, `positive`, `danger`,
 * `info`, or `success` color utilities compile to nothing, so the text or
 * border silently keeps its inherited color.
 */
const UNDEFINED_STATUS_UTILITY =
  /(?<![\w-])(?:text|bg|border|ring|fill|stroke|outline|from|to|via|divide|placeholder|decoration|accent|shadow)-(?:warning|positive|danger|info|success)(?![\w-])/;

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

const root = resolve(process.cwd(), 'src');
const scanned = [
  ...tsxFiles(join(root, 'features/settings')),
  ...tsxFiles(join(root, 'components/settings')),
  join(root, 'features/charts/editor/ChartEditorPage.tsx'),
];

describe('settings status color classes', () => {
  it('scans the settings and chart editor sources', () => {
    expect(scanned.length).toBeGreaterThan(10);
  });

  it('uses only defined status tokens', () => {
    const offenders = scanned.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
        .filter((entry) => UNDEFINED_STATUS_UTILITY.test(entry.text)),
    );
    expect(offenders.map((entry) => `${entry.file}:${entry.line} ${entry.text}`)).toEqual([]);
  });
});
