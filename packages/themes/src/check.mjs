import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(packageDir, '../..');
const source = pathToFileURL(resolve(packageDir, 'src/index.ts')).href;
const expression = `import { registryManifest, stableThemeJson } from ${JSON.stringify(source)}; console.log(stableThemeJson(registryManifest()));`;
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', expression], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'Unable to load theme registry');
const expected = `${JSON.stringify(JSON.parse(result.stdout), null, 2)}\n`;
const target = resolve(root, 'apps/api/src/themes/builtins.generated.json');
let actual;
try { actual = await readFile(target, 'utf8'); } catch { throw new Error(`Missing generated theme manifest: ${target}`); }
if (actual !== expected) throw new Error(`Generated theme manifest is stale: ${target}. Run pnpm themes:generate.`);
console.log('Theme registry check passed.');
