/**
 * Prints the fairness and analytics report for the transcribed roster history.
 *
 * The command-line face of `lib/analytics/`, and the reason that engine is being built before any
 * dashboard: the same arithmetic feeds the solver's fairness objective, the doctor-facing ledger
 * and the export footer, and it can be validated against fifteen months of real rosters today.
 * A chart cannot be validated against anything.
 *
 * Run with:
 *   node scripts/analytics-report.ts                       # private/seed-data/, or the fixture
 *   node scripts/analytics-report.ts <dir>
 *   node scripts/analytics-report.ts --basis equal         # to see why the naive basis is wrong
 *
 * Node 24 runs TypeScript directly, so this shares types with the engine rather than
 * reimplementing the arithmetic in a second language. `.ts` import specifiers are required by
 * Node's resolver and permitted by `allowImportingTsExtensions`.
 *
 * **Prints, never fails.** This is a report; `npm run seed:check` is the gate.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { AGREED_BURDEN_V2, validateBurdenSchedule } from '../lib/analytics/burden.ts';
import type { EntitlementBasis } from '../lib/analytics/equity.ts';
import { buildPeriodReport, type PeriodReport } from '../lib/analytics/metrics.ts';
import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';

const VALID_BASES: readonly EntitlementBasis[] = [
  'equal',
  'active-days',
  'revealed-opportunity',
  'explicit',
];

function parseArguments(argv: readonly string[]): { dir: string | null; basis: EntitlementBasis } {
  let dir: string | null = null;
  let basis: EntitlementBasis = 'revealed-opportunity';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === '--basis') {
      const value = argv[index + 1];
      if (value === undefined || !VALID_BASES.includes(value as EntitlementBasis)) {
        throw new Error(`--basis must be one of: ${VALID_BASES.join(', ')}`);
      }
      basis = value as EntitlementBasis;
      index += 1;
      continue;
    }
    if (!argument.startsWith('--')) {
      dir = argument;
    }
  }

  if (basis === 'explicit') {
    throw new Error(
      '--basis explicit needs per-doctor weights, which the practice has not supplied. Nothing to report.',
    );
  }

  return { dir, basis };
}

async function findSeedDirectory(
  explicit: string | null,
): Promise<{ dir: string; files: string[] } | null> {
  const candidates = explicit === null ? ['private/seed-data', 'fixtures/seed-data'] : [explicit];
  for (const candidate of candidates) {
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

function bar(value: number, max: number, width = 28): string {
  if (max <= 0) {
    return '';
  }
  const filled = Math.round((value / max) * width);
  return '#'.repeat(Math.max(0, Math.min(width, filled)));
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function fixed(value: number, places = 1): string {
  return value.toFixed(places);
}

function printDoctorTable(report: PeriodReport): void {
  const columns = [
    pad('Doctor', 8),
    padStart('Shifts', 7),
    padStart('Burden', 8),
    padStart('Share', 7),
    padStart('Fair', 8),
    padStart('Ratio', 7),
    padStart('Nights', 7),
    padStart('Night%', 7),
    padStart('Fri', 5),
    padStart('Sat', 5),
    padStart('Sun', 5),
    padStart('Hol', 5),
  ].join('  ');
  console.log(columns);
  console.log('-'.repeat(columns.length));

  for (const doctor of report.doctors) {
    console.log(
      [
        pad(doctor.doctor, 8),
        padStart(String(doctor.shifts), 7),
        padStart(fixed(doctor.burden), 8),
        padStart(`${fixed(doctor.realisedShare * 100)}%`, 7),
        padStart(fixed(doctor.expectedBurden), 8),
        padStart(
          doctor.loadRatio === null
            ? 'n/a'
            : fixed(doctor.loadRatio, 2) +
                (doctor.ratioConfidence === 'low-sample' ||
                doctor.membership === 'inferred-departed'
                  ? '?'
                  : ''),
          7,
        ),
        padStart(String(doctor.nights), 7),
        padStart(`${fixed(doctor.nightShare * 100, 0)}%`, 7),
        padStart(String(doctor.fridays), 5),
        padStart(String(doctor.saturdays), 5),
        padStart(String(doctor.sundays), 5),
        padStart(String(doctor.publicHolidays), 5),
      ].join('  '),
    );
  }
}

function printLoadRatioChart(report: PeriodReport): void {
  console.log('');
  console.log('Load ratio — 1.00 is an exactly fair share of burden, given availability');
  const comparable = report.doctors.filter((doctor) => doctor.loadRatio !== null);
  console.log(
    '  A trailing ? means the ratio is not a verdict: too few observations, or the doctor has left.',
  );
  const maximum = Math.max(1, ...comparable.map((doctor) => doctor.loadRatio ?? 0));
  for (const doctor of comparable) {
    const ratio = doctor.loadRatio ?? 0;
    const marker =
      doctor.membership === 'inferred-departed'
        ? `  (left ~${String(doctor.daysSinceLastShift)}d before period end)`
        : doctor.ratioConfidence === 'low-sample'
          ? `  (low sample, present ${String(Math.round(doctor.presenceShare * 100))}% of period)`
          : ratio > 1.15
            ? ' <-- carrying more than their share'
            : '';
    console.log(
      `  ${pad(doctor.doctor, 6)} ${padStart(fixed(ratio, 2), 5)}  ${bar(ratio, maximum)}${marker}`,
    );
  }
}

function printMonthlyBurden(
  documents: readonly SeedMonthDocument[],
  basis: EntitlementBasis,
): void {
  const period = loadSeedPeriod(documents, 'history');
  const months = splitByMonth(period);
  console.log('');
  console.log('Burden per month — the year-end and mid-year spikes should be visible');
  const totals = months.map((month) => {
    const report = buildPeriodReport(month, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, { basis });
    return { label: month.label, total: report.practice.totalBurden, report };
  });
  const maximum = Math.max(...totals.map((entry) => entry.total));
  for (const entry of totals) {
    const heaviest = entry.report.doctors[0];
    const note =
      heaviest === undefined ? '' : `  heaviest ${heaviest.doctor} ${fixed(heaviest.burden)}`;
    console.log(
      `  ${entry.label}  ${padStart(fixed(entry.total), 7)}  ${bar(entry.total, maximum, 24)}${note}`,
    );
  }
}

async function main(): Promise<void> {
  const { dir: requestedDir, basis } = parseArguments(process.argv.slice(2));

  const scheduleProblems = validateBurdenSchedule(AGREED_BURDEN_V2);
  if (scheduleProblems.length > 0) {
    console.error('analytics-report: the burden schedule is invalid:');
    for (const problem of scheduleProblems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  const found = await findSeedDirectory(requestedDir);
  if (found === null) {
    console.log(
      'analytics-report: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data\n' +
        '  Real transcriptions live in private/seed-data/ and are never committed.',
    );
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    const raw = await readFile(path.join(found.dir, file), 'utf8');
    documents.push(JSON.parse(raw) as SeedMonthDocument);
  }

  const period = loadSeedPeriod(documents, `${found.dir} (${String(documents.length)} months)`);
  const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, { basis });
  const { practice } = report;

  console.log('');
  console.log(`FAIRNESS AND ANALYTICS REPORT — ${practice.label}`);
  console.log('='.repeat(78));
  console.log(
    `  ${String(practice.totalShifts)} assignments, ${String(practice.doctorCount)} doctors ` +
      `(${String(practice.activeDoctorCount)} active, ${String(practice.departedDoctorCount)} inferred departed), ` +
      `${String(period.days.length)} days`,
  );
  console.log(
    `  total burden ${fixed(practice.totalBurden)}  |  burden schedule "${practice.burdenScheduleVersion}" [${practice.burdenScheduleConfidence}]  |  fair-share basis "${practice.entitlementBasis}"`,
  );
  if (practice.uncoveredSlots > 0) {
    console.log(`  ⚠️  ${String(practice.uncoveredSlots)} uncovered slot(s) — H-01 violated`);
  }

  console.log('');
  console.log('READ THIS BEFORE QUOTING ANY NUMBER BELOW');
  console.log('-'.repeat(78));
  for (const caveat of practice.caveats) {
    console.log(`  * ${caveat}`);
  }

  console.log('');
  console.log('PER DOCTOR');
  console.log('-'.repeat(78));
  printDoctorTable(report);
  printLoadRatioChart(report);

  console.log('');
  console.log('PRACTICE-WIDE');
  console.log('-'.repeat(78));
  console.log(`  Gini, load ratio          ${fixed(practice.giniLoadRatio, 3)}   <-- the headline`);
  console.log(`  Gini, raw burden          ${fixed(practice.giniBurden, 3)}`);
  console.log(`  Jain index, raw burden    ${fixed(practice.jainBurden, 3)}`);
  console.log(`  Coefficient of variation  ${fixed(practice.coefficientOfVariationBurden, 3)}`);
  console.log(`  Mean absolute deviation   ${fixed(practice.meanAbsoluteDeviationBurden, 2)}`);
  console.log(
    `  Top four concentration    ${fixed(practice.topFourConcentration * 100, 1)}% of all burden`,
  );
  console.log(
    `  Heaviest burden           ${fixed(practice.leximaxBurden[0] ?? 0)}   (leximax minimises this first)`,
  );
  console.log('');
  console.log(
    '  Only the load-ratio figure is a fairness verdict. The dispersion measures are indicators:',
  );
  console.log(
    '  each can be "improved" by loading up whoever is doing least, so none may be optimised.',
  );
  console.log('  See lib/analytics/equity.ts and docs/domain/fairness.md.');

  console.log('');
  console.log('PROVENANCE');
  console.log('-'.repeat(78));
  for (const [provenance, count] of Object.entries(practice.shiftsByProvenance)) {
    console.log(`  ${pad(provenance, 12)} ${padStart(String(count), 6)}`);
  }
  console.log(
    '  Requested shifts are excluded from equalisation: a doctor who asks for extra work must not',
  );
  console.log(
    '  have next month withheld as a consequence. Nothing historical records provenance.',
  );

  printMonthlyBurden(documents, basis);
  console.log('');
}

await main();
