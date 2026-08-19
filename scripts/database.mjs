import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertLocalDatabaseResetAllowed } from './lib/database-reset-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'apps/api');
const mode = process.argv[2];
const isWindows = process.platform === 'win32';

if (!['migrate', 'reset'].includes(mode)) {
  throw new Error('Usage: node scripts/database.mjs <migrate|reset> [--yes]');
}

if (mode === 'reset') {
  const target = assertLocalDatabaseResetAllowed({
    args: process.argv.slice(3),
    env: process.env,
  });
  console.warn(
    `Resetting explicitly acknowledged local database ${target.database} at ${target.host}:${target.port}.`
  );
}

const commands = mode === 'reset'
  ? [
      { command: 'sqlx', args: ['database', 'drop', '-y'] },
      { command: 'sqlx', args: ['database', 'create'] },
      { command: 'cargo', args: ['run', '--bin', 'riviamigo-migrate'] },
    ]
  : [{ command: 'cargo', args: ['run', '--bin', 'riviamigo-migrate'] }];

for (const { command, args } of commands) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: apiDir,
      env: {
        ...process.env,
        PGOPTIONS: '-c search_path=public',
        ...(command === 'cargo' ? { SQLX_OFFLINE: 'true' } : {}),
      },
      stdio: 'inherit',
      shell: isWindows,
      windowsHide: true,
    });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}
