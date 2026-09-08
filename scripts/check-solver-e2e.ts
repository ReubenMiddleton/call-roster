/**
 * Runs the whole solver boundary in one process tree: seed sheets → TypeScript → JSON → Python.
 *
 * The gap this closes. `npm run contract:check` compares field *names* across the boundary, and
 * `fixtures/solver-request.json` is parsed by both sides — but the fixture is hand-written, and a
 * hand-written payload only proves the parser reads what someone typed. **Nothing exercised the
 * request TypeScript actually produces.** `buildSolveRequest` could emit a field the parser rejects,
 * or omit one it requires, and every existing check would stay green.
 *
 * So this does the real thing:
 *
 *   fixtures/seed-data → loadSeedPeriod → inferAvailability → buildSolveRequest → JSON on disk
 *                                                                                     ↓
 *                                            call-roster-solver --request --json → parse → solve
 *
 * ## Why the synthetic fixture and not the real months
 *
 * Deliberate. This check exists to prove the **boundary** works, not to exercise real data, and
 * running it on `fixtures/seed-data` makes it behave identically on the owner's machine and on a
 * fresh clone with no `private/`. It also means the intermediate request written to the OS temp
 * directory is invented data, which sidesteps the data boundary rather than reasoning about it.
 * `npm run seed:request` remains the tool for a real month.
 *
 * ## Where it runs
 *
 * `npm run solver:check`, not `npm run check` — it needs `uv` and a Python environment, and the
 * TypeScript gate must stay runnable without either.
 *
 * Run with:
 *   npm run solver:e2e
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { inferAvailability } from '../lib/analytics/availability.ts';
import { AGREED_BURDEN_V2 } from '../lib/analytics/burden.ts';
import { loadSeedPeriod, type SeedMonthDocument } from '../lib/analytics/seed-period.ts';
import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import type { DoctorCode } from '../lib/analytics/types.ts';
import {
  buildSolveRequest,
  type DoctorMembership,
  RequestBuildError,
  type WireConstraint,
} from '../lib/contract/request.ts';
import { createPgTestCluster, REPO_ROOT } from './lib/pg-test-cluster.ts';

const SEED_DIR = 'fixtures/seed-data';

/** The hour before which pool doctors are at their own practices on an ordinary weekday. H-10. */
const RESTRICTED_BEFORE_HOUR = 17;

/** Mirrors `scripts/build-solve-request.ts`. H-07 ships OFF because it is `[INFERRED]`. */
const CONSTRAINTS: readonly WireConstraint[] = [
  { id: 'H-01', mode: 'BLOCK', weight: 1_000_000 },
  { id: 'H-02', mode: 'BLOCK', weight: 1_000_000 },
  { id: 'H-04', mode: 'BLOCK', weight: 10_000 },
  { id: 'H-07', mode: 'OFF', weight: 10_000 },
  { id: 'H-10', mode: 'BLOCK', weight: 1_000_000 },
  { id: 'S-05', mode: 'WARN', weight: 60 },
  { id: 'S-06', mode: 'WARN', weight: 80 },
];

/** Burden weights, as in `scripts/build-solve-request.ts`. Placeholders — question 35. */
const BURDEN_WEIGHTS: Readonly<Record<string, number>> = {
  weekday: 1,
  saturday: 3,
  sunday: 3,
  'public-holiday': 4,
};

interface SolverOutput {
  readonly status: string;
  readonly objective: number;
  readonly slots: number;
  readonly preflightOk: boolean;
  readonly preflightFailures: readonly string[];
  readonly assignments: readonly { readonly date: string; readonly shiftId: string }[];
  readonly violations: readonly { readonly constraintId: string; readonly cost: number }[];
  readonly costByTier: Readonly<Record<string, number>>;
  // L3, solve-run diagnostics (docs/ops/diagnostics.md) -- see
  // solver/src/call_roster_solver/__init__.py's `_solve_request_file`.
  readonly requestHash: string;
  readonly preflight: {
    readonly feasible: boolean;
    readonly totalDemand: number;
    readonly totalSupply: number;
    readonly failures: readonly string[];
  };
  readonly modelSnapshot: string;
  readonly numWorkers: number;
  readonly cpSatVersion: string;
}

function fail(message: string): never {
  console.error(`check-solver-e2e: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // ── 1. TypeScript builds a request from the seed sheets ──────────────────────────────
  const files = readdirSync(SEED_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    fail(
      `no seed months in ${SEED_DIR}. This directory is committed, so it should never be empty.`,
    );
  }

  const documents = files.map(
    (name) => JSON.parse(readFileSync(path.join(SEED_DIR, name), 'utf8')) as SeedMonthDocument,
  );
  const period = loadSeedPeriod(documents, 'solver-e2e');
  const availability = inferAvailability(period, PILOT_PATTERNS_V1, RESTRICTED_BEFORE_HOUR);

  const firstSeen = new Map<DoctorCode, string>();
  for (const assignment of period.assignments) {
    const existing = firstSeen.get(assignment.doctor);
    if (existing === undefined || assignment.date < existing) {
      firstSeen.set(assignment.doctor, assignment.date);
    }
  }
  const firstDate = period.days[0]?.date ?? '2000-01-01';
  const codes: DoctorMembership[] = [...firstSeen.keys()].sort().map((code) => ({
    code,
    availableFrom: firstSeen.get(code) ?? firstDate,
  }));

  let request;
  try {
    request = buildSolveRequest({
      solveRunId: 'e2e',
      tenantId: 'e2e',
      rosterId: 'e2e',
      horizon: {
        start: firstDate,
        end: period.days[period.days.length - 1]?.date ?? '2000-01-01',
      },
      doctors: codes,
      days: period.days,
      patterns: PILOT_PATTERNS_V1,
      availability,
      burdenWeights: BURDEN_WEIGHTS,
      burdenSchedule: AGREED_BURDEN_V2,
      constraints: CONSTRAINTS,
    });
  } catch (error) {
    if (error instanceof RequestBuildError) {
      fail(`TypeScript refused to build the request — ${error.message}`);
    }
    throw error;
  }

  // ── 2. Hand it to Python ─────────────────────────────────────────────────────────────
  const workDir = mkdtempSync(path.join(tmpdir(), 'call-roster-e2e-'));
  const requestPath = path.join(workDir, 'solver-request.json');
  try {
    writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');

    const run = spawnSync(
      path.join('.tools', 'uv', 'uv.exe'),
      [
        'run',
        '--project',
        'solver',
        'call-roster-solver',
        '--request',
        requestPath,
        '--time-budget',
        '30',
        '--json',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    if (run.error !== undefined) {
      fail(
        `could not run the solver — ${run.error.message}\n` +
          '  uv is pinned into .tools/ by `npm run setup:uv`. This check needs it, which is why ' +
          'it lives in `npm run solver:check` rather than `npm run check`.',
      );
    }
    if (run.status !== 0) {
      fail(
        `the solver rejected the request TypeScript produced (exit ${String(run.status)}).\n` +
          `  ${(run.stderr || run.stdout).trim()}\n` +
          '  This is the failure the check exists for: contract:check compares field NAMES, and a ' +
          'shape mismatch gets past it.',
      );
    }

    // ── 3. Assert on the result ────────────────────────────────────────────────────────
    let output: SolverOutput;
    try {
      output = JSON.parse(run.stdout) as SolverOutput;
    } catch {
      fail(`the solver's --json output was not JSON:\n${run.stdout.slice(0, 500)}`);
    }

    const problems: string[] = [];
    if (!['OPTIMAL', 'FEASIBLE', 'TIMED_OUT'].includes(output.status)) {
      problems.push(`status was ${output.status}. The model must always return a solution.`);
    }
    if (!output.preflightOk) {
      problems.push(`pre-flight failed: ${output.preflightFailures.join('; ')}`);
    }

    // Every slot the request described must come back covered. A coverage-tier violation on a
    // month the practice actually staffed means the boundary lost something on the way across.
    const slotsSent = request.days.reduce((sum, day) => sum + day.shifts.length, 0);
    if (output.slots !== slotsSent) {
      problems.push(
        `TypeScript sent ${String(slotsSent)} slots and Python saw ${String(output.slots)}.`,
      );
    }
    const covered = new Set(output.assignments.map((a) => `${a.date}|${a.shiftId}`));
    if (covered.size !== slotsSent) {
      problems.push(
        `${String(slotsSent - covered.size)} slot(s) uncovered out of ${String(slotsSent)}.`,
      );
    }

    if (problems.length > 0) {
      console.error('check-solver-e2e: the boundary ran, but the result is wrong:');
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exit(1);
    }

    console.log(`check-solver-e2e: ${String(files.length)} synthetic month(s) from ${SEED_DIR}`);
    console.log(
      `  TypeScript built a request of ${String(request.days.length)} day(s), ` +
        `${String(slotsSent)} slot(s), ${String(request.doctors.length)} doctor(s).`,
    );
    console.log(
      `  Python parsed it, pre-flight passed, and the solve returned ${output.status} ` +
        `with objective ${String(output.objective)} and every slot covered.`,
    );
    if (output.violations.length > 0) {
      const byId = new Map<string, number>();
      for (const violation of output.violations) {
        byId.set(violation.constraintId, (byId.get(violation.constraintId) ?? 0) + 1);
      }
      console.log(
        `  ${String(output.violations.length)} violation(s) reported: ` +
          [...byId]
            .sort()
            .map(([id, count]) => `${id}×${String(count)}`)
            .join(', '),
      );
    }
    console.log('');

    // ── 4. Persist one real solve_run row, proving L3's diagnostic surface holds real data ──
    //
    // ⚠️ Nothing writes to `solve_run` in the product yet -- there is no `GenerateDraft` route
    // and no worker claiming rows (0008_solve_run.sql's own comment; "the solver ships last",
    // AGENTS.md). This is the one place a real solve's diagnostics can be proven to round-trip
    // through the schema correctly today: not a synthetic row, the actual output the boundary
    // just produced, two steps up.
    console.log('check-solver-e2e: persisting one real solve_run row (L3) ...');
    await checkSolveRunPersistence(output);
    console.log('  solve_run round-tripped every L3 field correctly.\n');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function checkSolveRunPersistence(output: SolverOutput): Promise<void> {
  const cluster = createPgTestCluster({
    pgdata: path.join(REPO_ROOT, '.tools', 'pgdata-solver-e2e'),
    port: '55437',
  });
  cluster.start();
  try {
    cluster.applyMigrations();
    process.env.DATABASE_URL = cluster.connectionString();
    // Imported only after DATABASE_URL is set -- lib/server/db.ts reads it lazily on first
    // query, but setting it up front removes any doubt about import order mattering (the same
    // reasoning scripts/check-api-e2e.ts follows).
    const { resetPoolForTests, withAppUser, withTenant } = await import('../lib/server/db.ts');
    try {
      // `practice`'s SELECT policy is `id = app_current_tenant_id()`, and `INSERT ... RETURNING`
      // must satisfy it too -- there is no tenant context yet at creation time. Generating the id
      // client-side (matching `POST /api/practices`, `app/api/practices/route.ts`) sidesteps
      // that rather than fighting it.
      const tenantId = randomUUID();
      await withAppUser(async (client) => {
        await client.query('insert into practice (id, name) values ($1, $2)', [
          tenantId,
          'solver-e2e',
        ]);
      });

      const { rosterId, solveRunId } = await withTenant(tenantId, async (client) => {
        const rosterResult = await client.query<{ id: string }>(
          "insert into roster (tenant_id, month) values ($1, '2026-09') returning id",
          [tenantId],
        );
        const rId = rosterResult.rows[0]?.id;
        if (rId === undefined) {
          throw new Error('insert into roster returned no row');
        }

        const insertResult = await client.query<{ id: string }>(
          `insert into solve_run
             (tenant_id, roster_id, status, request, best_objective, result, request_hash,
              preflight_result, model_snapshot, cp_sat_version, num_workers, claimed_at,
              finished_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
           returning id`,
          [
            tenantId,
            rId,
            output.status === 'TIMED_OUT' ? 'timed_out' : 'succeeded',
            JSON.stringify({ note: 'the raw request lives in the temp file solved above' }),
            output.objective,
            JSON.stringify({ assignments: output.assignments, violations: output.violations }),
            output.requestHash,
            JSON.stringify(output.preflight),
            output.modelSnapshot,
            output.cpSatVersion,
            output.numWorkers,
          ],
        );
        const sId = insertResult.rows[0]?.id;
        if (sId === undefined) {
          throw new Error('insert into solve_run returned no row');
        }
        return { rosterId: rId, solveRunId: sId };
      });

      const row = await withTenant(tenantId, async (client) => {
        const result = await client.query<{
          status: string;
          request_hash: string;
          preflight_result: { feasible: boolean; totalDemand: number };
          model_snapshot: string;
          cp_sat_version: string;
          num_workers: number;
          roster_id: string;
        }>(
          `select status, request_hash, preflight_result, model_snapshot, cp_sat_version,
                  num_workers, roster_id
           from solve_run where id = $1`,
          [solveRunId],
        );
        return result.rows[0];
      });

      if (row === undefined) {
        fail('the solve_run row vanished immediately after insert.');
      }
      const problems: string[] = [];
      if (row.roster_id !== rosterId) {
        problems.push('roster_id did not round-trip.');
      }
      if (row.request_hash !== output.requestHash) {
        problems.push('request_hash did not round-trip.');
      }
      if (
        row.preflight_result.feasible !== output.preflight.feasible ||
        row.preflight_result.totalDemand !== output.preflight.totalDemand
      ) {
        problems.push('preflight_result did not round-trip.');
      }
      if (row.model_snapshot !== output.modelSnapshot) {
        problems.push('model_snapshot did not round-trip.');
      }
      if (row.cp_sat_version !== output.cpSatVersion || row.num_workers !== output.numWorkers) {
        problems.push('cp_sat_version/num_workers did not round-trip.');
      }
      if (problems.length > 0) {
        fail(`solve_run round-trip failed:\n  ${problems.join('\n  ')}`);
      }
    } finally {
      await resetPoolForTests();
    }
  } finally {
    cluster.stop();
  }
}

await main();
