import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const scriptPath = resolve(scriptDir, 'dev.sh');

function findBash() {
  if (process.platform !== 'win32') {
    return 'bash';
  }

  const candidates = [
    process.env.BASH,
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/usr/bin/bash.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const bash = findBash();

if (!bash) {
  console.error('Unable to find bash. Install Git Bash or set the BASH environment variable, then retry pnpm run dev:stack.');
  process.exit(1);
}

const child = spawn(bash, [scriptPath], {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 1);
});