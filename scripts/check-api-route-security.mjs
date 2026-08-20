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

// This is intentionally a module-level authorization matrix: the router is
// assembled from route modules, and each module must declare the strongest
// policy family represented by its mounted routes. Endpoint-specific vehicle
// checks stay in the Rust handlers and are protected below by the deprecated
// helper ban.
const authorizationMatrix = new Map([
  ['api_keys', 'session_admin_or_vehicle_manager'],
  ['auth', 'public_metadata_and_session'],
  ['backfill', 'session_admin'],
  ['backups', 'session_admin'],
  ['battery', 'vehicle_read'],
  ['charging', 'vehicle_read_and_session_manager_mutation'],
  ['cost_profiles', 'session_vehicle_manager'],
  ['dashboards', 'session_vehicle_member'],
  ['efficiency', 'vehicle_read'],
  ['external_connections', 'session_admin'],
  ['grafana', 'vehicle_read'],
  ['health', 'vehicle_read'],
  ['idle_drain', 'vehicle_read'],
  ['live', 'vehicle_read'],
  ['locations', 'vehicle_read'],
  ['metrics', 'vehicle_read'],
  ['overview', 'vehicle_read'],
  ['parked_energy', 'vehicle_read'],
  ['places', 'session_vehicle_member'],
  ['rivian_stewardship', 'session_vehicle_manager'],
  ['schedules', 'session_vehicle_manager'],
  ['settings', 'session_admin'],
  ['state_timeline', 'vehicle_read'],
  ['trips', 'vehicle_read'],
  ['trip_tags', 'vehicle_read_and_manager_mutation'],
  ['users', 'session_admin'],
  ['vehicles', 'vehicle_read_and_session_mutation'],
]);

const missing = [];
const missingMatrixEntries = [];
const deprecatedOwnershipHelperUses = [];
for (const module of routeFiles) {
  const source = fs.readFileSync(path.join(routesDir, `${module}.rs`), 'utf8');
  if (!source.includes('.route(')) continue;

  const covered = module === 'auth'
    ? routerSource.includes('.merge(auth::protected_router())') && routerSource.includes('.merge(auth::metadata_router())')
    : protectedModules.has(module);
  if (!covered) missing.push(module);
  if (!authorizationMatrix.has(module)) missingMatrixEntries.push(module);
  if (source.includes('require_vehicle_owned')) deprecatedOwnershipHelperUses.push(module);
}

if (missing.length) {
  console.error(`API route modules are not mounted behind the protected router: ${missing.join(', ')}`);
  process.exit(1);
}

if (missingMatrixEntries.length) {
  console.error(
    `Mounted API route modules missing authorization-matrix entries: ${missingMatrixEntries.join(', ')}`,
  );
  process.exit(1);
}

if (deprecatedOwnershipHelperUses.length) {
  console.error(
    `Deprecated require_vehicle_owned helper is forbidden in route modules: ${deprecatedOwnershipHelperUses.join(', ')}`,
  );
  process.exit(1);
}

console.log(`API route security inventory and authorization matrix passed for ${routeFiles.length} route modules.`);
