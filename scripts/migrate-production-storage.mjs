#!/usr/bin/env node
/** Copy legacy production named volumes into the host-visible ./data layout. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const project = value('--project', 'riviamigo');
const dataRoot = resolve(value('--data-dir', resolve(root, 'data')));
const helperImage = 'busybox:1.36';

const mappings = [
  { suffix: 'pgdata', destination: 'db', required: true },
  { suffix: 'redisdata', destination: 'redis' },
  { suffix: 'vehicle_image_cache', destination: 'cache/riviamigo/vehicle-images' },
  { suffix: 'backup_artifacts', destination: 'backups' },
];

function capture(command, commandArgs) {
  return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).trim();
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
}

function volumeExists(name) {
  try { capture('docker', ['volume', 'inspect', name]); return true; } catch { return false; }
}

for (const mapping of mappings) {
  const volume = `${project}_${mapping.suffix}`;
  if (!volumeExists(volume)) {
    if (mapping.required) throw new Error(`Required legacy volume does not exist: ${volume}`);
    console.log(`Skipping missing optional volume ${volume}.`);
    continue;
  }

  const attached = capture('docker', ['ps', '-q', '--filter', `volume=${volume}`]);
  if (attached) throw new Error(`Volume ${volume} is still attached to a running container. Stop the old stack first.`);

  const destination = resolve(dataRoot, mapping.destination);
  mkdirSync(destination, { recursive: true });
  if (existsSync(destination) && readdirSync(destination).length > 0) {
    throw new Error(`Destination must be empty before migration: ${destination}`);
  }

  run('docker', [
    'run', '--rm',
    '-v', `${volume}:/source:ro`,
    '-v', `${destination}:/target`,
    helperImage, 'sh', '-c', 'cp -a /source/. /target/',
  ]);

  const sourceCount = Number(capture('docker', [
    'run', '--rm', '-v', `${volume}:/source:ro`, helperImage,
    'sh', '-c', "find /source -type f | wc -l",
  ]));
  const destinationCount = Number(capture('docker', [
    'run', '--rm', '-v', `${destination}:/target:ro`, helperImage,
    'sh', '-c', "find /target -type f | wc -l",
  ]));
  if (sourceCount !== destinationCount) {
    throw new Error(`Verification failed for ${volume}: ${sourceCount} source files, ${destinationCount} copied files.`);
  }
  console.log(`Copied ${volume} to ${destination} (${destinationCount} files).`);
}

console.log('Storage migration completed. Legacy Docker volumes were retained for rollback.');
