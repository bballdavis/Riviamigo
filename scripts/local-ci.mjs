import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { colorTokenViolations } from './check-color-tokens.mjs';
import { ghPrCreateArgs, selectHookGate, selectPushBase } from './local-ci-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.CARGO_TARGET_DIR ??= join(root, 'apps/api/target-ci-local');
const hookPath = join(root, '.githooks');
const ciProject = 'riviamigo-ci-local';
const ciCompose = ['-p', ciProject, '-f', 'compose/docker-compose.dev.yml'];
const ciEnv = {
  DEV_POSTGRES_PORT: '55432',
  DEV_REDIS_PORT: '56379',
  DATABASE_URL: 'postgresql://riviamigo:devpassword@127.0.0.1:55432/riviamigo',
  REDIS_URL: 'redis://127.0.0.1:56379',
  RIVIAMIGO_ENV: 'development',
  // Each API integration test creates and migrates its own database. Unbounded
  // parallelism exhausts connection pools against the local Docker database
  // (PoolTimedOut during setup) even though the same tests pass on CI runners.
  RUST_TEST_THREADS: process.env.RUST_TEST_THREADS ?? '4',
};

/** Minimum `pg_dump` major version; Backend checks installs postgresql-client-18. */
const PG_CLIENT_MAJOR = 18;
/** Keg-only installs Homebrew does not link onto PATH. */
const PG_CLIENT_FALLBACK_DIRS = [
  '/opt/homebrew/opt/libpq/bin',
  '/opt/homebrew/opt/postgresql@18/bin',
  '/usr/local/opt/libpq/bin',
  '/usr/local/opt/postgresql@18/bin',
];

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

function colorTokenGuard() {
  const violations = colorTokenViolations(root);
  if (violations.length) {
    console.error('Color-token violations found:');
    for (const violation of violations) console.error(violation);
    throw new Error('Use design tokens instead of raw colors.');
  }
}

function hygiene() {
  const forbidden = git(['ls-files']).split(/\r?\n/).filter(Boolean).filter((path) =>
    /(^|\/)(\.codex|\.claude|node_modules|target|dist|coverage|\.turbo|\.playwright-cli)(\/|$)|(^|\/)(package-lock\.json|test_output\.txt)$|(^|\/)[^/]+\.tmp$/.test(path));
  if (forbidden.length) throw new Error(`Generated or local-only files are tracked:\n${forbidden.join('\n')}`);
  run('git', ['diff', '--check', 'HEAD'], { label: 'Repository whitespace check' });
}

/**
 * The Security workflow's gitleaks scan, over the same range it covers: the
 * commits this branch adds. Moving code re-adds its lines, so fixtures that
 * were allowed by path can surface here too.
 */
function secretScan({ required }) {
  const probe = spawnSync('gitleaks', ['version'], { stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  if (probe.status !== 0) {
    const message = 'gitleaks is not installed, so the Security workflow\'s secret scan cannot run locally (macOS: brew install gitleaks).';
    if (required) throw new Error(message);
    console.warn(`Skipping secret scan: ${message}`);
    return;
  }
  const base = pushBase();
  const range = base?.mergeBase ? `${base.mergeBase}..HEAD` : 'HEAD~1..HEAD';
  run('gitleaks', ['git', '--no-banner', '--redact', '--config', '.gitleaks.toml', '--log-opts', range, '.'], { label: `Secret scan (gitleaks, ${range})` });
}

function fastHookChecks() {
  hygiene();
  secretScan({ required: false });
  run('node', ['tools/migration-integrity.mjs'], { label: 'Migration integrity' });
}

function commonChecks({ includeInstall = false, includeBuild = false, apiTests = 'lib', env = {} } = {}) {
  if (includeInstall) run('pnpm', ['install', '--frozen-lockfile'], { label: 'Install locked dependencies' });
  hygiene();
  secretScan({ required: true });
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

function pgDumpMajor(pathValue) {
  const probe = spawnSync('pg_dump', ['--version'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: pathValue },
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  const major = probe.status === 0 ? Number.parseInt(/(\d+)(?:\.\d+)*/.exec(probe.stdout)?.[1] ?? '', 10) : Number.NaN;
  return Number.isInteger(major) ? major : null;
}

/**
 * The backup integration tests shell out to `pg_dump`/`pg_restore`; without them
 * backup readiness reports "pg_dump unavailable" and most backup tests fail.
 * Use a keg-only Homebrew client when one is installed, else stop with a clear
 * install hint instead of a wall of unrelated-looking test failures.
 */
function ensurePostgresClient() {
  const current = process.env.PATH ?? '';
  if ((pgDumpMajor(current) ?? 0) >= PG_CLIENT_MAJOR) return;
  for (const dir of PG_CLIENT_FALLBACK_DIRS) {
    if (!existsSync(join(dir, 'pg_dump'))) continue;
    const candidate = `${dir}${delimiter}${current}`;
    if ((pgDumpMajor(candidate) ?? 0) >= PG_CLIENT_MAJOR) {
      process.env.PATH = candidate;
      console.log(`Using PostgreSQL client tools from ${dir}`);
      return;
    }
  }
  throw new Error(
    `PostgreSQL ${PG_CLIENT_MAJOR}+ client tools (pg_dump, pg_restore) are required for the backup integration tests. `
      + 'On macOS: brew install libpq (Homebrew leaves it off PATH; this gate finds it). On Debian/Ubuntu: install postgresql-client-18.',
  );
}

function ensureSqlxCli() {
  const probe = spawnSync('cargo', ['sqlx', '--version'], { cwd: join(root, 'apps/api'), stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  if (probe.status === 0) return;
  run('cargo', ['install', 'sqlx-cli', '--no-default-features', '--features', 'postgres', '--locked'], { cwd: join(root, 'apps/api'), label: 'Install sqlx-cli' });
}

/**
 * Starts the isolated `riviamigo-ci-local` database and Redis (ports 55432 and
 * 56379, never the development project), applies migrations, runs `body`, and
 * always removes the containers and volumes afterwards.
 */
function withCiDatabase(body) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { compose(['down', '--volumes', '--remove-orphans']); } catch { /* Preserve the original failure. */ }
  };
  process.once('exit', cleanup);
  try {
    Object.assign(process.env, ciEnv);
    ensurePostgresClient();
    ensureSqlxCli();
    compose(['up', '-d', '--wait', 'timescaledb', 'redis']);
    runWithRetries('cargo', ['sqlx', 'migrate', 'run'], {
      cwd: join(root, 'apps/api'),
      env: ciEnv,
      label: 'SQLx migrations',
      attempts: 5,
      retryDelayMs: 2_000,
    });
    body();
  } finally {
    cleanup();
  }
}

/** The Backend checks workflow's Rust steps, against the isolated database. */
function apiDatabaseChecks() {
  run('cargo', ['fmt', '--all', '--check'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Rust format check' });
  run('cargo', ['sqlx', 'prepare', '--check', '--workspace', '--', '--all-targets', '--all-features'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'SQLx offline metadata' });
  run('cargo', ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Clippy' });
  run('cargo', ['test', '--all', '--all-features'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Database-backed API tests' });
}

function ciChecks() {
  withCiDatabase(() => {
    commonChecks({ includeInstall: true, includeBuild: true, apiTests: 'none', env: ciEnv });
    apiDatabaseChecks();
    run('cargo', ['test', '--lib', 'db::migrations::tests::valid_public_ledger_removes_empty_legacy_ledger', '--', '--ignored', '--exact', '--test-threads=1'], { cwd: join(root, 'apps/api'), env: ciEnv, label: 'Disposable migration ledger repair' });
    console.log('\nLocal CI parity gate passed.');
  });
}

/** The integration branch (and merge base) the current branch most likely targets. */
function pushBase() {
  const candidates = ['origin/dev', 'origin/main'].map((ref) => {
    const mergeBase = git(['merge-base', 'HEAD', ref]);
    const ahead = mergeBase ? Number.parseInt(git(['rev-list', '--count', `${mergeBase}..HEAD`]), 10) : Number.NaN;
    return { ref, mergeBase, aheadCount: Number.isInteger(ahead) ? ahead : null };
  });
  return selectPushBase(candidates);
}

/** Files the branch changes relative to the integration branch it most likely targets. */
function changedPathsForPush() {
  const base = pushBase();
  if (!base) return [];
  return git(['diff', '--name-only', `${base.mergeBase}...HEAD`]).split(/\r?\n/).filter(Boolean);
}

function hookMode(hook) {
  const changedPaths = hook === 'pre-push' ? changedPathsForPush() : [];
  const gate = selectHookGate(process.env, { hook, changedPaths });
  if (gate === 'bypass') {
    console.warn('SKIP_LOCAL_CI=1: local verification bypassed.');
    return;
  }
  if (gate === 'full') {
    ciChecks();
    return;
  }
  fastHookChecks();
  if (gate === 'api') {
    console.log('\nThis push changes apps/api, so the database-backed API checks run before it leaves (set SKIP_LOCAL_CI=1 to bypass in an emergency).');
    withCiDatabase(apiDatabaseChecks);
  }
}

function installHooks() {
  mkdirSync(hookPath, { recursive: true });
  run('git', ['config', 'core.hooksPath', '.githooks'], { label: 'Install repository Git hooks' });
  console.log('Hooks installed. Commits use the fast local gate; pushes that change apps/api also run the database-backed API checks. Set RIVIAMIGO_FULL_LOCAL_CI=1 for the full CI gate.');
}

function uninstallHooks() {
  run('git', ['config', '--unset', 'core.hooksPath']);
  console.log('Repository Git hooks disabled.');
}

function createPr(args) {
  ciChecks();
  run('gh', ['pr', 'create', ...ghPrCreateArgs(args)], { label: 'Create GitHub pull request' });
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
