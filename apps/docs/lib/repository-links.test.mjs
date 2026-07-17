import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {remarkRepositoryLinks, rewriteRepositoryLink} from './repository-links.mjs';

test('rewrites an existing repository file outside docs', () => {
  assert.equal(
    rewriteRepositoryLink({sourceFilePath: '../../docs/contributing.md', url: '../AGENTS.md#testing-expectations'}),
    'https://github.com/bballdavis/Riviamigo/blob/main/AGENTS.md#testing-expectations',
  );
});

test('rewrites an existing repository directory outside docs', () => {
  assert.equal(
    rewriteRepositoryLink({sourceFilePath: '../../docs/guides/getting-started.md', url: '../../compose/'}),
    'https://github.com/bballdavis/Riviamigo/tree/main/compose',
  );
});

test('leaves external and anchor links alone', () => {
  assert.equal(
    rewriteRepositoryLink({sourceFilePath: '../../docs/index.md', url: 'https://example.com/docs'}),
    'https://example.com/docs',
  );
  assert.equal(rewriteRepositoryLink({sourceFilePath: '../../docs/index.md', url: '#overview'}), '#overview');
});

test('leaves links within docs for Docusaurus to resolve', () => {
  assert.equal(
    rewriteRepositoryLink({sourceFilePath: '../../docs/index.md', url: './privacy.md'}),
    './privacy.md',
  );
});

test('remark adapter rewrites repository links before route resolution', () => {
  const tree = {type: 'root', children: [{type: 'link', url: '../../compose/', children: []}]};
  remarkRepositoryLinks()(tree, {path: fileURLToPath(new URL('../../../docs/guides/getting-started.md', import.meta.url))});
  assert.equal(tree.children[0].url, 'https://github.com/bballdavis/Riviamigo/tree/main/compose');
});

test('throws for missing repository targets', () => {
  assert.throws(
    () => rewriteRepositoryLink({sourceFilePath: '../../docs/index.md', url: '../missing-file.md'}),
    /Broken documentation link/,
  );
});
