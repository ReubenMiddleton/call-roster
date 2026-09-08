/**
 * Reports when the workforce changed, and which constraint verdicts span a change.
 *
 * ## The gap this fills
 *
 * Two constraints in this practice turned out to be **artefacts of headcount** rather than statements
 * about anyone's habits:
 *
 * - **H-02** was false for eight months and became true in August 2024, when D04 took the
 *   Tuesday-night slot D03 had been covering with a double shift.
 * - **H-07** went from **53% broken to 9% broken, also in August 2024** — the same month and the
 *   same cause, D04 entering the Friday rotation.
 * - **H-05** has the same shape: D02 worked 23% of Saturdays before that boundary and 4% after.
 *
 * *(Corrected 3 September 2026. This docblock said H-07 moved "from 8.1% to 1.9% across early 2025,
 * as the roster grew from eleven doctors to thirteen" — retracted in `domain/constraints.md` on
 * 2 September, but the correction had not reached here. The step is a year earlier and the cause is
 * one colleague, not headcount growth in general.)*
 *
 * The catalogue gets re-verified when somebody *states* a new rule. Nothing re-verified it when the
 * *roster* changed — which is what actually moved both of these. This is that missing signal.
 *
 * It decides nothing. It says: *composition changed here, so a verdict spanning that boundary is
 * describing two different practices at once.*
 *
 * Run with:
 *   npm run seed:workforce
 *
 * **Prints, never fails.** A workforce change is not an error; it is a fact that needs noticing.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { inferAvailability } from '../lib/analytics/availability.ts';
import { forecastCapacity, RESTRICTED_BEFORE_HOUR } from '../lib/analytics/capacity.ts';
import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import {
  ABSENCE_IS_DEPARTURE_DAYS,
  buildWorkforceTimeline,
  spansWorkforceChange,
} from '../lib/analytics/workforce.ts';

// No hard-coded anchor list any more: availability is inferred from the assignments, and the
// anchor/pool split falls out of it. See lib/analytics/availability.ts - it reproduces the
// principal's own classification (D01-D05 anchors) from the data alone.

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

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const found = await findSeedDirectory(requested);
  if (found === null) {
    console.log(
      'check-workforce-changes: no seed data found — skipping.\n' +
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
  const period = loadSeedPeriod(documents, found.dir);
  const timeline = buildWorkforceTimeline(period);

  const months = timeline.headcountByMonth;
  const firstMonth = months[0]?.month ?? '';
  const lastMonth = months[months.length - 1]?.month ?? '';

  console.log('');
  console.log(
    `WORKFORCE TIMELINE — ${firstMonth} to ${lastMonth}, ${String(months.length)} months`,
  );
  console.log('='.repeat(78));
  console.log(
    `  Joins and departures are [INFERRED]: a roster records who worked, never who arrived or left.`,
  );
  console.log(
    `  A gap of more than ${String(ABSENCE_IS_DEPARTURE_DAYS)} days is read as a departure — the number the principal confirmed.`,
  );

  console.log('');
  console.log('CHANGES');
  console.log('-'.repeat(78));
  if (timeline.changes.length === 0) {
    console.log('  none — composition is stable across the whole period.');
  }
  for (const change of timeline.changes) {
    console.log(`  ${change.date}  ${pad(change.kind, 7)} ${change.doctor}`);
  }

  console.log('');
  console.log('HEADCOUNT PER MONTH');
  console.log('-'.repeat(78));
  const maxHeadcount = Math.max(...months.map((entry) => entry.headcount), 1);
  for (const entry of months) {
    const bar = '#'.repeat(Math.round((entry.headcount / maxHeadcount) * 28));
    console.log(`  ${entry.month}  ${String(entry.headcount).padStart(2)}  ${bar}`);
  }

  console.log('');
  console.log('SPANS OF STABLE COMPOSITION');
  console.log('-'.repeat(78));
  console.log('  A constraint verdict is only safely comparable WITHIN one span.');
  console.log('');
  for (const span of timeline.spans) {
    const label =
      span.fromMonth === span.toMonth ? span.fromMonth : `${span.fromMonth} .. ${span.toMonth}`;
    console.log(
      `  ${pad(label, 20)} ${String(span.months).padStart(2)} month(s), ${String(span.roster.length)} doctors`,
    );
  }

  // The finding that motivated all of this, restated against whatever data is present.
  console.log('');
  console.log('⚠️  VERDICTS THAT SPAN A CHANGE');
  console.log('-'.repeat(78));
  const whole = spansWorkforceChange(timeline, firstMonth, lastMonth);
  console.log(
    `  The full-history window (${firstMonth} – ${lastMonth}) contains ${String(whole.length)} change(s).`,
  );
  console.log(
    '  So every constraint verdict computed over it is averaging across those compositions.',
  );
  const longest = [...timeline.spans].sort((a, b) => b.months - a.months)[0];
  if (longest !== undefined) {
    console.log('');
    console.log(
      `  The longest stable span is ${longest.fromMonth} – ${longest.toMonth} (${String(longest.months)} months).`,
    );
    console.log(
      '  That is the widest window in which a verdict describes one practice rather than several.',
    );
  }
  console.log('');
  console.log('  See docs/domain/constraints.md on H-02 and H-07, both of which turned on exactly');
  console.log('  this and neither of which would have been caught by re-reading the rules.');

  // ── What that composition can actually cover ──────────────────────────────────────
  //
  // Headcount alone is misleading here, because the two pools are not interchangeable: pool GPs
  // cannot work a weekday shift starting before 17:00. So the question is never "how many doctors"
  // but "how many ANCHORS, against how many restricted slots".
  console.log('');
  console.log('ANCHOR CAPACITY — the constraint headcount hides');
  console.log('-'.repeat(78));
  console.log(
    '  Restricted = weekday, before 17:00, not a public holiday. Only anchors can work these.',
  );
  console.log(
    '  Pressure = restricted slots / total anchor capacity. 1.00 means no room for anything else.',
  );
  console.log('');
  console.log('  month     restricted   anchors   pressure   level       absences tolerated');

  let noSlackMonths = 0;
  let zeroToleranceMonths = 0;
  // Availability is inferred once, over the whole history, so a doctor's rules do not flap month to
  // month on the strength of one quiet fortnight.
  const availabilities = inferAvailability(period, PILOT_PATTERNS_V1, RESTRICTED_BEFORE_HOUR);

  for (const month of splitByMonth(period)) {
    const present = new Set(month.assignments.map((assignment) => assignment.doctor));
    const doctors = [...availabilities.values()]
      .filter((availability) => present.has(availability.doctor))
      .map((availability) => ({ availability }));
    const forecast = forecastCapacity({
      label: month.label,
      days: month.days,
      patterns: PILOT_PATTERNS_V1,
      doctors,
    });
    if (forecast.level === 'no-slack' || forecast.level === 'shortfall') {
      noSlackMonths += 1;
    }
    if (forecast.absencesTolerated === 0) {
      zeroToleranceMonths += 1;
    }
    const flag = forecast.level === 'ok' ? '' : '  <--';
    console.log(
      `  ${month.label}   ${String(forecast.restrictedSlots).padStart(10)}   ` +
        `${String(forecast.anchorCount).padStart(7)}   ${forecast.pressure.toFixed(2).padStart(8)}   ` +
        `${pad(forecast.level, 11)} ${String(forecast.absencesTolerated).padStart(2)}${flag}`,
    );
  }

  console.log('');
  console.log(
    `  ${String(noSlackMonths)} of ${String(months.length)} months ran with no anchor slack at all.`,
  );
  console.log(
    `  ${String(zeroToleranceMonths)} of ${String(months.length)} could not have tolerated a single anchor absence.`,
  );
  console.log('');
  console.log(
    '  ⚠️  This measures STRUCTURE, not behaviour. It was tested against the 34 real H-02',
  );
  console.log(
    '  double shifts and correlates at only 0.611, with counterexamples both ways — May 2025',
  );
  console.log(
    '  ran at 0.91 pressure with zero doubles. Do not read it as a forecast of breaches.',
  );
  console.log(
    '  What it does say: when an anchor goes, there is no substitute, and that is knowable',
  );
  console.log('  in October rather than on 20 December.');
  console.log('');
}

await main();
