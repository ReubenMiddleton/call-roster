/**
 * Measures how much of the real roster the weekday-default table actually explains.
 *
 * `lib/calendar/pattern-precedence.ts` resolves a date's shift pattern from the practice's defaults,
 * the holiday calendar and any per-date overrides. This runs it over every transcribed month and
 * compares its answer to the pattern the sheet really used.
 *
 * The number it produces matters more than it looks. If the weekday default explains almost every
 * date, *"set up next month"* is one click and a handful of questions. If it explains two thirds, the
 * admin has to touch a third of the month by hand every time and the feature is not worth much. That
 * is a product question, and nobody had measured it.
 *
 * **Prints, never fails the gate.** A deviation from the default is not a defect — a per-date
 * override is a `[CONFIRMED]` requirement, and the practice exercising it is the system working. The
 * one thing worth checking mechanically is that the resolver never confidently resolves a holiday
 * Friday, and `lib/calendar/pattern-precedence.test.ts` pins that.
 *
 * Run with:
 *   npm run seed:patterns
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { SeedMonthDocument } from '../lib/analytics/seed-period.ts';
import { dayOfWeek } from '../lib/analytics/shifts.ts';
import { holidayLookup, SOURCED_DECLARATIONS } from '../lib/calendar/holidays.ts';
import {
  PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
  PILOT_HOLIDAY_SUSPENDS_V1,
  PILOT_WEEKDAY_DEFAULTS_V1,
  resolvePattern,
} from '../lib/calendar/pattern-precedence.ts';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface SeedDayLike {
  readonly date: string;
  readonly patternId: string;
  readonly isPublicHoliday?: boolean;
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

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

async function main(): Promise<void> {
  const found = await findSeedDirectory(process.argv[2]);
  if (found === null) {
    console.log(
      'analyse-pattern-precedence: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data',
    );
    return;
  }

  const days: SeedDayLike[] = [];
  for (const file of found.files) {
    const document = JSON.parse(
      await readFile(path.join(found.dir, file), 'utf8'),
    ) as SeedMonthDocument;
    days.push(...(document.days as unknown as SeedDayLike[]));
  }
  days.sort((left, right) => left.date.localeCompare(right.date));

  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    console.log('analyse-pattern-precedence: no days to analyse.');
    return;
  }

  const config = {
    weekdayDefaults: PILOT_WEEKDAY_DEFAULTS_V1,
    holidaySuspends: PILOT_HOLIDAY_SUSPENDS_V1,
    suggestWhenUndetermined: PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
    holidays: holidayLookup(first.date, last.date, SOURCED_DECLARATIONS),
  };

  let agreed = 0;
  const disagreements: { date: string; weekday: string; expected: string; actual: string }[] = [];
  const decisions: { date: string; weekday: string; actual: string; holiday: string }[] = [];
  const actualForDecisions = new Map<string, number>();

  for (const day of days) {
    const resolved = resolvePattern(day.date, config);
    const weekday = WEEKDAY_NAMES[dayOfWeek(day.date)] ?? '???';

    if (resolved.needsDecision) {
      decisions.push({
        date: day.date,
        weekday,
        actual: day.patternId,
        holiday: resolved.holidayName ?? '',
      });
      actualForDecisions.set(day.patternId, (actualForDecisions.get(day.patternId) ?? 0) + 1);
      continue;
    }
    if (resolved.patternId === day.patternId) {
      agreed += 1;
      continue;
    }
    disagreements.push({
      date: day.date,
      weekday,
      expected: resolved.patternId ?? '(none)',
      actual: day.patternId,
    });
  }

  const total = days.length;
  const share = (count: number): string => `${((count / total) * 100).toFixed(1)}%`;

  console.log(
    `analyse-pattern-precedence: ${String(found.files.length)} month(s) from ${found.dir}, ` +
      `${String(total)} day(s), ${first.date} .. ${last.date}`,
  );
  console.log('');
  console.log(`  weekday default was correct    ${String(agreed).padStart(5)}  ${share(agreed)}`);
  console.log(
    `  needed a human decision        ${String(decisions.length).padStart(5)}  ${share(decisions.length)}`,
  );
  console.log(
    `  practice chose something else  ${String(disagreements.length).padStart(5)}  ${share(disagreements.length)}`,
  );
  console.log('');
  console.log(
    '  So "set up next month" starts with ' +
      `${share(agreed)} of dates already right, and asks about ` +
      `${String(decisions.length)} date(s) across ${String(found.files.length)} months.`,
  );

  if (decisions.length > 0) {
    console.log('');
    console.log('  Dates the resolver refuses to guess — a public holiday dropping Pattern B:');
    for (const entry of decisions) {
      console.log(
        `    ${entry.date}  ${entry.weekday}  the sheet used ${entry.actual}   ${entry.holiday}`,
      );
    }
    const spread = [...actualForDecisions].sort();
    const [top] = spread;
    console.log(
      `    → the practice chose ${spread.map(([id, n]) => `${id}×${String(n)}`).join(', ')}.` +
        (spread.length === 1 && top !== undefined
          ? ` Unanimous — so pattern ${PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1} is pre-selected in the` +
            ' prompt, and still not applied. Eight observations with no counterexample is the same' +
            ' evidence H-05, H-06 and H-07 were each written from, and the primary source later' +
            ' falsified all three.'
          : ' Mixed — so there is nothing to pre-select and the prompt asks outright.'),
    );
  }

  if (disagreements.length > 0) {
    console.log('');
    console.log('  Dates the practice ran differently from the weekday default:');
    const byShape = new Map<string, number>();
    for (const entry of disagreements) {
      const shape = `${entry.weekday} ${entry.expected} → ${entry.actual}`;
      byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
    }
    for (const [shape, count] of [...byShape].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${pad(shape, 20)} ${String(count).padStart(4)}`);
    }
    console.log('');
    for (const entry of disagreements.slice(0, 20)) {
      console.log(
        `    ${entry.date}  ${entry.weekday}  default ${entry.expected}, sheet used ${entry.actual}`,
      );
    }
    if (disagreements.length > 20) {
      console.log(`    … and ${String(disagreements.length - 20)} more`);
    }
  }
  console.log('');
}

await main();
