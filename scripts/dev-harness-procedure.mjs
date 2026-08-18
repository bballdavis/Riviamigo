#!/usr/bin/env node
/**
 * Thin Komodo Procedure entrypoint. Komodo supplies non-secret paths and
 * immutable image/provenance values as environment variables; the harness
 * remains the policy owner and never receives credentials on its command line.
 */
import { main } from './dev-harness.mjs';

const value = (name) => process.env[name]?.trim();
const args = [];
const packagePath = value('RIVIAMIGO_HARNESS_PACKAGE');
if (packagePath) args.push('--package', packagePath);
else args.push('--latest-package-dir', value('RIVIAMIGO_HARNESS_PACKAGE_DIR') || '/share/Containers/Riviamigo-prod/backups');

const required = {
  RIVIAMIGO_HARNESS_BASELINE_IMAGE: '--baseline-image',
  RIVIAMIGO_HARNESS_DEV_IMAGE: '--dev-image',
  RIVIAMIGO_HARNESS_TEST_ROOT: '--test-root',
  RIVIAMIGO_HARNESS_ENV_FILE: '--env-file',
  RIVIAMIGO_HARNESS_COMPOSE_FILE: '--compose-file',
  RIVIAMIGO_HARNESS_PROJECT: '--project',
};
for (const [name, flag] of Object.entries(required)) {
  const current = value(name);
  if (!current) {
    console.error(`dev-harness-procedure: ${name} is required.`);
    process.exitCode = 1;
    process.exit();
  }
  args.push(flag, current);
}

const optional = {
  RIVIAMIGO_HARNESS_SHA256: '--sha256',
  RIVIAMIGO_HARNESS_SOURCE_SHA: '--source-sha',
  RIVIAMIGO_HARNESS_PRERELEASE_TAG: '--prerelease-tag',
  RIVIAMIGO_HARNESS_COMPOSE_SOURCE_SHA: '--compose-source-sha',
  RIVIAMIGO_HARNESS_KOMODO_REVISION: '--komodo-revision',
  RIVIAMIGO_HARNESS_HEALTH_HOST: '--health-host',
  RIVIAMIGO_HARNESS_PORT: '--port',
};
for (const [name, flag] of Object.entries(optional)) {
  const current = value(name);
  if (current) args.push(flag, current);
}

if (value('RIVIAMIGO_HARNESS_RESET_TEST_STORAGE')?.toLowerCase() === 'true') args.push('--reset-test-storage');
if (value('RIVIAMIGO_HARNESS_PLAN_ONLY')?.toLowerCase() === 'true') args.push('--plan');
else args.push('--execute');

await main(args);
