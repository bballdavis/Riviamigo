import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(siteDir, '../..');
const docsRoot = path.join(repoRoot, 'docs');
const githubRoot = 'https://github.com/bballdavis/Riviamigo';

function sourcePathOnDisk(sourceFilePath) {
  if (path.isAbsolute(sourceFilePath)) return sourceFilePath;
  const fromSite = path.resolve(siteDir, sourceFilePath);
  if (fs.existsSync(fromSite)) return fromSite;
  return path.resolve(repoRoot, sourceFilePath);
}

function repositoryUrl(targetPath, suffix = '') {
  const stat = fs.statSync(targetPath);
  const relative = path.relative(repoRoot, targetPath).split(path.sep).map(encodeURIComponent).join('/');
  return `${githubRoot}/${stat.isDirectory() ? 'tree' : 'blob'}/main/${relative}${suffix}`;
}

export function rewriteRepositoryLink({sourceFilePath, url}) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return url;

  const match = url.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const target = match?.[1] ?? url;
  const suffix = `${match?.[2] ?? ''}${match?.[3] ?? ''}`;
  const sourcePath = sourcePathOnDisk(sourceFilePath);
  const targetPath = path.resolve(path.dirname(sourcePath), decodeURIComponent(target));

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Broken documentation link in ${sourceFilePath}: ${url}`);
  }

  const relativeToDocs = path.relative(docsRoot, targetPath);
  if (!relativeToDocs.startsWith('..') && !path.isAbsolute(relativeToDocs)) {
    return url;
  }

  return repositoryUrl(targetPath, suffix);
}

function walk(node, visit) {
  visit(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visit);
  }
}

export function remarkRepositoryLinks() {
  return (tree, file) => {
    walk(tree, (node) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        node.url = rewriteRepositoryLink({sourceFilePath: file.path, url: node.url});
      }
    });
  };
}
