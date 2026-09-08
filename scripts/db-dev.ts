// Lifecycle for the PERSISTENT local development database -- the one `npm run dev` actually
// talks to, as opposed to `db:check`/`api:check`'s throwaway clusters that are wiped after every
// run. Same pinned `.tools/pgsql` binary, no Docker.
//
// Port and connection string here must match `LOCAL_DEV_CONNECTION_STRING` in
// `lib/server/db.ts` -- that is the one other place this is hand-written, and deliberately so
// rather than sharing a constant across an app-code/scripts boundary that shouldn't otherwise
// exist.
//
// Usage: `node scripts/db-dev.ts <start|stop|status|reset>`

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createPgTestCluster, REPO_ROOT } from './lib/pg-test-cluster.ts';

const PGDATA = join(REPO_ROOT, '.tools', 'pgdata-dev');
const cluster = createPgTestCluster({ pgdata: PGDATA, port: '54329' });

function migrate(): void {
  const supabase = join(REPO_ROOT, '.tools', 'supabase', 'supabase.exe');
  if (!existsSync(supabase)) {
    throw new Error(`${supabase} not found. Run 'npm run setup:postgres' first.`);
  }
  console.log(
    'Applying migrations with the Supabase CLI (tracked in supabase_migrations.schema_migrations) ...',
  );
  const result = spawnSync(supabase, ['migration', 'up', '--db-url', cluster.connectionString()], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('supabase migration up failed -- see output above.');
  }
}

function start(): void {
  if (existsSync(PGDATA)) {
    console.log(`Already initialised at ${PGDATA} -- starting it, not re-creating it.`);
    cluster.startExisting();
  } else {
    console.log(`Initialising a new persistent dev cluster at ${PGDATA} ...`);
    cluster.start();
  }
  migrate();
  console.log(`\nDev database is up: ${cluster.connectionString()}`);
  console.log('The app defaults to this automatically (lib/server/db.ts); set DATABASE_URL only');
  console.log('if you need to point somewhere else.');
}

function reset(): void {
  console.log('Stopping and discarding the persistent dev cluster ...');
  cluster.stop(); // wipes PGDATA
  start();
}

const command = process.argv[2];
switch (command) {
  case 'start':
    start();
    break;
  case 'stop':
    cluster.stopKeepingData();
    break;
  case 'status':
    if (cluster.psql(['-c', 'select 1']).code === 0) {
      console.log(`Running: ${cluster.connectionString()}`);
    } else {
      console.log('Not running.');
    }
    break;
  case 'reset':
    reset();
    break;
  default:
    console.error('Usage: node scripts/db-dev.ts <start|stop|status|reset>');
    process.exit(1);
}
