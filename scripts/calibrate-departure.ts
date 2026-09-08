/**
 * Measures how much this practice's own months differ from each other.
 *
 * A departure distance on its own is uninterpretable. **0.18 is meaningless until you know that a
 * real month scores between 0.12 and 0.23.** So every transcribed month is scored against the
 * history that preceded it, and the resulting spread is the reference band a candidate roster gets
 * placed against.
 *
 * That is the honest version of what the owner asked for. He asked for *"a confidence interval for
 * how likely the configuration is to match previous months"*; a confidence interval is a range
 * estimate for a population parameter from a sample, which is not what this is. This is an
 * **empirical reference band** — the observed spread of the practice's own months — and it supports
 * the sentence that was actually wanted: *"this option is about as different from your usual pattern
 * as a normal month is"*, or *"this one is further out than any month in three years."*
 *
 * ⚠️ **A month scoring inside the band is not thereby good**, and the report says so. See the module
 * docblock of `lib/analytics/departure.ts` — the historical rosters are the thing the project exists
 * to improve on, so resemblance to them is a cost to weigh, never a quality score.
 *
 * Run with:
 *   npm run seed:departure
 *
 * **Prints, never fails the gate.** This is a measurement, not a check.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { DEPARTURE_AXES, MIN_HISTORY_MONTHS, referenceBand } from '../lib/analytics/departure.ts';
import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';

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

function bar(value: number, width = 28): string {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return '#'.repeat(filled).padEnd(width, '.');
}

async function main(): Promise<void> {
  const found = await findSeedDirectory(process.argv[2]);
  if (found === null) {
    console.log(
      'calibrate-departure: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data',
    );
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    documents.push(
      JSON.parse(await readFile(path.join(found.dir, file), 'utf8')) as SeedMonthDocument,
    );
  }
  const months = splitByMonth(loadSeedPeriod(documents, 'seed'));
  const { bands, perMonth } = referenceBand(months, { patterns: PILOT_PATTERNS_V1 });

  console.log(
    `calibrate-departure: ${String(months.length)} month(s) from ${found.dir}, ` +
      `${String(perMonth.filter((month) => month.counted).length)} in the band ` +
      `(the first ${String(MIN_HISTORY_MONTHS)} are warm-up and excluded)`,
  );
  console.log('');
  console.log('  How far each real month sits from the history before it:');
  console.log('');
  console.log('  month     share  nights  wknds  anchor');
  for (const month of perMonth) {
    const cells = DEPARTURE_AXES.map((axis) =>
      (month.distances.get(axis) ?? Number.NaN).toFixed(2).padStart(6),
    );
    console.log(
      `  ${month.label.padEnd(9)}${cells.join(' ')}${month.counted ? '' : '   (warm-up)'}`,
    );
  }

  console.log('');
  console.log('  The reference band, from the counted months:');
  console.log('');
  console.log('  axis              min    p25  median    p75    max');
  for (const band of bands) {
    console.log(
      `  ${band.axis.padEnd(16)}${[band.min, band.p25, band.median, band.p75, band.max]
        .map((value) => value.toFixed(2).padStart(6))
        .join(' ')}`,
    );
  }

  console.log('');
  console.log(
    '  Read as: a candidate roster inside p25..p75 on an axis is as different from habit',
  );
  console.log(
    '  as an ordinary month of this practice is. Outside max, nobody has ever done that.',
  );
  console.log('');
  for (const band of bands) {
    console.log(`  ${band.axis.padEnd(16)} ${bar(band.median)}  median ${band.median.toFixed(2)}`);
  }

  console.log('');
  console.log('  ⚠️ Being inside the band is NOT a quality verdict. The load ratio is the only');
  console.log('     fairness verdict this product presents; this is an indicator beside it. A');
  console.log('     roster that matches habit perfectly also reproduces the imbalance the');
  console.log('     project exists to fix — Gini 0.179, top four carrying 52.2%.');
  console.log('');
}

await main();
