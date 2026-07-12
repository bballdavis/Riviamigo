import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('dashboard Tailwind workspace source', () => {
  it('explicitly scans dashboard package utilities from the web CSS entrypoint', () => {
    expect(indexCss).toContain('@source "../../../packages/dashboards/src/**/*.{ts,tsx}";');
  });
});
