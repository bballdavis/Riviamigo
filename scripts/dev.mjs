import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const apiDir = resolve(rootDir, 'apps/api');
const webDir = resolve(rootDir, 'apps/web');
const composeFile = resolve(rootDir, 'compose/docker-compose.yml');
const isWindows = process.platform === 'win32';

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

const requestedPorts = {
  api: parsePort(process.env.DEV_API_PORT, 3001),
  web: parsePort(process.env.DEV_WEB_PORT, 5173),
  postgres: parsePort(process.env.DEV_POSTGRES_PORT, 5432),
  redis: parsePort(process.env.DEV_REDIS_PORT, 6379),
  garageApi: parsePort(process.env.DEV_GARAGE_PORT, 3900),
  garageAdmin: parsePort(process.env.DEV_GARAGE_ADMIN_PORT, 3903),
};

let ports = { ...requestedPorts };
const composeProjectName = process.env.DEV_COMPOSE_PROJECT_NAME || process.env.COMPOSE_PROJECT_NAME || 'riviamigo';

const urls = {
  get apiHealth() {
    return `http://localhost:${ports.api}/health`;
  },
  get web() {
    return `http://localhost:${ports.web}`;
  },
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

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function webOrigins() {
  return Array.from({ length: 11 }, (_, index) => `http://localhost:${ports.web + index}`);
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

function apiEnv() {
  return {
    DATABASE_URL: `postgresql://riviamigo:devpassword@localhost:${ports.postgres}/riviamigo?options=-c%20search_path%3Driviamigo,timeseries,public`,
    REDIS_URL: `redis://localhost:${ports.redis}`,
    S3_ENDPOINT: `http://localhost:${ports.garageApi}`,
    S3_ACCESS_KEY: 'GKdeadbeef0000000000000000000000',
    S3_SECRET_KEY: 'deadbeef0000000000000000000000000000000000000000000000000000cafe',
    PORT: String(ports.api),
    ALLOWED_ORIGINS: webOrigins().join(','),
    RIVIAMIGO_SKIP_SQLX_MIGRATIONS: '1',
    // Dev stack is served over http://localhost (and often LAN IPs), so
    // refresh cookies must not be marked Secure or browser reload will drop
    // session continuity and trigger repeated 401/WS reconnect churn.
    COOKIE_INSECURE: '1',
  };
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

async function findAvailablePort(start, label, maxTries = 50) {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const candidate = start + attempt;
    const pids = await getListeningPids(candidate);
    if (pids.length === 0) {
      if (attempt > 0) {
        log(`[dev] ${label} port ${start} was busy, using ${candidate}`);
      }
      return candidate;
    }

    log(`[dev] ${label} port ${candidate} is in use; trying ${candidate + 1}`);
  }

  throw new Error(`[dev] Could not find an available ${label} port after ${maxTries} attempts from ${start}.`);
}

async function allocateRuntimePorts() {
  const [api, web, postgres, redis, garageApi, garageAdmin] = await Promise.all([
    findAvailablePort(requestedPorts.api, 'API'),
    findAvailablePort(requestedPorts.web, 'Web'),
    findAvailablePort(requestedPorts.postgres, 'PostgreSQL'),
    findAvailablePort(requestedPorts.redis, 'Redis'),
    findAvailablePort(requestedPorts.garageApi, 'Garage API'),
    findAvailablePort(requestedPorts.garageAdmin, 'Garage admin'),
  ]);

  ports = {
    api,
    web,
    postgres,
    redis,
    garageApi,
    garageAdmin,
  };

  process.env.DEV_API_PORT = String(api);
  process.env.DEV_WEB_PORT = String(web);
  process.env.DEV_POSTGRES_PORT = String(postgres);
  process.env.DEV_REDIS_PORT = String(redis);
  process.env.DEV_GARAGE_PORT = String(garageApi);
  process.env.DEV_GARAGE_ADMIN_PORT = String(garageAdmin);
  process.env.DEV_WEB_ORIGINS = webOrigins().join(',');
  process.env.COMPOSE_PROJECT_NAME = composeProjectName;
}

async function assertPortAvailable(port, label) {
  const pids = await getListeningPids(port);
  if (pids.length > 0) {
    throw new Error(`${label} port ${port} became occupied before startup by PID(s): ${pids.join(', ')}`);
  }
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
  log(`Starting infrastructure (TimescaleDB, Redis, Garage) for ${composeProjectName}...`);
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
  log(`   TimescaleDB: postgresql://localhost:${ports.postgres}`);
  log(`   Redis: redis://localhost:${ports.redis}`);
  log(`   S3 (Garage): http://localhost:${ports.garageApi}`);
  log('');
}

async function migrationPresent(sentinelSql) {
  if (!sentinelSql) {
    return false;
  }

  const sql = `SET search_path TO riviamigo, timeseries, public; ${sentinelSql}`;
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

function deriveMigrationSentinel(migrationSql, migrationName) {
  if (!migrationSql) {
    throw new Error(`Could not read migration sql for ${migrationName}`);
  }

  const sql = migrationSql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*(?=\r?\n|$)/g, '')
    .replace(/\r/g, '')
    .trim();

  const patterns = [
    {
      name: 'create-table-if-not-exists',
      re: /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_"][A-Za-z0-9_".]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN to_regclass('${value.replace(/'/g, "''")}') IS NOT NULL THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-table',
      re: /CREATE\s+TABLE\s+([A-Za-z_"][A-Za-z0-9_".]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN to_regclass('${value.replace(/'/g, "''")}') IS NOT NULL THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-materialized-view',
      re: /CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][A-Za-z0-9_".]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN to_regclass('${value.replace(/'/g, "''")}') IS NOT NULL THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-view',
      re: /CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][A-Za-z0-9_".]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN to_regclass('${value.replace(/'/g, "''")}') IS NOT NULL THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-type',
      re: /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][A-Za-z0-9_".]*)/i,
      asSentinel: (value) => {
        const parts = value.replace(/"/g, '').split('.');
        const schema = parts.length === 2 ? parts[0] : 'public';
        const typeName = parts[parts.length - 1];
        return `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_type pt JOIN pg_namespace pn ON pn.oid = pt.typnamespace WHERE pt.typname='${typeName.replace(/'/g, "''")}' AND pn.nspname='${schema.replace(/'/g, "''")}') THEN 'present' ELSE 'missing' END`;
      },
    },
    {
      name: 'create-schema',
      re: /CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_"]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='${value.replace(/"/g, '').replace(/'/g, "''")}') THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-extension',
      re: /CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname='${value.replace(/'/g, "''")}') THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-index',
      re: /CREATE\s+(?:UNIQUE\s+)?(?:CONCURRENTLY\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_"][A-Za-z0-9_"]*)/i,
      asSentinel: (value) => `SELECT CASE WHEN to_regclass('${value.replace(/"/g, '').replace(/'/g, "''")}') IS NOT NULL THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'create-hypertable',
      re: /create_hypertable\(\s*'([^']+)'/i,
      asSentinel: (value) => `SELECT CASE WHEN to_regclass('${value.replace(/'/g, "''")}') IS NOT NULL THEN 'present' ELSE 'missing' END`,
    },
    {
      name: 'add-column',
      re: /ALTER\s+TABLE\s+([A-Za-z_"][A-Za-z0-9_".]*)\s+ADD\s+(?:COLUMN\s+IF\s+NOT\s+EXISTS\s+|COLUMN\s+|(?=ADD\s+CONSTRAINT))([A-Za-z_"][A-Za-z0-9_]*)/i,
      asSentinel: (match) => {
        const table = match[1].replace(/"/g, '').split('.');
        const schema = table.length === 2 ? table[0] : 'riviamigo';
        const tableName = table[table.length - 1];
        const columnName = match[2];
        return `SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='${schema.replace(/'/g, "''")}' AND table_name='${tableName.replace(/'/g, "''")}' AND column_name='${columnName.replace(/'/g, "''")}') THEN 'present' ELSE 'missing' END`;
      },
    },
    {
      name: 'add-constraint',
      re: /ALTER\s+TABLE\s+([A-Za-z_"][A-Za-z0-9_".]*)\s+ADD\s+CONSTRAINT\s+([A-Za-z_"][A-Za-z0-9_]*)/i,
      asSentinel: (match) => {
        const table = match[1].replace(/"/g, '').split('.');
        const schema = table.length === 2 ? table[0] : 'riviamigo';
        const tableName = table[table.length - 1];
        const constraintName = match[2];
        return `SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema='${schema.replace(/'/g, "''")}' AND table_name='${tableName.replace(/'/g, "''")}' AND constraint_name='${constraintName.replace(/'/g, "''")}') THEN 'present' ELSE 'missing' END`;
      },
    },
  ];

  for (const pattern of patterns) {
    const match = sql.match(pattern.re);
    if (match) {
      if (pattern.name.includes('constraint') || pattern.name.includes('column')) {
        return pattern.asSentinel(match);
      }
      return pattern.asSentinel(match[1]);
    }
  }

  if (migrationName === '0019_dashboard_config_v2.sql') {
    return "SELECT CASE WHEN EXISTS (SELECT 1 FROM riviamigo.dashboards WHERE (config::jsonb->>'schemaVersion') IS DISTINCT FROM '2') THEN 'missing' ELSE 'present' END";
  }

  return null;
}

async function applyMigrationIfMissing(sentinelSql, migrationFile, migrationName, migrationSql) {
  if (await migrationPresent(sentinelSql)) {
    log(`${migrationName} already applied`);
    return;
  }

  if (!existsSync(migrationFile)) {
    throw new Error(`Missing migration file: ${migrationFile}`);
  }

  log(`Applying ${migrationName}...`);
  const migrationContent = migrationSql
    ? Buffer.from(migrationSql)
    : readFileSync(migrationFile);
  const migrationPayload = Buffer.concat([
    Buffer.from('SET search_path TO riviamigo, timeseries, public;\n'),
    migrationContent,
  ]);
  await runWithInput(
    'docker',
    ['compose', '-f', composeFile, 'exec', '-T', 'timescaledb', 'psql', '-U', 'riviamigo', '-d', 'riviamigo', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    migrationPayload,
  );
}

async function ensureSchema() {
  log('Ensuring database schema is initialized...');
  const migrationsDir = resolve(apiDir, 'migrations');
  const migrationFiles = readdirSync(migrationsDir).filter((fileName) => /^\d{4}_.*\.sql$/.test(fileName)).sort();

  for (const migrationName of migrationFiles) {
    const migrationFile = resolve(migrationsDir, migrationName);
    const migrationSql = readFileSync(migrationFile, 'utf8');
    const sentinelSql = deriveMigrationSentinel(migrationSql, migrationName);
    if (!sentinelSql) {
      log(`${migrationName} has no reliable schema-sentinel; applying defensively.`);
    }

    await applyMigrationIfMissing(sentinelSql, migrationFile, migrationName, migrationSql);
  }

  log('');
}

function extractViteLocalUrl(output) {
  const cleaned = stripAnsi(output);

  const localMatch = cleaned.match(/Local:\s+https?:\/\/localhost:(\d+)(?:\/|$)/i);
  if (localMatch) {
    return `http://localhost:${localMatch[1]}`;
  }

  const genericMatch = cleaned.match(/http:\/\/localhost:(\d+)(?:\/|$)/i);
  if (genericMatch) {
    return `http://localhost:${genericMatch[1]}`;
  }

  return null;
}

async function waitForViteUrl(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let output = '';

  return new Promise((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      clearInterval(timer);
    };

    const settle = (fn, value) => {
      cleanup();
      fn(value);
    };

    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      const url = extractViteLocalUrl(output);
      if (url) {
        settle(resolvePromise, url);
      }
    };

    const onExit = (code, signal) => {
      settle(
        rejectPromise,
        new Error(`web dev server exited before announcing a URL (${signal ? `signal ${signal}` : `exit code ${code}`}).`),
      );
    };

    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        child.kill(isWindows ? undefined : 'SIGTERM');
        settle(rejectPromise, new Error('Timed out waiting for Vite to announce a local URL.'));
      }
    }, 250);

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
  });
}

async function startApi() {
  await assertPortAvailable(ports.api, 'API');

  log('Building API...');
  await run('cargo', ['build'], { cwd: apiDir, env: apiEnv() });

  return launchApi();
}

async function launchApi() {
  await assertPortAvailable(ports.api, 'API');

  log('Starting API...');
  const apiBin = resolve(apiDir, 'target/debug', isWindows ? 'riviamigo-api.exe' : 'riviamigo-api');
  const api = spawnProcess(apiBin, [], {
    cwd: apiDir,
    env: apiEnv(),
  });

  await waitForHttp(urls.apiHealth, api, 'API');
  log(`API is responding at ${urls.apiHealth}`);
  return api;
}

async function superviseApi(api) {
  let currentApi = api;

  while (!shuttingDown) {
    try {
      await onceExit(currentApi, 'API');
      return;
    } catch (error) {
      if (shuttingDown) {
        return;
      }

      log(`${error.message}`);
      log('Restarting API...');

      try {
        currentApi = await launchApi();
      } catch (restartError) {
        throw new Error(`API restart failed: ${restartError.message}`);
      }
    }
  }
}

async function startWeb() {
  log('Starting web dev server...');
  const viteBin = resolve(webDir, 'node_modules/.bin', isWindows ? 'vite.cmd' : 'vite');
  const web = spawnProcess(viteBin, ['--port', String(ports.web)], {
    cwd: webDir,
    env: {
      // Route websocket traffic directly to the API in dev so refresh/reconnect
      // churn does not flow through Vite's ws proxy error path.
      VITE_WS_URL: process.env.VITE_WS_URL ?? `http://localhost:${ports.api}`,
      VITE_API_URL: process.env.VITE_API_URL ?? `http://localhost:${ports.api}`,
      VITE_RIVIAMIGO_API_BASE_URL: process.env.VITE_RIVIAMIGO_API_BASE_URL ?? `http://localhost:${ports.api}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
  });

  web.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  web.stderr?.on('data', (chunk) => process.stderr.write(chunk));

  const webUrl = await waitForViteUrl(web);
  await waitForHttp(webUrl, web, 'web dev server');
  log(`Web dev server is responding at ${webUrl}`);
  return { child: web, url: webUrl };
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

  process.exit(code);
}

async function main() {
  log('Starting Riviamigo development stack...');
  log('');

  await requireTools();
  await installDependencies();
  await allocateRuntimePorts();
  await startInfrastructure();
  await ensureSchema();

  log('Starting local dev servers...');
  log(`   API:  ${urls.apiHealth.replace('/health', '')}`);
  log(`   Web:  ${urls.web} (will advance if blocked)`);
  log('');

  const api = await startApi();
  const apiSupervisor = superviseApi(api);
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
    apiSupervisor,
    onceExit(web.child, 'Web dev server'),
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
