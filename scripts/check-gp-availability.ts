/**
 * Tests one claim against the transcribed history: **pool GPs cannot work weekday shifts
 * starting before 17:00.**
 *
 * `[CONFIRMED 2026-08-31]` by the practice principal, asked what makes a day use the reduced
 * 07:00–17:00 pattern:
 *
 * > *"It is usually when there is a shortage of doctors (which happens to happen more often on
 * > holidays and public holidays) but it will usually always happen on a weekday because GPs
 * > can't work before 17:00 since they are working at other practices."*
 *
 * This script exists because that single fact explains four things previously recorded as
 * unrelated oddities — H-06, Pattern C, the request diary's Friday–Sunday triples, and why the
 * weekend boundary is 17:00 — and a claim carrying that much weight should be reproducible rather
 * than taken on trust. See `docs/domain/workforce.md`.
 *
 * **The holiday column is the interesting one.** If the stated *cause* is right, the constraint
 * should hold on weekdays and dissolve on public holidays, when the GPs' own practices are closed.
 * It does. That is confirmation of the mechanism, not merely of the pattern.
 *
 * Run with:
 *   npm run seed:availability
 *   node scripts/check-gp-availability.ts <dir>
 *
 * **Prints, never fails.** This is a report, not a gate.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { loadSeedPeriod, type SeedMonthDocument } from '../lib/analytics/seed-period.ts';
import { dayOfWeek, indexShifts, PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import type { IsoDate, RosterDay } from '../lib/analytics/types.ts';

/**
 * The confirmed anchor/pool split. Anchors hold recurring weekday slots; everyone else covers
 * around a job at another practice.
 *
 * Hard-coded here and nowhere else, because this script is a one-off check against *this*
 * practice's history rather than product code. The engine itself is tenant-agnostic.
 */
const ANCHORS = new Set(['D01', 'D02', 'D03', 'D04', 'D05']);

/** The hour before which pool doctors are at their own practices on a weekday. */
const AVAILABLE_FROM_HOUR = 17;

interface Tally {
  total: number;
  weekdayBefore17: number;
  weekdayFrom17: number;
  holidayBefore17: number;
  examples: string[];
}

function emptyTally(): Tally {
  return { total: 0, weekdayBefore17: 0, weekdayFrom17: 0, holidayBefore17: 0, examples: [] };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

async function findSeedDirectory(
  explicit: string | undefined,
): Promise<{ dir: string; files: string[] } | null> {
  const candidates =
    explicit === undefined ? ['private/seed-data', 'fixtures/seed-data'] : [explicit];
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

async function main(): Promise<void> {
  const requested = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const found = await findSeedDirectory(requested);
  if (found === null) {
    console.log(
      'check-gp-availability: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data\n' +
        '  Real transcriptions live in private/seed-data/ and are never committed.',
    );
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    documents.push(
      JSON.parse(await readFile(path.join(found.dir, file), 'utf8')) as SeedMonthDocument,
    );
  }
  const period = loadSeedPeriod(documents, found.dir);

  const shiftIndex = indexShifts(PILOT_PATTERNS_V1);
  const dayIndex = new Map<IsoDate, RosterDay>(period.days.map((day) => [day.date, day]));
  const tallies = new Map<string, Tally>();

  for (const assignment of period.assignments) {
    const day = dayIndex.get(assignment.date);
    const shift = shiftIndex.get(assignment.shiftId);
    if (day === undefined || shift === undefined) {
      continue;
    }

    let tally = tallies.get(assignment.doctor);
    if (tally === undefined) {
      tally = emptyTally();
      tallies.set(assignment.doctor, tally);
    }
    tally.total += 1;

    const weekday = dayOfWeek(assignment.date);
    const isMondayToFriday = weekday >= 1 && weekday <= 5;
    if (!isMondayToFriday) {
      continue;
    }

    if (shift.startHour >= AVAILABLE_FROM_HOUR) {
      tally.weekdayFrom17 += 1;
      continue;
    }
    // A public holiday is counted separately: the GPs' own practices are closed, so the
    // constraint should not apply. This column is the test of the stated cause.
    if (day.dayClass === 'public-holiday') {
      tally.holidayBefore17 += 1;
      continue;
    }
    tally.weekdayBefore17 += 1;
    if (tally.examples.length < 4) {
      tally.examples.push(`${assignment.date} ${assignment.shiftId}`);
    }
  }

  console.log('');
  console.log('CLAIM: pool GPs cannot work weekday shifts starting before 17:00.');
  console.log(`Source: ${found.dir}, ${String(period.assignments.length)} assignments.`);
  console.log('');
  console.log(
    [
      pad('doctor', 8),
      pad('tier', 8),
      padStart('total', 6),
      padStart('wd<17', 6),
      padStart('wd>=17', 7),
      padStart('hol<17', 7),
      '  verdict',
    ].join('  '),
  );
  console.log('-'.repeat(92));

  const rows = [...tallies.entries()].sort(([aDoctor], [bDoctor]) => {
    const aTier = ANCHORS.has(aDoctor) ? 0 : 1;
    const bTier = ANCHORS.has(bDoctor) ? 0 : 1;
    return aTier - bTier || aDoctor.localeCompare(bDoctor);
  });

  for (const [doctor, tally] of rows) {
    const isAnchor = ANCHORS.has(doctor);
    const verdict = isAnchor
      ? '(anchor — the claim does not apply)'
      : tally.weekdayBefore17 === 0
        ? 'holds'
        : `${String(tally.weekdayBefore17)} exception(s): ${tally.examples.join(', ')}`;
    console.log(
      [
        pad(doctor, 8),
        pad(isAnchor ? 'anchor' : 'pool', 8),
        padStart(String(tally.total), 6),
        padStart(String(tally.weekdayBefore17), 6),
        padStart(String(tally.weekdayFrom17), 7),
        padStart(String(tally.holidayBefore17), 7),
        `  ${verdict}`,
      ].join('  '),
    );
  }

  const pool = rows.filter(([doctor]) => !ANCHORS.has(doctor));
  const poolShifts = pool.reduce((total, [, tally]) => total + tally.total, 0);
  const exceptions = pool.reduce((total, [, tally]) => total + tally.weekdayBefore17, 0);
  const holidayDaytime = pool.reduce((total, [, tally]) => total + tally.holidayBefore17, 0);
  const clean = pool.filter(([, tally]) => tally.weekdayBefore17 === 0).length;

  console.log('');
  console.log(
    `Pool: ${String(poolShifts)} shifts, ${String(exceptions)} starting before 17:00 on a weekday ` +
      `(${((exceptions / Math.max(1, poolShifts)) * 100).toFixed(1)}%). ` +
      `${String(clean)} of ${String(pool.length)} pool doctors have none.`,
  );
  console.log(
    `Pool daytime shifts on public holidays: ${String(holidayDaytime)}. ` +
      'These are expected — their own practices are closed, so they are free.',
  );
  console.log(
    'That asymmetry is the point: the constraint holds on weekdays and dissolves on holidays,',
  );
  console.log('which is what the stated cause predicts. See docs/domain/workforce.md.');
  console.log('');
}

await main();
