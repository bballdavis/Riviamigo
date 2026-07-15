import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'apps/api');
const mode = process.argv[2];
const isWindows = process.platform === 'win32';

if (!['migrate', 'reset'].includes(mode)) {
  throw new Error('Usage: node scripts/database.mjs <migrate|reset>');
}

const commands = mode === 'reset'
  ? [['database', 'drop'], ['database', 'create'], ['migrate', 'run']]
  : [['migrate', 'run']];

for (const args of commands) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('sqlx', args, {
      cwd: apiDir,
      env: { ...process.env, PGOPTIONS: '-c search_path=public' },
      stdio: 'inherit',
      shell: isWindows,
      windowsHide: true,
    });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`sqlx ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}
