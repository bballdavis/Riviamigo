import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildAssetManifest } from './asset-manifest.mjs';
import { radAssets } from './rad-assets.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(packageDir, '../..');
for (const [name, source] of Object.entries(radAssets())) {
  await writeFile(resolve(root, 'apps/web/public', name), source, 'utf8');
}
const source = pathToFileURL(resolve(packageDir, 'src/index.ts')).href;
const expression = `import { registryManifest, stableThemeJson } from ${JSON.stringify(source)}; console.log(stableThemeJson(registryManifest()));`;
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', expression], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'Unable to load theme registry');
const manifest = JSON.parse(result.stdout);
const output = `${JSON.stringify(manifest, null, 2)}\n`;
const target = resolve(root, 'apps/api/src/themes/builtins.generated.json');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, output, 'utf8');
console.log(`Generated ${target}`);
const assetTarget = resolve(packageDir, 'generated/assets.generated.json');
await mkdir(dirname(assetTarget), { recursive: true });
await writeFile(assetTarget, `${JSON.stringify(await buildAssetManifest(root, manifest), null, 2)}\n`, 'utf8');
console.log(`Generated ${assetTarget}`);
