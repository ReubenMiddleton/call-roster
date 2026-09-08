// Verifies the database schema against a real, running PostgreSQL instance -- not just that the
// SQL parses. Starts a throwaway cluster (scripts/lib/pg-test-cluster.ts), applies every
// migration in `supabase/migrations/` in order, and then checks the invariants the schema exists
// to hold, exactly as measured against the actual server rather than assumed from reading the SQL:
//
//   1. The GiST exclusion constraint refuses two overlapping shifts for one doctor.
//   2. The membership-containment trigger refuses a shift assignment outside every
//      practice_membership interval for that doctor (H-03, standing in for PostgreSQL 18's
//      native temporal PERIOD foreign key -- see the ADR-0008 addendum).
//   3. Row-level security actually isolates tenants: a session scoped to tenant A cannot read
//      tenant B's rows, tested as the non-superuser `app_user` role, not as postgres.
//   4. `command_journal` is append-only.
//   5. `error_record` is immutable, deletable only outside `app_user`, and RLS-hides a null tenant.
//
// This is a separate gate from `npm run check`, the same way `npm run solver:check` is --
// spinning up a Postgres process is not something every `check` run should pay for, and it
// needs a binary `npm run setup:postgres` must have already fetched.

import { join } from 'node:path';
import { createPgTestCluster, REPO_ROOT } from './lib/pg-test-cluster.ts';

const cluster = createPgTestCluster({
  pgdata: join(REPO_ROOT, '.tools', 'pgdata-test'),
  port: '55433',
});

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const DOCTOR_A = '33333333-3333-3333-3333-333333333333';
const DOCTOR_B = '44444444-4444-4444-4444-444444444444';

function runSql(sql: string): void {
  const result = cluster.psql([], sql);
  if (result.code !== 0) {
    throw new Error(`SQL failed:\n${sql}\n--- stderr ---\n${result.stderr}`);
  }
}

function expectFailureContaining(sql: string, needle: string): void {
  const result = cluster.psql([], sql);
  if (result.code === 0) {
    throw new Error(`Expected this to fail but it succeeded:\n${sql}`);
  }
  if (!result.stderr.includes(needle)) {
    throw new Error(
      `Failed as expected, but the error didn't mention "${needle}":\n${sql}\n--- stderr ---\n${result.stderr}`,
    );
  }
}

// Runs a small script (often `SET ROLE ...; select set_config(...); select ...;`) and returns
// the result of its FINAL statement. `-t -A` strips headers and alignment from SELECT output,
// but a `SET`/`select set_config(...)` earlier in the same script still prints its own line --
// hence taking the last non-empty line rather than the whole trimmed output.
function queryScalar(sql: string): string {
  const result = cluster.psql(['-t', '-A'], sql);
  if (result.code !== 0) {
    throw new Error(`Query failed:\n${sql}\n--- stderr ---\n${result.stderr}`);
  }
  const lines = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error(`Query produced no output:\n${sql}`);
  }
  return last;
}

function step(label: string, fn: () => void): void {
  process.stdout.write(`  ${label} ... `);
  fn();
  process.stdout.write('ok\n');
}

function loadFixture(): void {
  runSql(`
    insert into practice (id, name) values
      ('${TENANT_A}', 'Synthetic Tenant A'),
      ('${TENANT_B}', 'Synthetic Tenant B');

    insert into person (id, full_name) values
      ('${DOCTOR_A}', 'Synthetic Doctor A'),
      ('${DOCTOR_B}', 'Synthetic Doctor B');

    insert into practice_membership (tenant_id, doctor_id, valid_at) values
      ('${TENANT_A}', '${DOCTOR_A}', daterange('2026-01-01', '2026-12-31', '[]')),
      ('${TENANT_B}', '${DOCTOR_B}', daterange('2026-01-01', '2026-12-31', '[]'));

    insert into shift_pattern (id, tenant_id, name) values
      ('66666666-6666-6666-6666-666666666666', '${TENANT_A}', 'A');

    insert into pattern_shift (id, tenant_id, pattern_id, shift_key, start_hour, hours, kind) values
      ('77777777-7777-7777-7777-777777777777', '${TENANT_A}', '66666666-6666-6666-6666-666666666666', 'std-night', 23, 8, 'night');

    insert into roster (id, tenant_id, month) values
      ('88888888-8888-8888-8888-888888888888', '${TENANT_A}', '2026-10');

    insert into shift_slot (id, tenant_id, roster_id, on_date, pattern_shift_id) values
      ('99999999-9999-9999-9999-999999999999', '${TENANT_A}', '88888888-8888-8888-8888-888888888888', '2026-10-05', '77777777-7777-7777-7777-777777777777'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${TENANT_A}', '88888888-8888-8888-8888-888888888888', '2026-10-06', '77777777-7777-7777-7777-777777777777');
  `);
}

function main(): void {
  console.log('Starting a throwaway PostgreSQL cluster from .tools/pgsql ...');
  cluster.start();

  try {
    step('applying migrations', () => {
      cluster.applyMigrations();
    });
    step('loading fixture data (as superuser, bypassing RLS)', loadFixture);

    step('exclusion constraint refuses an overlapping shift for the same doctor', () => {
      runSql(`
        insert into shift_assignment (tenant_id, doctor_id, shift_slot_id, period)
        values ('${TENANT_A}', '${DOCTOR_A}', '99999999-9999-9999-9999-999999999999',
                tstzrange('2026-10-05 23:00+02', '2026-10-06 07:00+02'));
      `);
      expectFailureContaining(
        `
        insert into shift_assignment (tenant_id, doctor_id, shift_slot_id, period)
        values ('${TENANT_A}', '${DOCTOR_A}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                tstzrange('2026-10-05 23:30+02', '2026-10-06 07:30+02'));
        `,
        'exclusion',
      );
    });

    step('membership-containment trigger refuses a shift outside every membership interval', () => {
      expectFailureContaining(
        `
        insert into shift_slot (id, tenant_id, roster_id, on_date, pattern_shift_id) values
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '${TENANT_A}', '88888888-8888-8888-8888-888888888888', '2027-06-01', '77777777-7777-7777-7777-777777777777');
        insert into shift_assignment (tenant_id, doctor_id, shift_slot_id, period)
        values ('${TENANT_A}', '${DOCTOR_A}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                tstzrange('2027-06-01 23:00+02', '2027-06-02 07:00+02'));
        `,
        'practice_membership interval',
      );
    });

    step('RLS: app_user scoped to tenant A cannot see tenant B rows', () => {
      const membershipCount = queryScalar(`
        set role app_user;
        select set_config('app.tenant_id', '${TENANT_A}', false);
        select count(*) from practice_membership;
      `);
      if (membershipCount !== '1') {
        throw new Error(`Expected exactly 1 visible membership row, got ${membershipCount}`);
      }

      const personCount = queryScalar(`
        set role app_user;
        select set_config('app.tenant_id', '${TENANT_A}', false);
        select count(*) from person;
      `);
      if (personCount !== '1') {
        throw new Error(
          `Expected exactly 1 visible person row (tenant A's own doctor), got ${personCount}`,
        );
      }

      const crossTenantDoctorName = queryScalar(`
        set role app_user;
        select set_config('app.tenant_id', '${TENANT_A}', false);
        select coalesce((select full_name from person where id = '${DOCTOR_B}'), '(hidden)');
      `);
      if (crossTenantDoctorName !== '(hidden)') {
        throw new Error(`Tenant A could read tenant B's doctor: got "${crossTenantDoctorName}"`);
      }
    });

    step('RLS: an unset tenant context sees nothing, fail-closed', () => {
      const count = queryScalar(`
        set role app_user;
        select count(*) from practice_membership;
      `);
      if (count !== '0') {
        throw new Error(`Expected 0 rows with no tenant context set, got ${count}`);
      }
    });

    step('command_journal is append-only', () => {
      runSql(`
        insert into command_journal (tenant_id, command_type) values ('${TENANT_A}', 'test.command');
      `);
      expectFailureContaining(
        `update command_journal set command_type = 'tampered' where tenant_id = '${TENANT_A}';`,
        'append-only',
      );
    });

    step(
      'error_record is immutable, deletable only outside app_user, and RLS-hides a null tenant',
      () => {
        runSql(`
        insert into error_record (tenant_id, exception_type, exception_message, source)
        values ('${TENANT_A}', 'Error', 'test failure', 'server');
      `);

        // app_user, with no tenant context set at all, can still insert a null-tenant row --
        // proving `with check (true)` actually behaves the way `recordError`'s `withAppUser` path
        // depends on, not just that the policy text says so.
        runSql(`
        set role app_user;
        insert into error_record (tenant_id, exception_type, exception_message, source)
        values (null, 'Error', 'a tenant-less failure', 'server');
      `);
        expectFailureContaining(
          `update error_record set exception_message = 'tampered' where tenant_id = '${TENANT_A}';`,
          'immutable',
        );
        expectFailureContaining(
          `set role app_user; delete from error_record where tenant_id = '${TENANT_A}';`,
          'permission denied',
        );

        // Superuser DELETE (the retention job's eventual role) is not blocked by a trigger --
        // confirmed by actually deleting the row, not just asserting the grant is absent.
        const remainingAfterAppUserAttempt = queryScalar(`
        select count(*) from error_record where tenant_id = '${TENANT_A}';
      `);
        if (remainingAfterAppUserAttempt !== '1') {
          throw new Error(
            `Expected the row untouched after the refused app_user delete, got ${remainingAfterAppUserAttempt}`,
          );
        }
        runSql(`delete from error_record where tenant_id = '${TENANT_A}';`);

        const visibleToTenantA = queryScalar(`
        set role app_user;
        select set_config('app.tenant_id', '${TENANT_A}', false);
        select count(*) from error_record where exception_message = 'a tenant-less failure';
      `);
        if (visibleToTenantA !== '0') {
          throw new Error(
            `Expected the null-tenant error record invisible to tenant A, got ${visibleToTenantA} row(s)`,
          );
        }
      },
    );

    console.log('\nAll database checks passed.');
  } finally {
    console.log('Stopping and discarding the throwaway cluster ...');
    cluster.stop();
  }
}

try {
  main();
} catch (error: unknown) {
  console.error('\ndb:check FAILED');
  console.error(error instanceof Error ? error.message : error);
  cluster.stop();
  process.exit(1);
}
