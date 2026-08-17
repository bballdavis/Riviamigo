const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseDatabaseTarget(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
}

export function assertLocalDatabaseResetAllowed({ args, env }) {
  if (env.RIVIAMIGO_ENV === 'production' || env.NODE_ENV === 'production') {
    throw new Error('Database reset is disabled in production environments.');
  }

  if (env.RIVIAMIGO_ALLOW_DATABASE_RESET !== 'local-development') {
    throw new Error(
      'Database reset requires RIVIAMIGO_ALLOW_DATABASE_RESET=local-development.'
    );
  }

  if (!args.includes('--yes')) {
    throw new Error('Database reset requires the explicit --yes argument.');
  }

  const databaseUrl = parseDatabaseTarget(env.DATABASE_URL, 'DATABASE_URL');

  if (!LOOPBACK_HOSTS.has(databaseUrl.hostname)) {
    throw new Error(
      `Database reset is limited to loopback hosts; received ${databaseUrl.hostname}.`
    );
  }

  return {
    database: databaseUrl.pathname.replace(/^\//, ''),
    host: databaseUrl.hostname,
    port: databaseUrl.port || '5432',
  };
}

export function assertDisposableUpgradeDatabase(env) {
  if (!env.UPGRADE_DATABASE_URL) {
    throw new Error(
      'The populated upgrade harness requires an explicit UPGRADE_DATABASE_URL.'
    );
  }

  const databaseUrl = parseDatabaseTarget(env.UPGRADE_DATABASE_URL, 'UPGRADE_DATABASE_URL');
  if (!LOOPBACK_HOSTS.has(databaseUrl.hostname)) {
    throw new Error(
      `The populated upgrade harness is limited to loopback hosts; received ${databaseUrl.hostname}.`
    );
  }

  const database = databaseUrl.pathname.replace(/^\//, '');
  if (!/^riviamigo_upgrade(?:_[a-z0-9_]+)?$/.test(database)) {
    throw new Error(
      'UPGRADE_DATABASE_URL must name a disposable riviamigo_upgrade database.'
    );
  }

  return databaseUrl.toString();
}
