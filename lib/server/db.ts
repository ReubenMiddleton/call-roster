/**
 * Server-side Postgres access.
 *
 * Every tenant-scoped query MUST go through `withTenant`, never a bare `pool.query(...)` -- a
 * bare query runs as `postgres`, which owns every table and bypasses row-level security
 * entirely. `withTenant` and `withAppUser` are the only two ways this module lets you touch the
 * database, and both run as the non-superuser `app_user` role created in
 * `supabase/migrations/0001_extensions_and_tenant_context.sql` -- RLS is the enforcement
 * boundary (ADR-0007), not care at the call site.
 *
 * Local dev connects straight to the pinned `.tools/pgsql` cluster as `postgres`, then
 * `SET LOCAL ROLE app_user` for the rest of the transaction. That shortcut only works because
 * local dev owns the whole cluster; production (Supabase) will authenticate as `app_user`
 * directly, or as `authenticated` under Supabase's own RLS/JWT story, and `DATABASE_URL` is the
 * one thing that needs to change to get there -- nothing that imports this module does.
 */

import { Pool, type PoolClient, types } from 'pg';

// `pg` parses a `date` column into a JS `Date` at local-machine midnight by default -- so the
// same `2026-10-05` row serialises differently depending on the server's timezone, and always
// differently from the plain `YYYY-MM-DD` string every route handler's response shape assumes.
// Verified 2026-09-08: the default parser returned `2026-10-04T22:00:00.000Z` for the literal
// date `'2026-10-05'` on this machine (SAST, UTC+2). Every `date` column in this schema
// (`shift_slot.on_date`, `date_pattern.on_date`, the daterange endpoints of `valid_at`) is a
// calendar date, never a timestamp -- so the fix is registering the identity parser once, for
// every connection this pool ever opens, rather than remembering to `::text`-cast it at every
// call site.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

/**
 * `npm run db:dev:start` pins a persistent local cluster at this exact port and superuser
 * connection -- see `scripts/db-dev.ts`, the one other place this string is allowed to be
 * hand-written. Overridden by `DATABASE_URL` anywhere that isn't this machine's local dev setup.
 *
 * ⚠️ `.env.local` deliberately does NOT set `DATABASE_URL`, even though both Supabase projects
 * exist and their connection strings are in that file under `DATABASE_URL_PROD` and
 * `DATABASE_URL_TESTER`. Next.js loads `.env.local` automatically, so a `DATABASE_URL` there is
 * what `npm run dev` would connect to -- and pointed at production that is a mistake shaped the
 * worst possible way: harmless while there is no editor UI, severe on the day there is. Only
 * `scripts/db-remote.ts` reads the two suffixed names, and only when explicitly given `--prod` or
 * `--tester`. See docs/ops/supabase-setup.md.
 */
export const LOCAL_DEV_CONNECTION_STRING =
  'postgresql://postgres@127.0.0.1:54329/postgres?sslmode=disable';

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL ?? LOCAL_DEV_CONNECTION_STRING });
  return pool;
}

/** Test-only: drop the cached pool so a new `DATABASE_URL` takes effect. */
export async function resetPoolForTests(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
  }
}

async function runInTransaction<T>(
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('set local role app_user');
    if (tenantId !== null) {
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a transaction scoped to one tenant: `app_current_tenant_id()` resolves to
 * `tenantId` for every RLS policy for the duration of the call, and never leaks to the next
 * transaction on a pooled connection because it is set with `SET LOCAL`.
 */
export function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runInTransaction(tenantId, fn);
}

/**
 * Runs `fn` as `app_user` with no tenant context set. Only the handful of operations whose RLS
 * policy doesn't require one belong here -- today that's creating a `practice` (there is no
 * tenant to scope to until the row exists) and creating a `person` before their first
 * membership. Everything else must go through `withTenant`.
 */
export function withAppUser<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return runInTransaction(null, fn);
}
