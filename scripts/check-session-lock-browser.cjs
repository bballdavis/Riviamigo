// Exercise the production renewal lock across real same-origin browser tabs.
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { createServer } = require('node:http');
const { chromium } = require('../apps/web/node_modules/@playwright/test');
const assert = require('node:assert/strict');

async function main() {
  const source = stripTypeScriptTypes(readFileSync('packages/hooks/src/api/sessionLock.ts', 'utf8'));
  let active = 0;
  let maximum = 0;
  const server = createServer((request, response) => {
    if (request.url === '/lock.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(source); return;
    }
    if (request.url === '/begin') { active += 1; maximum = Math.max(active, maximum); response.end('ok'); return; }
    if (request.url === '/end') { active -= 1; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<script type="module">import {withSessionLock} from "/lock.js"; window.run = () => withSessionLock(async () => {await fetch("/begin"); try {await new Promise(r=>setTimeout(r,50));} finally {await fetch("/end");}});</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const mode of ['Web Locks', 'IndexedDB lease']) {
      active = 0; maximum = 0;
      const context = await browser.newContext();
      try {
        if (mode === 'IndexedDB lease') await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
        const pages = await Promise.all(Array.from({length:4}, () => context.newPage()));
        await Promise.all(pages.map(async page => {await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => typeof window.run === 'function');}));
        await Promise.all(pages.map(page => page.evaluate(() => Promise.all([window.run(), window.run()]))));
        assert.equal(maximum, 1, `${mode} must serialize every tab`);
        assert.equal(active, 0);
        console.log(`${mode}: eight renewals across four tabs, maximum concurrency ${maximum}`);
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => {console.error(error); process.exitCode=1;});
