import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riviamigo-compose-check-'));
const environmentFile = path.join(temporaryRoot, '.env');
const dataRoot = path.join(temporaryRoot, 'data').replaceAll('\\', '/');

writeFileSync(
  environmentFile,
  [
    'POSTGRES_PASSWORD=compose-check-database-password',
    'REDIS_PASSWORD=compose-check-redis-password',
    'ALLOWED_ORIGINS=https://riviamigo.example.net',
    'RIVIAMIGO_ENV_FILE=' + environmentFile.replaceAll('\\', '/'),
    'RIVIAMIGO_DATA_DIR=' + dataRoot,
    'RIVIAMIGO_ORIGIN_PORT=18080',
    'RIVIAMIGO_HOST_BIND_ADDRESS=0.0.0.0',
    'ALLOW_INSECURE_LAN_HTTP_AUTH=false',
    'TZ=UTC',
    '',
  ].join('\n'),
  'utf8'
);

try {
  for (const composeFile of ['compose/docker-compose.yml']) {
    execFileSync(
      'docker',
      ['compose', '--env-file', environmentFile, '-f', composeFile, 'config', '--quiet'],
      { cwd: root, stdio: 'inherit' }
    );
    console.log(`Rendered ${composeFile}`);
  }
  console.log('compose:render-check passed');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
