import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(siteDir, '../..');
export function includeComposeFile(sourceFile) {
  if (!sourceFile || path.isAbsolute(sourceFile) || sourceFile.includes('..')) {
    throw new Error(`Invalid documentation include path: ${sourceFile ?? '(missing)'}`);
  }

  const targetPath = path.resolve(repoRoot, sourceFile);
  if (!targetPath.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(targetPath)) {
    throw new Error(`Documentation include target does not exist: ${sourceFile}`);
  }

  return fs.readFileSync(targetPath, 'utf8').replace(/\s+$/, '');
}

export function remarkComposeInclude() {
  return (tree) => {
    const visit = (node) => {
      if (Array.isArray(node.children)) {
        node.children = node.children.flatMap((child) => {
          if (child.type === 'code' && child.lang === 'compose-include') {
            return [{type: 'code', lang: 'yaml', value: includeComposeFile(child.value.trim())}];
          }
          visit(child);
          return [child];
        });
      }
    };

    visit(tree);
  };
}
