import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateDistinctRuntimePorts,
  deriveDevComposeProjectName,
  developmentAuthEnv,
  buildWindowsProcessQuery,
  matchRepoOwnedProcesses,
  matchWindowsRepoOwnedProcesses,
  parseComposeIdentityMetadata,
  parseComposePortMetadata,
} from './dev.mjs';

test('uses the shared riviamigo Compose project by default', () => {
  assert.equal(deriveDevComposeProjectName('C:\\work\\Riviamigo', {}), 'riviamigo');
  assert.equal(deriveDevComposeProjectName('C:\\work\\Riviamigo-theme-system', {}), 'riviamigo');
});

test('honors explicit development and general Compose project overrides', () => {
  assert.equal(
    deriveDevComposeProjectName('C:\\work\\Riviamigo', {
      DEV_COMPOSE_PROJECT_NAME: 'charging-test',
      COMPOSE_PROJECT_NAME: 'general-test',
    }),
    'charging-test',
  );
  assert.equal(
    deriveDevComposeProjectName('C:\\work\\Riviamigo', { COMPOSE_PROJECT_NAME: 'general-test' }),
    'general-test',
  );
});

test('allocates distinct ports when service overrides collide', async () => {
  const probes = [];
  const allocated = await allocateDistinctRuntimePorts([
    { key: 'api', start: 3003, label: 'API' },
    { key: 'restoreAgent', start: 3003, label: 'Restore agent' },
    { key: 'web', start: 3003, label: 'Web' },
  ], async (start, label, _maxTries, reservedPorts) => {
    probes.push({ label, reserved: [...reservedPorts] });
    let candidate = start;
    while (reservedPorts.has(candidate)) candidate += 1;
    return candidate;
  });

  assert.deepEqual(allocated, { api: 3003, restoreAgent: 3004, web: 3005 });
  assert.deepEqual(probes, [
    { label: 'API', reserved: [] },
    { label: 'Restore agent', reserved: [3003] },
    { label: 'Web', reserved: [3003, 3004] },
  ]);
});

test('parses newline-delimited Compose publishers by service and target port', () => {
  const metadata = parseComposePortMetadata([
    JSON.stringify({ Service: 'timescaledb', State: 'running', Publishers: [{ TargetPort: 5432, PublishedPort: 15432 }] }),
    JSON.stringify({ Service: 'redis', State: 'exited', Publishers: [{ TargetPort: 6379, PublishedPort: 16379 }] }),
    JSON.stringify({ Service: 'garage', State: 'running', Publishers: [
      { TargetPort: 3900, PublishedPort: 13900 },
      { TargetPort: 3903, PublishedPort: 13903 },
    ] }),
  ].join('\n'));

  assert.deepEqual(metadata.get('timescaledb:5432'), { port: 15432, running: true });
  assert.deepEqual(metadata.get('redis:6379'), { port: 16379, running: false });
  assert.deepEqual(metadata.get('garage:3903'), { port: 13903, running: true });
});

test('accepts current development Compose identity from labels', () => {
  const output = [
    { Service: 'timescaledb', Labels: 'com.docker.compose.project.config_files=C:\\Work\\Riviamigo\\compose\\docker-compose.dev.yml,com.docker.compose.project.service=timescaledb' },
    { Service: 'redis', Labels: { 'com.docker.compose.project.config_files': 'C:\\Work\\Riviamigo\\compose\\docker-compose.dev.yml' } },
    { Service: 'garage', ConfigFiles: ['c:/work/riviamigo/compose/docker-compose.dev.yml'] },
  ].map(JSON.stringify).join('\n');

  const identity = parseComposeIdentityMetadata(output, 'C:/WORK/Riviamigo/compose/docker-compose.dev.yml');
  assert.equal(identity.valid, true);
  assert.deepEqual(identity.composeFiles, ['c:/work/riviamigo/compose/docker-compose.dev.yml']);
});

test('rejects a production and development Compose identity from Docker labels', () => {
  const output = JSON.stringify({
    Service: 'timescaledb',
    Labels: 'com.docker.compose.project.config_files=C:\\Work\\Riviamigo\\compose\\docker-compose.yml,C:\\Work\\Riviamigo\\compose\\docker-compose.dev.yml,com.docker.compose.project.service=timescaledb',
  });

  const identity = parseComposeIdentityMetadata(output, 'C:/WORK/Riviamigo/compose/docker-compose.dev.yml');
  assert.equal(identity.valid, false);
  assert.equal(identity.reason, 'production Compose config file');
});

test('rejects production-shaped and missing Compose identity metadata', () => {
  const expected = 'C:/work/Riviamigo/compose/docker-compose.dev.yml';
  const production = parseComposeIdentityMetadata(
    JSON.stringify({ Service: 'timescaledb', Labels: { 'com.docker.compose.project.config_files': 'C:/work/Riviamigo/compose/docker-compose.yml' } }),
    expected,
  );
  const missing = parseComposeIdentityMetadata(JSON.stringify({ Service: 'redis', State: 'running' }), expected);

  assert.equal(production.valid, false);
  assert.equal(production.reason, 'unexpected Compose config file');
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, 'missing identity metadata');
});

test('rejects mixed Compose identity metadata across existing records', () => {
  const output = [
    { Service: 'timescaledb', ConfigFiles: ['C:/work/Riviamigo/compose/docker-compose.dev.yml'] },
    { Service: 'redis', ConfigFiles: ['C:/work/Riviamigo/compose/docker-compose.dev.yml', 'C:/work/Riviamigo/compose/override.yml'] },
  ].map(JSON.stringify).join('\n');

  const identity = parseComposeIdentityMetadata(output, 'C:/work/Riviamigo/compose/docker-compose.dev.yml');
  assert.equal(identity.valid, false);
  assert.equal(identity.reason, 'mixed Compose config files');
});

test('reuses running shared infrastructure ports and reserves them from host ports', async () => {
  const probes = [];
  const allocated = await allocateDistinctRuntimePorts([
    { key: 'api', start: 15432, label: 'API' },
    { key: 'postgres', start: 5432, label: 'PostgreSQL' },
    { key: 'redis', start: 6379, label: 'Redis' },
    { key: 'garageApi', start: 3900, label: 'Garage API' },
    { key: 'garageAdmin', start: 3903, label: 'Garage admin' },
  ], async (start, label, _maxTries, reservedPorts) => {
    probes.push({ start, label, reserved: [...reservedPorts] });
    let candidate = start;
    while (reservedPorts.has(candidate)) candidate += 1;
    return candidate;
  }, new Map([
    ['postgres', 15432],
    ['redis', 16379],
    ['garageApi', 13900],
    ['garageAdmin', 13903],
  ]));

  assert.deepEqual(allocated, {
    api: 15433, postgres: 15432, redis: 16379, garageApi: 13900, garageAdmin: 13903,
  });
  assert.deepEqual(probes, [{ start: 15432, label: 'API', reserved: [15432, 16379, 13900, 13903] }]);
});

test('pins the development API to password login with SSO off', () => {
  const env = developmentAuthEnv();
  assert.equal(env.RIVIAMIGO_PASSWORD_LOGIN_ENABLED, 'true');
  assert.equal(env.RIVIAMIGO_OIDC_ENABLED, 'false');
  assert.equal(env.RIVIAMIGO_OIDC_AUTO_LOGIN, 'false');
});

test('blanks every other OIDC variable so inherited values cannot break startup', () => {
  const env = developmentAuthEnv();
  for (const key of [
    'RIVIAMIGO_OIDC_CLIENT_SECRET',
    'RIVIAMIGO_OIDC_CLIENT_SECRET_FILE',
    'RIVIAMIGO_OIDC_ISSUER_URL',
    'RIVIAMIGO_OIDC_CLIENT_ID',
  ]) {
    assert.equal(env[key], '', `${key} should be blanked`);
  }
  const oidcKeys = Object.keys(env).filter((key) => key.startsWith('RIVIAMIGO_OIDC_'));
  assert.ok(oidcKeys.length >= 14, 'covers the full OIDC variable set');
});

test('stop matches only this checkout\'s dev processes', () => {
  const root = '/work/Riviamigo';
  const ps = [
    `101 ${root}/apps/api/target/debug/riviamigo-api`,
    `102 ${root}/apps/api/target/debug/riviamigo-restore-agent`,
    `103 node ${root}/apps/web/node_modules/.bin/../vite/bin/vite.js --host`,
    '104 node /work/OtherApp/apps/web/node_modules/.bin/vite --port 43560',
    '105 node ./scripts/dev.mjs',
    '106 node ./scripts/dev.mjs --stop',
    '107 node /work/Riviamigo/scripts/dev.mjs --once',
    '108 node ./scripts/dev-harness.mjs',
  ].join('\n');
  const options = {
    apiBin: `${root}/apps/api/target/debug/riviamigo-api`,
    restoreAgentBin: `${root}/apps/api/target/debug/riviamigo-restore-agent`,
    webDir: `${root}/apps/web`,
    selfPid: 999,
  };

  assert.deepEqual(
    matchRepoOwnedProcesses(ps, options).map((entry) => [entry.pid, entry.kind]),
    [[101, 'api'], [102, 'restore-agent'], [103, 'vite']],
  );
  assert.deepEqual(
    matchRepoOwnedProcesses(ps, { ...options, launcher: `${root}/scripts/dev.mjs` })
      .map((entry) => [entry.pid, entry.kind]),
    [[101, 'api'], [102, 'restore-agent'], [103, 'vite'], [105, 'launcher'], [107, 'launcher']],
  );
  assert.deepEqual(matchRepoOwnedProcesses(ps, { ...options, selfPid: 101 }).map((entry) => entry.pid), [102, 103]);
});

const WINDOWS_ROOT = 'C:\\work\\Riviamigo';
const WINDOWS_OPTIONS = {
  apiBin: `${WINDOWS_ROOT}\\apps\\api\\target\\debug\\riviamigo-api.exe`,
  restoreAgentBin: `${WINDOWS_ROOT}\\apps\\api\\target\\debug\\riviamigo-restore-agent.exe`,
  webDir: `${WINDOWS_ROOT}\\apps\\web`,
  launcherScript: `${WINDOWS_ROOT}\\scripts\\dev.mjs`,
};

test('the Windows process query asks for launchers only when stop needs them', () => {
  const withLaunchers = buildWindowsProcessQuery({ ...WINDOWS_OPTIONS, includeLaunchers: true });
  const withoutLaunchers = buildWindowsProcessQuery({ ...WINDOWS_OPTIONS, includeLaunchers: false });

  assert.match(withLaunchers, /\$includeLaunchers = \$true/);
  assert.match(withoutLaunchers, /\$includeLaunchers = \$false/);
  // The PowerShell process running the query has the query text as its own
  // command line, so the query must not name the launcher script or it could match itself.
  assert.equal(withLaunchers.includes(WINDOWS_OPTIONS.launcherScript), false);
  assert.equal(withLaunchers.includes('scripts\\dev.mjs'), false);
  assert.match(withLaunchers, /\$_\.ProcessId -eq \$PID/);
});

test('Windows stop matches this checkout\'s launcher by absolute path or by its recorded PID', () => {
  const { launcherScript, apiBin, restoreAgentBin, webDir } = WINDOWS_OPTIONS;
  const rows = [
    { ProcessId: 101, Name: 'riviamigo-api.exe', ExecutablePath: apiBin, CommandLine: `"${apiBin}"` },
    { ProcessId: 102, Name: 'riviamigo-restore-agent.exe', ExecutablePath: restoreAgentBin, CommandLine: `"${restoreAgentBin}"` },
    { ProcessId: 103, Name: 'node.exe', ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe', CommandLine: `node ${webDir}\\node_modules\\vite\\bin\\vite.js --host` },
    { ProcessId: 201, Name: 'node.exe', CommandLine: `"C:\\Program Files\\nodejs\\node.exe" "${launcherScript}"` },
    { ProcessId: 202, Name: 'node.exe', CommandLine: `"C:\\Program Files\\nodejs\\node.exe" "${launcherScript}" --once` },
    { ProcessId: 203, Name: 'node.exe', CommandLine: 'node D:\\other\\Riviamigo\\scripts\\dev.mjs' },
    { ProcessId: 204, Name: 'node.exe', CommandLine: 'node ./scripts/dev.mjs --stop' },
    { ProcessId: 205, Name: 'node.exe', CommandLine: 'node ./scripts/dev.mjs' },
    { ProcessId: 206, Name: 'node.exe', CommandLine: 'node ./scripts/dev.mjs' },
    { ProcessId: 207, Name: 'powershell.exe', CommandLine: `powershell.exe -NoProfile -Command "$webDir = '${webDir}'; ... -match 'dev\\.mjs'"` },
    { ProcessId: 208, Name: 'node.exe', CommandLine: 'node ./scripts/dev-harness.mjs' },
  ];
  const options = { ...WINDOWS_OPTIONS, launcherPid: 205, selfPid: 999 };

  assert.deepEqual(
    matchWindowsRepoOwnedProcesses(rows, { ...options, includeLaunchers: true })
      .map((entry) => [entry.pid, entry.kind]),
    [[101, 'api'], [102, 'restore-agent'], [103, 'vite'], [201, 'launcher'], [202, 'launcher'], [205, 'launcher']],
  );
  assert.deepEqual(
    matchWindowsRepoOwnedProcesses(rows, { ...options, includeLaunchers: false })
      .map((entry) => [entry.pid, entry.kind]),
    [[101, 'api'], [102, 'restore-agent'], [103, 'vite']],
  );
  assert.deepEqual(
    matchWindowsRepoOwnedProcesses(rows, { ...options, includeLaunchers: true, launcherPid: null })
      .map((entry) => entry.pid),
    [101, 102, 103, 201, 202],
  );
});

test('Windows stop never takes a launcher that another checkout owns, even on a recorded PID', () => {
  const rows = [
    { ProcessId: 203, Name: 'node.exe', CommandLine: 'node D:\\other\\Riviamigo\\scripts\\dev.mjs' },
    { ProcessId: 303, Name: 'node.exe', CommandLine: '"C:\\Program Files\\nodejs\\node.exe" "D:\\other\\Riviamigo\\scripts\\dev.mjs"' },
  ];
  // A PID file left behind can outlive its launcher and be reused by another checkout's launcher.
  assert.deepEqual(
    matchWindowsRepoOwnedProcesses(rows, { ...WINDOWS_OPTIONS, includeLaunchers: true, launcherPid: 203, selfPid: 999 }),
    [],
  );
  assert.deepEqual(
    matchWindowsRepoOwnedProcesses(rows, { ...WINDOWS_OPTIONS, includeLaunchers: true, launcherPid: 303, selfPid: 999 }),
    [],
  );
});
