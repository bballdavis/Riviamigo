import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const indexCss = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

describe('dashboard Tailwind workspace source', () => {
  it('explicitly scans dashboard package utilities from the web CSS entrypoint', () => {
    expect(indexCss).toContain('@source "../../../packages/dashboards/src/**/*.{ts,tsx}";');
  });
});
