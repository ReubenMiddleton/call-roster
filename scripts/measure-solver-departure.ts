/**
 * Solves a month the practice already built by hand, and compares both against the same history.
 *
 * This is the question the owner asked — *"see definitively if the solver is being valuable"* — put
 * in a form that can actually be answered. For a month that exists we have two rosters over
 * identical days: **the one the principal built, and the one the solver produces from the same
 * inputs.** Scoring both against the history *before* that month makes them directly comparable.
 *
 * The useful sentence it produces is: *"for August 2026 your own roster sat 0.17 from your usual
 * pattern and the solver's sits 0.19 — both ordinary."* That is a far stronger claim than any
 * percentage, because the comparison is against the principal's own work on the same month rather
 * than against an abstract target.
 *
 * ⚠️ **Closer to history is not better**, and the report repeats it. A solver that reproduced the
 * hand-built roster exactly would be worthless: it would also reproduce the imbalance the project
 * exists to fix. What this measures is *surprise*, which is a cost to weigh against the fairness
 * verdict — never a score to maximise. See `lib/analytics/departure.ts`.
 *
 * ## What it does not control for
 *
 * The solver receives **no preferences**, because none were ever recorded — every historical
 * assignment carries `provenance: unknown`. The principal was working from a diary of requests this
 * pipeline has never seen. So a departure the solver shows may be the solver being different, or it
 * may be a request nobody wrote down. **That asymmetry favours the hand-built roster**, and any
 * reading of these numbers has to carry it.
 *
 * Run with:
 *   npm run seed:solver-departure               # the last complete month
 *   node scripts/measure-solver-departure.ts 2026-08
 *
 * **Prints, never fails the gate.** Needs `uv`, so it is not in `npm run check`.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  DEPARTURE_AXES,
  type DepartureBand,
  departureProfile,
  historyBefore,
  placeInBand,
  referenceBand,
} from '../lib/analytics/departure.ts';
import { AGREED_BURDEN_V2 } from '../lib/analytics/burden.ts';
import {
  buildLedger,
  entitlementWeights,
  LEDGER_WINDOW_MONTHS,
  ledgerCutoff,
} from '../lib/analytics/ledger.ts';
import { buildPeriodReport, type PeriodReport } from '../lib/analytics/metrics.ts';
import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import type { Assignment, RosterPeriod } from '../lib/analytics/types.ts';

const OPTIONS = { patterns: PILOT_PATTERNS_V1 };

interface SolverOutput {
  readonly status: string;
  readonly objective: number;
  readonly assignments: readonly {
    readonly date: string;
    readonly shiftId: string;
    readonly doctorCode: string;
  }[];
  readonly violations: readonly { readonly constraintId: string }[];
}

async function findSeedDirectory(): Promise<{ dir: string; files: string[] } | null> {
  for (const candidate of ['private/seed-data', 'fixtures/seed-data']) {
    try {
      const entries = await readdir(candidate);
      const files = entries.filter((entry) => entry.endsWith('.json')).sort();
      if (files.length > 0) {
        return { dir: candidate, files };
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function run(
  command: string,
  args: readonly string[],
): { ok: boolean; stdout: string; text: string } {
  const result = spawnSync(command, [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: result.error === undefined && result.status === 0,
    // Typed as string, not `string | null`, because `encoding: 'utf8'` is set. Only read when
    // `ok` is true, which already requires the process to have started and exited cleanly.
    stdout: result.stdout,
    text: `${result.stdout}${result.stderr}`.trim(),
  };
}

function line(label: string, own: number, solver: number, band: DepartureBand): string {
  const delta = solver - own;
  const arrow = Math.abs(delta) < 0.02 ? ' ≈ ' : delta > 0 ? ' ▲ ' : ' ▼ ';
  return (
    `  ${label.padEnd(17)}${own.toFixed(2).padStart(6)}${arrow}${solver.toFixed(2).padStart(5)}` +
    `   ${band.p25.toFixed(2)}–${band.p75.toFixed(2)}   ${placeInBand(solver, band)}`
  );
}

async function main(): Promise<void> {
  const found = await findSeedDirectory();
  if (found === null) {
    console.log('measure-solver-departure: no seed data found — skipping.');
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    documents.push(
      JSON.parse(await readFile(path.join(found.dir, file), 'utf8')) as SeedMonthDocument,
    );
  }
  const months = splitByMonth(loadSeedPeriod(documents, 'seed'));

  const requested = process.argv[2];
  const index =
    requested === undefined
      ? months.length - 1
      : months.findIndex((month) => month.label.startsWith(requested));
  const target = index >= 0 ? months[index] : undefined;
  if (target === undefined) {
    console.error(
      `measure-solver-departure: no month "${String(requested)}". Available: ` +
        months.map((month) => month.label).join(', '),
    );
    process.exitCode = 1;
    return;
  }

  const workDir = mkdtempSync(path.join(tmpdir(), 'call-roster-departure-'));
  const requestPath = path.join(workDir, 'request.json');
  try {
    const build = run(process.execPath, [
      'scripts/build-solve-request.ts',
      target.label.slice(0, 7),
      '--out',
      requestPath,
    ]);
    if (!build.ok) {
      console.error(`measure-solver-departure: could not build the request.\n${build.text}`);
      process.exitCode = 1;
      return;
    }

    const solved = run(path.join('.tools', 'uv', 'uv.exe'), [
      'run',
      '--project',
      'solver',
      'call-roster-solver',
      '--request',
      requestPath,
      '--json',
    ]);
    if (!solved.ok) {
      console.error(
        `measure-solver-departure: the solver failed.\n${solved.text}\n` +
          '  This needs `uv` — run `npm run setup:uv` if it is missing.',
      );
      process.exitCode = 1;
      return;
    }

    const output = JSON.parse(solved.stdout) as SolverOutput;
    const solverAssignments: Assignment[] = output.assignments.map((entry) => ({
      date: entry.date,
      shiftId: entry.shiftId,
      doctor: entry.doctorCode,
      // The solver directs every assignment it makes. Nothing here was requested by a doctor,
      // because no request was ever recorded — see the caveat in this file's docblock.
      provenance: 'directed',
    }));
    const solverMonth: RosterPeriod = {
      label: `${target.label}-solver`,
      days: target.days,
      assignments: solverAssignments,
    };

    const before = historyBefore(months, index);
    const ownProfile = departureProfile(target, before, OPTIONS);
    const solverProfile = departureProfile(solverMonth, before, OPTIONS);
    const { bands } = referenceBand(months, OPTIONS);
    const bandFor = new Map(bands.map((band) => [band.axis, band]));

    console.log(
      `measure-solver-departure: ${target.label}, against the ${String(index)} month(s) before it`,
    );
    console.log(
      `  solver returned ${output.status} with ${String(output.assignments.length)} assignment(s) ` +
        `and ${String(output.violations.length)} violation(s); the sheet has ` +
        `${String(target.assignments.length)}.`,
    );
    console.log('');
    console.log('  axis              yours    solver   ordinary   how the solver reads');
    for (const axis of DEPARTURE_AXES) {
      const own = ownProfile.axes.find((entry) => entry.key === axis);
      const solver = solverProfile.axes.find((entry) => entry.key === axis);
      const band = bandFor.get(axis);
      if (own === undefined || solver === undefined || band === undefined) {
        continue;
      }
      console.log(line(axis, own.distance, solver.distance, band));
    }

    console.log('');
    console.log(
      `  anchor slots missed: yours ${String(ownProfile.anchorMisses.length)}, ` +
        `solver ${String(solverProfile.anchorMisses.length)}`,
    );

    // ── The other half. Departure alone cannot answer "is this better?" ────────────────
    //
    // A departure that goes UP is not automatically bad, and on the weekend axis it is
    // expected to: the practice does not spread weekends evenly — the top four doctors
    // carry 52.2% of the burden — so a solver that equalises burden MUST move weekends
    // away from the people who historically took them. Printing the fairness verdict
    // beside the indicator is what stops that reading as a regression.
    // ⚠️ Measured CUMULATIVELY — history plus the month — not on the month alone.
    //
    // Two reasons, and the first is fatal on its own. One month is **low sample** by this
    // engine's own rule (under 20 shifts or a 60-day span), so every doctor is excluded
    // from the practice-wide figures and Gini comes back 0.000 for any roster you feed it.
    // A first attempt printed exactly that, for both rosters, and it looked authoritative.
    //
    // The second is that S-01 equalises **cumulative** burden by definition. "Is this month
    // internally fair" is the wrong question; "where does the ledger stand after it" is the
    // one the constraint is about.
    // ⚠️ Scoped to the SAME window the solver optimises over — `LEDGER_WINDOW_MONTHS`.
    //
    // Measuring 33 months of fairness against a solver that was given three would be marking it
    // against an exam it did not sit. The window is the practice's stated policy ("a new
    // beginning, not a reckoning for two years of injustices" — question 43), so it is the span
    // the verdict has to be computed over as well.
    const ledgerFrom = ledgerCutoff(target.label.slice(0, 7));
    const inWindow = (date: string): boolean => date >= ledgerFrom;
    const withMonth = (month: RosterPeriod): RosterPeriod => ({
      label: `${before.label}+${month.label}`,
      days: [...before.days.filter((day) => inWindow(day.date)), ...month.days],
      assignments: [
        ...before.assignments.filter((entry) => inWindow(entry.date)),
        ...month.assignments,
      ],
    });
    // ⚠️ ONE FIXED DENOMINATOR FOR BOTH ROSTERS, and this is not a detail.
    //
    // `revealed-opportunity` derives a doctor's entitlement from the cells they were *observed*
    // working — which makes it **self-referential when scoring a candidate**: a roster that puts
    // someone into a cell they have never worked increases their own denominator, so the two
    // rosters get marked against two different scales and the comparison is meaningless. It is
    // the right basis for reporting on history, which is what it was built for.
    //
    // So the entitlement is computed once, from the history both rosters share, and applied to
    // both via the `explicit` basis. A first version of this comparison missed it and produced a
    // Gini that moved the wrong way when the model got strictly better.
    const historyOnly: RosterPeriod = {
      label: 'history-for-entitlement',
      days: before.days.filter((day) => inWindow(day.date)),
      assignments: before.assignments.filter((entry) => inWindow(entry.date)),
    };
    const historyLedger = buildLedger(historyOnly, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const fixedEntitlement = entitlementWeights(
      historyOnly,
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      historyLedger,
      { basis: 'revealed-opportunity' },
    );
    const sameScale = { basis: 'explicit' as const, explicitWeights: fixedEntitlement };

    const ownReport = buildPeriodReport(
      withMonth(target),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      sameScale,
    );
    const solverReport = buildPeriodReport(
      withMonth(solverMonth),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      sameScale,
    );
    const peak = (report: PeriodReport): number =>
      Math.max(...report.doctors.map((doctor) => doctor.loadRatio ?? 0));
    const better = (own: number, solver: number): string =>
      solver < own - 0.001 ? '  ← solver fairer' : solver > own + 0.001 ? '  ← yours fairer' : '';

    console.log('');
    console.log(
      `  The verdict it has to be weighed against — load ratio over the last ${String(LEDGER_WINDOW_MONTHS)} month(s),`,
    );
    console.log('  which is the window the solver optimises — ADR-0012 and question 43:');
    console.log('');
    console.log(
      `  worst-loaded doctor      yours ${peak(ownReport).toFixed(3)}` +
        `   solver ${peak(solverReport).toFixed(3)}` +
        better(peak(ownReport), peak(solverReport)),
    );
    console.log(
      `  Gini of load ratio       yours ${ownReport.practice.giniLoadRatio.toFixed(3)}` +
        `   solver ${solverReport.practice.giniLoadRatio.toFixed(3)}` +
        better(ownReport.practice.giniLoadRatio, solverReport.practice.giniLoadRatio),
    );
    console.log('');
    console.log('  ⚠️ Closer to history is NOT better. A solver that reproduced the hand-built');
    console.log(
      '     roster exactly would also reproduce the imbalance the project exists to fix.',
    );
    console.log(
      '     This measures surprise, to weigh against the fairness verdict — not quality.',
    );
    console.log('  ⚠️ The solver saw NO preferences: every historical assignment is provenance');
    console.log('     `unknown`, so requests the principal was working from were never recorded.');
    console.log('     That asymmetry favours the hand-built roster.');
    console.log('');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
