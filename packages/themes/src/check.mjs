import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildAssetManifest } from './asset-manifest.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(packageDir, '../..');
const source = pathToFileURL(resolve(packageDir, 'src/index.ts')).href;
const expression = `import { registryManifest, stableThemeJson } from ${JSON.stringify(source)}; console.log(stableThemeJson(registryManifest()));`;
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', expression], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'Unable to load theme registry');
const manifest = JSON.parse(result.stdout);
const expected = `${JSON.stringify(manifest, null, 2)}\n`;
const target = resolve(root, 'apps/api/src/themes/builtins.generated.json');
let actual;
try { actual = await readFile(target, 'utf8'); } catch { throw new Error(`Missing generated theme manifest: ${target}`); }
if (actual.replace(/\r\n/g, '\n') !== expected) throw new Error(`Generated theme manifest is stale: ${target}. Run pnpm themes:generate.`);
const assetTarget = resolve(packageDir, 'generated/assets.generated.json');
let actualAssets;
try { actualAssets = await readFile(assetTarget, 'utf8'); } catch { throw new Error(`Missing generated asset manifest: ${assetTarget}`); }
const expectedAssets = `${JSON.stringify(await buildAssetManifest(root, manifest), null, 2)}\n`;
if (actualAssets.replace(/\r\n/g, '\n') !== expectedAssets) throw new Error(`Generated theme asset manifest is stale: ${assetTarget}. Run pnpm themes:generate.`);
console.log('Theme registry check passed.');
