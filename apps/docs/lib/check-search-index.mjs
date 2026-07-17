import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(siteDir, 'build');
const docsIndexPath = path.join(buildDir, 'search-index-docs-default-current.json');
const pageIndexPath = path.join(buildDir, 'search-index-default.json');

for (const indexPath of [docsIndexPath, pageIndexPath]) {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing production search index: ${path.relative(siteDir, indexPath)}`);
  }
}

const docsIndex = fs.readFileSync(docsIndexPath, 'utf8').toLowerCase();
for (const term of ['installation', 'backup', 'dashboard', 'architecture', 'api', 'release']) {
  if (!docsIndex.includes(term)) {
    throw new Error(`Production documentation search index is missing the term: ${term}`);
  }
}

const pageIndex = JSON.parse(fs.readFileSync(pageIndexPath, 'utf8'));
if (!pageIndex.documents?.some((document) => document.sectionRoute === '/Riviamigo/')) {
  throw new Error('Production search index does not include the branded homepage');
}

console.log('Production search indexes contain the homepage and required documentation terms.');
