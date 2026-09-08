// Applies migrations to, and then interrogates, a REMOTE Postgres -- the Supabase projects of
// Track B7 (docs/ops/supabase-setup.md). The sibling of `scripts/db-dev.ts`, which does the same
// two jobs against the pinned local `.tools/pgsql` cluster.
//
// This exists because "the schema applies cleanly locally" is not evidence that it applies
// cleanly on Supabase, and the difference is not cosmetic: locally the app connects as a real
// superuser that owns the cluster, whereas Supabase's `postgres` is not a superuser. Every
// query in `lib/server/db.ts` opens with `SET LOCAL ROLE app_user`, and whether that is even
// permitted on the other side is a question only the other side can answer.
//
//   npm run db:tester:migrate   npm run db:tester:verify
//   npm run db:prod:migrate     npm run db:prod:verify
//
// ⚠️ **There is deliberately no default target.** An earlier version read `DATABASE_URL`, the
// same variable Next.js loads from `.env.local` -- which meant `npm run dev` would have talked to
// the production database, and a bare `db:remote:verify` would have too. The exposure was nil at
// the time (prod was empty, `app/` was three scaffold files) and would have become severe on the
// day the editor shipped, which is the worst possible shape for a mistake: harmless while you are
// looking at it, dangerous once you have stopped.
//
// So the targets are `DATABASE_URL_PROD` and `DATABASE_URL_TESTER`, neither of which any other
// code reads, and one of `--prod` / `--tester` / `--url <string>` is REQUIRED. `.env.local` no
// longer sets a bare `DATABASE_URL` at all, so `npm run dev` falls through to the local cluster
// (`LOCAL_DEV_CONNECTION_STRING` in lib/server/db.ts). Reaching production takes a named script.
//
// `verify` writes nothing: its one INSERT runs inside a transaction that always rolls back, so
// it is safe to point at the production project. `.env.local` is gitignored, and deliberately has
// no committed template -- see check-publish-safety.ts.

import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client, type ClientConfig } from 'pg';
import { REPO_ROOT, MIGRATIONS_DIR } from './lib/pg-test-cluster.ts';

const ENV_FILE = join(REPO_ROOT, '.env.local');

/** A uuid this repository will never otherwise use, so a stray row is unmistakably from here. */
const PROBE_TENANT = 'dbdbdbdb-0000-4000-8000-000000000001';
const OTHER_TENANT = 'dbdbdbdb-0000-4000-8000-000000000002';

interface Finding {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
}

const findings: Finding[] = [];

function record(ok: boolean, label: string, detail: string): void {
  findings.push({ ok, label, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}\n         ${detail}`);
}

function note(label: string, detail: string): void {
  console.log(`  --   ${label}\n         ${detail}`);
}

/**
 * The connection string with the password replaced. Every line this script prints goes through
 * here -- a connection string in a terminal is a credential in a scrollback buffer, and the
 * owner is going to paste this output somewhere.
 */
function redact(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:****@');
}

/**
 * Resolves the target, which must always be named explicitly. The two projects hold very
 * different things -- `call-roster-tester` is synthetic data and `call-roster-prod` will hold
 * thirteen identifiable people's movements, a split that is a POPIA requirement rather than a
 * convenience (docs/ops/tester-programme.md) -- so "which database did that run against?" is
 * answered by the command itself, not by remembering which line of `.env.local` was edited last.
 */
function connectionString(): string {
  if (existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
  }
  const flagIndex = process.argv.indexOf('--url');
  const fromFlag = flagIndex === -1 ? undefined : process.argv[flagIndex + 1];
  if (fromFlag !== undefined) {
    console.log('→ --url (explicit)\n');
    return fromFlag;
  }

  const prod = process.argv.includes('--prod');
  const tester = process.argv.includes('--tester');
  if (prod === tester) {
    fail(
      prod
        ? 'Pass --prod or --tester, not both.'
        : 'No target. Pass --prod, --tester, or --url <string>.\n' +
            'There is no default on purpose: see the header of this file.\n' +
            'Usually: npm run db:tester:verify  /  npm run db:prod:verify',
    );
  }

  const name = prod ? 'DATABASE_URL_PROD' : 'DATABASE_URL_TESTER';
  const url = process.env[name];
  if (url === undefined || url === '') {
    fail(
      `${name} is not set in ${ENV_FILE}. See docs/ops/supabase-setup.md.\n` +
        'Note this is NOT plain DATABASE_URL -- nothing here reads that any more, so that\n' +
        '`npm run dev` cannot reach a Supabase project by accident.',
    );
  }
  console.log(
    prod ? '→ call-roster-PROD ⚠️  real data\n' : '→ call-roster-tester (synthetic data)\n',
  );
  return url;
}

/**
 * `pg` only negotiates TLS when told to, and a URI copied out of the Supabase dashboard carries
 * no `sslmode`, so it has to be turned on here. Untouched for a local host, where the pinned
 * cluster has no certificate at all.
 */
function isRemote(url: string): boolean {
  const host = new URL(url).hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function migrate(url: string): void {
  const supabase = join(REPO_ROOT, '.tools', 'supabase', 'supabase.exe');
  if (!existsSync(supabase)) {
    fail(`${supabase} not found. Run 'npm run setup:postgres' first.`);
  }
  console.log(`Applying migrations to ${redact(url)}\n`);
  const result = spawnSync(supabase, ['migration', 'up', '--db-url', url], { stdio: 'inherit' });
  if (result.status !== 0) {
    // The commonest cause by far, and it is invisible in the CLI's own error: the CLI tracks a
    // migration by its version prefix alone, so a file EDITED after it was applied is never
    // re-run, and the database quietly keeps the old shape. A later migration referencing the
    // new shape then fails with a missing relation or column. Locally the fix is a reset; on
    // Supabase there is no such fix, which is why migrations are append-only from the moment a
    // project exists -- see docs/ops/supabase-setup.md.
    fail(
      'supabase migration up failed -- see output above.\n' +
        'If it names a relation or column that plainly does exist in supabase/migrations/, the\n' +
        'target has an OLD version of an edited migration: the CLI tracks version numbers, not\n' +
        "content. Locally, 'npm run db:dev:reset' rebuilds from scratch.",
    );
  }
  console.log('\nMigrations applied. Now run the matching db:*:verify.');
}

async function checkConnection(client: Client, url: string): Promise<void> {
  const { hostname, port } = new URL(url);
  const version = await client.query<{ v: string }>('select version() as v');
  note('Server', version.rows[0]?.v.split(',')[0] ?? 'unknown');

  const who = await client.query<{ current_user: string; session_user: string; su: boolean }>(
    `select current_user, session_user,
            coalesce((select rolsuper from pg_roles where rolname = current_user), false) as su`,
  );
  const row = who.rows[0];
  note(
    'Connected as',
    `${row?.session_user ?? '?'}${row?.su === true ? ' (a superuser -- so this is the local cluster, not Supabase)' : ' (not a superuser)'}`,
  );

  // `endsWith` on a dotted suffix, never `includes` -- CodeQL's very first alert on this
  // repository (js/incomplete-url-substring-sanitization, high) was the `includes` version of
  // this line, which also matches `pooler.supabase.com.example.invalid`. Here it only selects a
  // diagnostic message and the connection string comes from the developer's own `.env.local`, so
  // nothing was exploitable -- but the predicate was simply wrong, and "it happens not to matter
  // here" is how the same line survives being copied somewhere it does.
  if (hostname.endsWith('.pooler.supabase.com')) {
    record(
      port !== '6543',
      'Connection mode',
      port === '6543'
        ? 'Port 6543 is the TRANSACTION pooler, which does not keep session state between ' +
            'queries. Use the SESSION pooler (port 5432) instead -- see docs/ops/supabase-setup.md.'
        : `Session pooler on port ${port}. IPv4-compatible and session-mode, which is what lib/server/db.ts needs.`,
    );
  } else if (hostname.endsWith('.supabase.co')) {
    note(
      'Connection mode',
      'Direct connection. Works, but is IPv6-only without the paid IPv4 add-on -- if it ' +
        'connected, this network has IPv6.',
    );
  }
}

async function checkMigrations(client: Client): Promise<void> {
  const onDisk = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.split('_')[0] ?? f)
    .sort();

  const applied = await client.query<{ version: string }>(
    'select version from supabase_migrations.schema_migrations order by version',
  );
  const appliedVersions = applied.rows.map((r) => r.version);
  const missing = onDisk.filter((v) => !appliedVersions.includes(v));

  record(
    missing.length === 0,
    'Migrations applied',
    missing.length === 0
      ? `All ${String(onDisk.length)} migrations recorded in supabase_migrations.schema_migrations.`
      : `Not applied: ${missing.join(', ')}. Run 'node scripts/db-remote.ts migrate' first.`,
  );
}

async function checkExtension(client: Client): Promise<void> {
  const ext = await client.query<{ extname: string; nspname: string }>(
    `select e.extname, n.nspname from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'btree_gist'`,
  );
  const found = ext.rows[0];
  record(
    found !== undefined,
    'btree_gist installed',
    found === undefined
      ? 'Missing. Every GiST exclusion constraint in this schema depends on it (0001).'
      : `Present in schema "${found.nspname}".`,
  );
}

/**
 * The one genuinely unknown thing, and the reason this script exists. `lib/server/db.ts` opens
 * every single transaction with `set local role app_user`, which requires the login role to be a
 * member of `app_user`. Locally the login role is a superuser, so it always works and proves
 * nothing. On Supabase `postgres` is not a superuser: it may or may not have been made a member
 * of a role it created. If this fails, no route works at all, and it fails at runtime rather
 * than at migration time.
 */
async function checkRoleSwitch(client: Client): Promise<void> {
  const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'",
  );
  const r = role.rows[0];
  if (r === undefined) {
    record(false, 'app_user role exists', 'No app_user role. Migration 0001 did not run.');
    return;
  }
  record(
    !r.rolsuper && !r.rolbypassrls,
    'app_user is not privileged',
    r.rolsuper || r.rolbypassrls
      ? 'app_user is SUPERUSER or BYPASSRLS -- it must be neither, or RLS is decorative (ADR-0007).'
      : 'Neither SUPERUSER nor BYPASSRLS, so RLS actually binds it.',
  );

  try {
    await client.query('begin');
    await client.query('set local role app_user');
    const now = await client.query<{ u: string }>('select current_user as u');
    await client.query('rollback');
    record(
      now.rows[0]?.u === 'app_user',
      'SET LOCAL ROLE app_user',
      `Succeeded; current_user became "${now.rows[0]?.u ?? '?'}". This is what every query in lib/server/db.ts does.`,
    );
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    record(
      false,
      'SET LOCAL ROLE app_user',
      `REFUSED: ${error instanceof Error ? error.message : String(error)}\n         ` +
        'Fix by granting membership from a session that has it: GRANT app_user TO postgres;',
    );
  }
}

async function checkRlsCoverage(client: Client): Promise<void> {
  const tables = await client.query<{ relname: string; rls: boolean; forced: boolean }>(
    `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  const unprotected = tables.rows.filter((t) => !t.rls || !t.forced);
  record(
    tables.rows.length > 0 && unprotected.length === 0,
    'RLS enabled and FORCEd on every table',
    unprotected.length === 0
      ? `All ${String(tables.rows.length)} public tables have both. FORCE is the half that matters here -- without it the table owner silently bypasses every policy.`
      : `Missing on: ${unprotected.map((t) => t.relname).join(', ')}.`,
  );
}

/**
 * Proves isolation on this server rather than trusting that the policies read correctly. Runs as
 * `app_user`, and the whole thing is rolled back -- nothing is left behind, which is why this is
 * safe to point at the production project.
 */
async function checkTenantIsolation(client: Client): Promise<void> {
  try {
    await client.query('begin');
    await client.query('set local role app_user');
    // No RETURNING: `practice`'s SELECT policy is `id = app_current_tenant_id()`, and RETURNING
    // must satisfy it too -- but there is no tenant context until this row exists to be one.
    // Same reason `app/api/practices/route.ts` generates the id client-side.
    await client.query('insert into practice (id, name) values ($1, $2)', [
      PROBE_TENANT,
      'db-remote verify probe',
    ]);

    await client.query("select set_config('app.tenant_id', $1, true)", [PROBE_TENANT]);
    const mine = await client.query('select 1 from practice where id = $1', [PROBE_TENANT]);

    await client.query("select set_config('app.tenant_id', $1, true)", [OTHER_TENANT]);
    const theirs = await client.query('select 1 from practice where id = $1', [PROBE_TENANT]);

    await client.query('rollback');
    record(
      mine.rowCount === 1 && theirs.rowCount === 0,
      'Tenant isolation holds live',
      mine.rowCount === 1 && theirs.rowCount === 0
        ? 'A row visible to its own tenant is invisible to another. Transaction rolled back; nothing was written.'
        : `Own tenant saw ${String(mine.rowCount)} row(s) (expected 1), other tenant saw ${String(theirs.rowCount)} (expected 0). THIS IS A DATA LEAK.`,
    );
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    record(
      false,
      'Tenant isolation holds live',
      `Probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Supabase grants its PostgREST roles broad default privileges in `public`, so tables created
 * there can become reachable over the project's public REST endpoint. Nothing in this product
 * uses PostgREST. RLS should still deny every row (no `app.tenant_id` is ever set on such a
 * request, and the policies fail closed), but a table that is granted and exposed is one policy
 * mistake away from being readable from the internet, and this product's tables hold thirteen
 * identifiable people's movements.
 */
async function checkPostgrestExposure(client: Client): Promise<void> {
  const exposed = await client.query<{ grantee: string; n: string }>(
    `select grantee, count(distinct table_name)::text as n
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
      group by grantee order by grantee`,
  );
  if (exposed.rows.length === 0) {
    note(
      'PostgREST exposure',
      'No grants to anon/authenticated. Either those roles do not exist (local cluster) or the schema is not exposed.',
    );
    return;
  }
  note(
    'PostgREST exposure',
    `${exposed.rows.map((r) => `${r.grantee}: ${r.n} tables`).join(', ')}. ` +
      'RLS still denies every row, but nothing here uses PostgREST -- consider revoking. ' +
      'Logged as follow-up work in docs/ops/supabase-setup.md.',
  );
}

/**
 * ⚠️ Supabase signs its Postgres endpoints with its OWN CA, not a public one -- measured
 * 2026-09-08 against every `aws-N-eu-*.pooler.supabase.com` host, all of which fail Node's
 * default trust store with "self-signed certificate in certificate chain". So the usual
 * `ssl: true` cannot work, and the usual workaround (`rejectUnauthorized: false`) leaves the
 * connection encrypted but UNAUTHENTICATED -- one man-in-the-middle away from plaintext, on a
 * link carrying thirteen identifiable people's movements.
 *
 * The correct answer is neither: download Supabase's CA (dashboard → Project Settings → Database
 * → SSL Configuration, `prod-ca-2021.crt`), drop it in the repo root, and verify against it
 * properly. Found automatically; `--ca <path>` overrides. `--insecure` exists as a deliberate,
 * loudly-announced escape hatch, never as a silent fallback.
 */
const CA_CANDIDATES = ['prod-ca-2021.crt', 'supabase-ca.crt', 'supabase-ca-bundle.crt'];

function findCaCert(): { path: string; pem: string } | undefined {
  const flagIndex = process.argv.indexOf('--ca');
  const explicit = flagIndex === -1 ? undefined : process.argv[flagIndex + 1];
  const paths = explicit === undefined ? CA_CANDIDATES.map((f) => join(REPO_ROOT, f)) : [explicit];
  for (const path of paths) {
    if (existsSync(path)) {
      return { path, pem: readFileSync(path, 'utf8') };
    }
  }
  if (explicit !== undefined) {
    fail(`--ca ${explicit} does not exist.`);
  }
  return undefined;
}

async function connect(url: string): Promise<Client> {
  const insecure = process.argv.includes('--insecure');
  let ssl: ClientConfig['ssl'];

  if (isRemote(url)) {
    const ca = findCaCert();
    if (insecure) {
      console.log(
        '⚠️  --insecure: the TLS certificate is NOT verified. Encrypted, but not authenticated.\n',
      );
      ssl = { rejectUnauthorized: false };
    } else if (ca !== undefined) {
      // `servername` is not set: the pooler certificate's subject is the host in the URL, so
      // Node's default SNI/hostname check is the right one. Only the trust anchor changes.
      console.log(`TLS verified against ${ca.path}\n`);
      ssl = { ca: ca.pem, rejectUnauthorized: true };
    } else {
      fail(
        'No Supabase CA certificate found, and Supabase signs its Postgres endpoints with its own\n' +
          "CA -- so Node's default trust store will reject them. This is expected, not a fault.\n\n" +
          'Fix it properly: dashboard → Project Settings → Database → SSL Configuration →\n' +
          `Download certificate, and save it as one of ${CA_CANDIDATES.join(' / ')} in\n` +
          `${REPO_ROOT} (already gitignored). Or pass --ca <path>.\n\n` +
          '`--insecure` skips verification entirely. It encrypts but does not authenticate, so it\n' +
          'is a diagnostic, not a way to run against a database of real people.',
      );
    }
  }

  const client = new Client({ connectionString: url, ...(ssl === undefined ? {} : { ssl }) });
  try {
    await client.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/certificate|self-signed|unable to (get|verify)/i.test(message)) {
      fail(
        `TLS certificate rejected: ${message}\n` +
          'The downloaded CA does not match this endpoint. Check it came from THIS project, and\n' +
          'that the host in DATABASE_URL is the one the dashboard gave you.',
      );
    }
    fail(`Could not connect: ${message}`);
  }
  return client;
}

async function verify(url: string): Promise<void> {
  console.log(`Verifying ${redact(url)}\n`);
  const client = await connect(url);
  try {
    await checkConnection(client, url);
    await checkMigrations(client);
    await checkExtension(client);
    await checkRoleSwitch(client);
    await checkRlsCoverage(client);
    await checkTenantIsolation(client);
    await checkPostgrestExposure(client);
  } finally {
    await client.end();
  }

  const failed = findings.filter((f) => !f.ok);
  console.log('');
  if (failed.length > 0) {
    console.error(`${String(failed.length)} check(s) failed. This database is not ready to use.`);
    process.exit(1);
  }
  console.log(`All ${String(findings.length)} checks passed.`);
}

const command = process.argv[2];
switch (command) {
  case 'migrate':
    migrate(connectionString());
    break;
  case 'verify':
    await verify(connectionString());
    break;
  default:
    console.error('Usage: node scripts/db-remote.ts <migrate|verify> [--url <connection string>]');
    process.exit(1);
}
