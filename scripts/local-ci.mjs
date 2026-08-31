import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.CARGO_TARGET_DIR = join(root, 'apps/api/target-ci-local');
const hookPath = join(root, '.githooks');
const ciProject = 'riviamigo-ci-local';
const ciCompose = ['-p', ciProject, '-f', 'compose/docker-compose.dev.yml'];
const ciEnv = {
  DEV_POSTGRES_PORT: '55432',
  DEV_REDIS_PORT: '56379',
  DATABASE_URL: 'postgresql://riviamigo:devpassword@127.0.0.1:55432/riviamigo',
  REDIS_URL: 'redis://127.0.0.1:56379',
  RIVIAMIGO_ENV: 'development',
};

function commandName(command) {
  return process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
}

function run(command, args = [], options = {}) {
  const label = options.label ?? `${command} ${args.join(' ')}`;
  console.log(`\n==> ${label}`);
  const result = spawnSync(commandName(command), args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function runWithRetries(command, args = [], options = {}) {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      run(command, args, options);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`${options.label ?? command} failed during service startup; retrying in ${retryDelayMs / 1_000}s (${attempt}/${attempts}).`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
    }
  }
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function trackedFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? trackedFiles(path) : [path];
  });
}

function colorTokenGuard() {
  const roots = ['apps/web/src', 'packages/ui/src', 'packages/dashboards/src', 'packages/hooks/src'];
  const pattern = /#[0-9a-f]{3,8}\b|rgba?\(|(?:text|bg|border|shadow|fill|stroke|ring|outline|divide|placeholder|decoration|accent|caret|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?(?:\/\d+)?\b/i;
  const allowed = /tokens[\\/]colors\.ts|globals\.css|charts[\\/]ChartProvider\.tsx|\.test\.|\.spec\.|getPropertyValue|CHART_COLORS|CLASSIC_CHART_COLORS|RAD_CHART_COLORS|CHART_PALETTES|rm-map-route|\/\/.*#/;
  const violations = roots.flatMap((path) => trackedFiles(join(root, path)))
    .filter((path) => /\.(tsx?|css)$/.test(path))
    .flatMap((path) => readFileSync(path, 'utf8').split(/\r?\n/).map((line, index) => ({ path, line, index }))
      .filter(({ path, line }) => pattern.test(line) && !allowed.test(`${relative(root, path)} ${line}`)));
  if (violations.length) {
    console.error('Color-token violations found:');
    for (const violation of violations) console.error(`${relative(root, violation.path)}:${violation.index + 1}: ${violation.line}`);
    throw new Error('Use design tokens instead of raw colors.');
  }
}

function hygiene() {
  const forbidden = git(['ls-files']).split(/\r?\n/).filter(Boolean).filter((path) =>
    /(^|\/)(\.codex|\.claude|node_modules|target|dist|coverage|\.turbo|\.playwright-cli)(\/|$)|(^|\/)(package-lock\.json|test_output\.txt)$|(^|\/)[^/]+\.tmp$/.test(path));
  if (forbidden.length) throw new Error(`Generated or local-only files are tracked:\n${forbidden.join('\n')}`);
  run('git', ['diff', '--check', 'HEAD'], { label: 'Repository whitespace check' });
}

function commonChecks({ includeInstall = false, includeBuild = false, apiTests = 'lib', env = {} } = {}) {
  if (includeInstall) run('pnpm', ['install', '--frozen-lockfile'], { label: 'Install locked dependencies' });
  hygiene();
  run('node', ['tools/migration-integrity.mjs'], { label: 'Migration integrity' });
  run('pnpm', ['deps:check'], { label: 'Dependency policy' });
  run('pnpm', ['peers', 'check'], { label: 'Peer dependencies' });
  run('pnpm', ['turbo', 'lint'], { label: 'Lint' });
  colorTokenGuard();
  run('pnpm', ['typecheck'], { label: 'Typecheck' });
  run('pnpm', ['docs:check'], { label: 'Documentation check' });
  run('pnpm', ['compose:check'], { label: 'Compose contract' });
  run('pnpm', ['release-workflows:check'], { label: 'Release workflow contract' });
  run('pnpm', ['compose:render-check'], { label: 'Compose render check' });
  run('pnpm', ['architecture:check'], { label: 'Architecture guards' });
  run('pnpm', ['security:routes'], { label: 'Route security inventory' });
  run('pnpm', ['dashboards:sync-defaults', '--check'], { label: 'Dashboard default drift' });
  run('pnpm', ['charts:sync-defaults', '--check'], { label: 'Chart default drift' });
  run('pnpm', ['test'], { label: 'Workspace tests' });
  if (apiTests === 'all') run('pnpm', ['test:api'], { cwd: root, env, label: 'API tests' });
  if (apiTests === 'lib') run('cargo', ['test', '--manifest-path', 'apps/api/Cargo.toml', '--lib', '--all-features'], { cwd: root, env, label: 'API library tests' });
  run('cargo', ['fmt', '--all', '--check'], { cwd: join(root, 'apps/api'), env, label: 'Rust format check' });
  if (includeBuild) {
    run('pnpm', ['build'], { label: 'Workspace build' });
  }
}

function compose(args, env = {}) {
  run('docker', ['compose', ...ciCompose, ...args], { env: { ...ciEnv, ...env }, label: `Docker Compose ${args.join(' ')}` });
}

function ensureSqlxCli() {
  const probe = spawnSync('cargo', ['sqlx', '--version'], { cwd: join(root, 'apps/api'), stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  if (probe.status === 0) return;
  run('cargo', ['install', 'sqlx-cli', '--no-default-features', '--features', 'postgres', '--locked'], { cwd: join(root, 'apps/api'), label: 'Install sqlx-cli' });
}

function ciChecks() {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { compose(['down', '--volumes', '--remove-orphans']); } catch { /* Preserve the original failure. */ }
  };
  process.once('exit', cleanup);
  try {
    Object.assign(process.env, ciEnv);
    ensureSqlxCli();
    compose(['up', '-d', '--wait', 'timescaledb', 'redis']);
    runWithRetries('cargo', ['sqlx', 'migrate', 'run'], {
      cwd: join(root, 'apps/api'),
      env: ciEnv,
      label: 'SQLx migrations',
      attempts: 5,
      retryDelayMs: 2_000,
    });
    commonChecks({ includeInstall: true, includeBuild: true, apiTests: 'none', env: ciEnv });
    run('cargo', ['sqlx', 'prepare', '--check', '--workspace', '--', '--all-targets', '--all-features'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'SQLx offline metadata' });
    run('cargo', ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Clippy' });
    run('cargo', ['test', '--all', '--all-features'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Database-backed API tests' });
    run('cargo', ['test', '--lib', 'db::migrations::tests::valid_public_ledger_removes_empty_legacy_ledger', '--', '--ignored', '--exact', '--test-threads=1'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Disposable migration ledger repair' });
    console.log('\nLocal CI parity gate passed.');
  } finally {
    cleanup();
  }
}

function hasPullRequest() {
  const result = spawnSync(commandName('gh'), ['pr', 'view', '--json', 'number'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  return result.status === 0;
}

function hookMode(kind) {
  const branch = git(['branch', '--show-current']);
  if (process.env.SKIP_LOCAL_CI === '1') {
    console.warn('SKIP_LOCAL_CI=1: local verification bypassed.');
    return;
  }
  const full = branch === 'main' || (kind === 'pre-push' && hasPullRequest());
  if (full) ciChecks();
  else commonChecks({ includeInstall: false, includeBuild: false });
}

function installHooks() {
  mkdirSync(hookPath, { recursive: true });
  run('git', ['config', 'core.hooksPath', '.githooks'], { label: 'Install repository Git hooks' });
  console.log('Hooks installed. Commits on main and pushes for existing PRs use the full CI gate.');
}

function uninstallHooks() {
  run('git', ['config', '--unset', 'core.hooksPath']);
  console.log('Repository Git hooks disabled.');
}

function createPr(args) {
  ciChecks();
  run('gh', ['pr', 'create', ...args], { label: 'Create GitHub pull request' });
}

const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === 'local') commonChecks({ includeInstall: true, includeBuild: false, apiTests: 'lib' });
  else if (mode === 'ci') ciChecks();
  else if (mode === 'install-hooks') installHooks();
  else if (mode === 'uninstall-hooks') uninstallHooks();
  else if (mode === 'create-pr') createPr(args);
  else if (mode === 'hook') hookMode(args[0] ?? 'pre-commit');
  else throw new Error('Usage: local | ci | install-hooks | uninstall-hooks | create-pr | hook pre-commit|pre-push');
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
