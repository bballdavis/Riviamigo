import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const apiDir = resolve(rootDir, 'apps/api');
const webDir = resolve(rootDir, 'apps/web');
const composeFile = resolve(rootDir, 'infra/docker-compose.yml');
const isWindows = process.platform === 'win32';

const ports = {
  api: 3001,
  web: 5173,
};

const urls = {
  apiHealth: `http://localhost:${ports.api}/health`,
  web: `http://localhost:${ports.web}`,
};

const runOnce = process.argv.includes('--once');
const children = new Set();
let shuttingDown = false;

function log(message = '') {
  console.log(message);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
    shell: options.shell ?? false,
    windowsHide: true,
  });

  if (options.track !== false) {
    children.add(child);
    child.once('exit', () => children.delete(child));
  }

  return child;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawnProcess(command, args, { ...options, track: false });

    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectRun(new Error(`${command} ${args.join(' ')} failed with ${suffix}`));
    });
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolveCapture, rejectCapture) => {
    let stdout = '';
    let stderr = '';
    const child = spawnProcess(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      track: false,
    });

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', rejectCapture);
    child.once('exit', (code) => {
      resolveCapture({ code, stdout, stderr });
    });
  });
}

async function commandExists(command) {
  const checker = isWindows ? 'where' : 'command';
  const args = isWindows ? [command] : ['-v', command];
  const { code } = await capture(checker, args, { shell: !isWindows });
  return code === 0;
}

async function requireTools() {
  for (const tool of ['pnpm', 'docker', 'curl']) {
    if (!(await commandExists(tool))) {
      throw new Error(`Missing required tool: ${tool}`);
    }
  }
}

async function installDependencies() {
  log('Installing workspace dependencies...');
  try {
    await run('pnpm', ['install', '--frozen-lockfile'], { shell: isWindows });
  } catch (error) {
    log('Lockfile needed an update; retrying install without frozen lockfile.');
    await run('pnpm', ['install', '--no-frozen-lockfile'], { shell: isWindows });
  }
}

async function getListeningPids(port) {
  if (isWindows) {
    const command = [
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
      'Select-Object -ExpandProperty OwningProcess -Unique',
    ].join(' | ');
    const { stdout } = await capture('powershell.exe', ['-NoProfile', '-Command', command], {
      shell: false,
    });
    return parsePids(stdout);
  }

  const lsof = await capture('lsof', ['-ti', `tcp:${port}`], { shell: false });
  if (lsof.code === 0) {
    return parsePids(lsof.stdout);
  }

  const ss = await capture('sh', ['-c', `ss -ltnp 'sport = :${port}' 2>/dev/null | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p' | sort -u`], {
    shell: false,
  });
  return parsePids(ss.stdout);
}

function parsePids(output) {
  return [
    ...new Set(
      output
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid),
    ),
  ];
}

async function killPid(pid) {
  if (isWindows) {
    await capture('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: false });
    await capture('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], {
      shell: false,
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
}

function runWithInput(command, args, input, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawnProcess(command, args, {
      ...options,
      stdio: ['pipe', 'inherit', 'inherit'],
      track: false,
    });

    child.stdin.end(input);
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectRun(new Error(`${command} ${args.join(' ')} failed with ${suffix}`));
    });
  });
}

async function ensurePortFree(port, label) {
  let pids = await getListeningPids(port);
  if (pids.length === 0) {
    return;
  }

  log(`Stopping stale ${label} process on port ${port}: ${pids.join(', ')}`);
  for (const pid of pids) {
    await killPid(pid);
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    pids = await getListeningPids(port);
    if (pids.length === 0) {
      return;
    }
    await sleep(250);
  }

  throw new Error(`Could not free port ${port} for ${label}; still owned by PID(s): ${pids.join(', ')}`);
}

async function waitForHttp(url, child, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited before it became ready.`);
    }

    const { code } = await capture('curl', ['-fsS', '--max-time', '2', url]);
    if (code === 0) {
      if (child && child.exitCode !== null) {
        throw new Error(`${label} health check was answered by another process; the managed process exited.`);
      }
      return;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

async function startInfrastructure() {
  log('Starting infrastructure (TimescaleDB, Redis, Garage)...');
  await run('docker', ['compose', '-f', composeFile, 'up', '-d', 'timescaledb', 'redis', 'garage']);

  const deadline = Date.now() + 60000;
  let dbReady = false;
  while (Date.now() < deadline) {
    const { code } = await capture('docker', ['compose', '-f', composeFile, 'exec', '-T', 'timescaledb', 'pg_isready', '-U', 'riviamigo']);
    if (code === 0) {
      dbReady = true;
      break;
    }
    await sleep(1000);
  }

  if (!dbReady) {
    throw new Error('Timed out waiting for TimescaleDB to accept connections.');
  }

  log('');
  log('Infrastructure is running');
  log('   TimescaleDB: postgresql://localhost:5432');
  log('   Redis: redis://localhost:6379');
  log('   S3 (Garage): http://localhost:3900');
  log('');
}

async function migrationPresent(sentinelSql) {
  const sql = `SELECT CASE WHEN ${sentinelSql} IS NULL THEN 'missing' ELSE 'present' END`;
  const result = await capture('docker', [
    'compose',
    '-f',
    composeFile,
    'exec',
    '-T',
    'timescaledb',
    'psql',
    '-U',
    'riviamigo',
    '-d',
    'riviamigo',
    '-Atqc',
    sql,
  ]);
  return result.code === 0 && result.stdout.trim() === 'present';
}

async function applyMigrationIfMissing(sentinelSql, migrationFile, migrationName) {
  if (await migrationPresent(sentinelSql)) {
    log(`${migrationName} already applied`);
    return;
  }

  if (!existsSync(migrationFile)) {
    throw new Error(`Missing migration file: ${migrationFile}`);
  }

  log(`Applying ${migrationName}...`);
  await runWithInput(
    'docker',
    ['compose', '-f', composeFile, 'exec', '-T', 'timescaledb', 'psql', '-U', 'riviamigo', '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    readFileSync(migrationFile),
  );
}

async function ensureSchema() {
  log('Ensuring database schema is initialized...');
  await applyMigrationIfMissing(
    "to_regclass('riviamigo.users')",
    resolve(apiDir, 'migrations/0001_schema_init.sql'),
    '0001_schema_init.sql',
  );
  await applyMigrationIfMissing(
    "to_regclass('riviamigo.battery_capacity_snapshots')",
    resolve(apiDir, 'migrations/0002_metrics_expansion.sql'),
    '0002_metrics_expansion.sql',
  );
  log('');
}

async function startApi() {
  await ensurePortFree(ports.api, 'API');

  log('Building API...');
  await run('cargo', ['build'], { cwd: apiDir });

  log('Starting API...');
  const apiBin = resolve(apiDir, 'target/debug', isWindows ? 'riviamigo-api.exe' : 'riviamigo-api');
  const api = spawnProcess(apiBin, [], {
    cwd: apiDir,
    env: {
      DATABASE_URL: 'postgresql://riviamigo:devpassword@localhost:5432/riviamigo',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:3900',
      S3_ACCESS_KEY: 'GKdeadbeef0000000000000000000000',
      S3_SECRET_KEY: 'deadbeef0000000000000000000000000000000000000000000000000000cafe',
      PORT: String(ports.api),
      ALLOWED_ORIGINS: `http://localhost:${ports.web}`,
    },
  });

  await waitForHttp(urls.apiHealth, api, 'API');
  log(`API is responding at ${urls.apiHealth}`);
  return api;
}

async function startWeb() {
  await ensurePortFree(ports.web, 'web');

  log('Starting web dev server...');
  const viteBin = resolve(webDir, 'node_modules/.bin', isWindows ? 'vite.cmd' : 'vite');
  const web = spawnProcess(viteBin, ['--strictPort', '--port', String(ports.web)], {
    cwd: webDir,
    shell: isWindows,
  });

  await waitForHttp(urls.web, web, 'web dev server');
  log(`Web dev server is responding at ${urls.web}`);
  return web;
}

async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of [...children]) {
    if (child.exitCode === null && !child.killed) {
      child.kill(isWindows ? undefined : 'SIGTERM');
    }
  }

  await Promise.all([ensurePortFree(ports.web, 'web').catch(() => {}), ensurePortFree(ports.api, 'API').catch(() => {})]);
  process.exit(code);
}

async function main() {
  process.env.COMPOSE_PROJECT_NAME = 'riviamigo';

  log('Starting Riviamigo development stack...');
  log('');

  await requireTools();
  await installDependencies();
  await startInfrastructure();
  await ensureSchema();

  log('Starting local dev servers...');
  log(`   API:  ${urls.apiHealth.replace('/health', '')}`);
  log(`   Web:  ${urls.web}`);
  log('');

  const api = await startApi();
  log('To view infra logs in another terminal, run:');
  log(`   docker compose -f "${composeFile}" logs -f`);
  log('');
  const web = await startWeb();

  if (runOnce) {
    log('Startup smoke test passed; shutting down managed dev servers.');
    await shutdown(0);
    return;
  }

  await Promise.race([
    onceExit(api, 'API'),
    onceExit(web, 'Web dev server'),
  ]);
}

function onceExit(child, label) {
  return new Promise((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(new Error(`${label} exited unexpectedly (${signal ?? `exit code ${code}`}).`));
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal === 'SIGINT' ? 130 : 143);
  });
}

main().catch(async (error) => {
  console.error(error.message);
  await shutdown(1);
});
