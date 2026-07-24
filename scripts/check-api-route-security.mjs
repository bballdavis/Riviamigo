import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routesDir = path.join(root, 'apps', 'api', 'src', 'routes');
const routerSource = fs.readFileSync(path.join(routesDir, 'mod.rs'), 'utf8');

const routeFiles = fs.readdirSync(routesDir)
  .filter((file) => file.endsWith('.rs') && file !== 'mod.rs')
  .map((file) => file.slice(0, -3));

const protectedModules = new Set(
  [...routerSource.matchAll(/\.merge\((\w+)::router\(\)\)/g)].map((match) => match[1]),
);
const metadataModules = new Set(
  [...routerSource.matchAll(/\.merge\((\w+)::metadata_router\(\)\)/g)].map((match) => match[1]),
);

const missing = [];
for (const module of routeFiles) {
  const source = fs.readFileSync(path.join(routesDir, `${module}.rs`), 'utf8');
  if (!source.includes('.route(')) continue;

  const covered = module === 'auth'
    ? routerSource.includes('.merge(auth::protected_router())') && routerSource.includes('.merge(auth::metadata_router())')
    : protectedModules.has(module);
  if (!covered) missing.push(module);
}

if (missing.length) {
  console.error(`API route modules are not mounted behind the protected router: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`API route security inventory passed for ${routeFiles.length} route modules.`);
