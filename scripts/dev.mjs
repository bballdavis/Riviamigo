import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const apiDir = resolve(rootDir, 'apps/api');
const webDir = resolve(rootDir, 'apps/web');
const composeFile = resolve(rootDir, 'compose/docker-compose.dev.yml');
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
    ALLOWED_ORIGINS: webOrigins().join(','),    // Dev stack is served over http://localhost (and often LAN IPs), so
    // refresh cookies must not be marked Secure or browser reload will drop
    // session continuity and trigger repeated 401/WS reconnect churn.
    COOKIE_INSECURE: '1',
  };
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
