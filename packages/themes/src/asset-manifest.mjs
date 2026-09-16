import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function buildAssetManifest(root, registry) {
  const references = new Map();
  for (const theme of registry.builtins) {
    for (const [kind, modes] of Object.entries(theme.brandAssets)) {
      for (const [mode, publicPath] of Object.entries(modes)) {
        const owners = references.get(publicPath) ?? [];
        owners.push({ themeId: theme.id, kind, mode });
        references.set(publicPath, owners);
      }
    }
  }

  const assets = [];
  for (const [publicPath, owners] of [...references].sort(([first], [second]) => first.localeCompare(second))) {
    const file = resolve(root, 'apps/web/public', publicPath.replace(/^\//, ''));
    const bytes = await readFile(file);
    const source = bytes.toString('utf8');
    const embedsRaster = /<image\b/i.test(source);
    const externalReferences = [...source.matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((value) => !value.startsWith('data:'));
    assets.push({
      publicPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      status: embedsRaster ? 'raster-backed-fallback' : 'approved-vector',
      selfContained: externalReferences.length === 0,
      externalReferences,
      owners,
    });
  }
  return { schemaVersion: 1, assets };
}
