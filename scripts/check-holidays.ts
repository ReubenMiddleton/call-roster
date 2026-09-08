/**
 * Reconciles the transcribed history's public-holiday flags against the computed calendar.
 *
 * Until now the `isPublicHoliday` flag on every transcribed day was **hand-typed and unchecked**:
 * nothing in the gate compared it to anything, and no analytics module read it. Thirty-three months
 * of hand-tagging with no check is exactly where a silent error lives, and the error is expensive —
 * `classifyDay` turns the flag into a burden weight, so a missed holiday under-credits whoever
 * worked it, permanently, in the one number the product exists to get right.
 *
 * So: `lib/calendar/holidays.ts` computes the calendar from the Act, and this script asserts the
 * transcription agrees with it. It found four disagreements the first time it ran, described in
 * `docs/DECISIONS.md`.
 *
 * ## What counts as a failure
 *
 * A date the calendar calls a holiday and the sheet does not, or the reverse. Names are compared as
 * a **warning** only — a sheet may abbreviate, and a name mismatch cannot corrupt a burden weight.
 *
 * {@link ACCEPTED_DIVERGENCES} is the escape hatch, and it is deliberately narrow: each entry needs
 * a reason and an open question. It exists so a divergence that genuinely needs the owner's eyes
 * does not either block the gate or get silently "corrected" into the historical record.
 *
 * Run with:
 *   npm run seed:holidays
 *
 * **Fails loudly**, like `check-export-layout.ts` and for the same reason: a wrong holiday flag
 * still prints, and still adds up.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { SeedMonthDocument } from '../lib/analytics/seed-period.ts';
import { holidayLookup, SOURCED_DECLARATIONS } from '../lib/calendar/holidays.ts';

/**
 * Divergences between the sheet and the calendar that are accepted for now, each with the reason
 * and the open question that will settle it.
 *
 * **Not a place to park an inconvenient failure.** A divergence belongs here only when the correct
 * value is a question for a human rather than a fact the Act settles.
 */
const ACCEPTED_DIVERGENCES: readonly {
  readonly date: string;
  readonly reason: string;
  readonly question: string;
}[] = [
  {
    date: '2023-12-15',
    reason:
      'Declared a public holiday nationally after the Rugby World Cup, per docs/domain/holidays.md, ' +
      'but not flagged on the transcribed sheet. It is a Friday, so unlike the two Sunday cases ' +
      'flagging it WOULD change the burden weight of a real shift. The December 2023 sheet is not ' +
      'in private/source-artifacts/, so the flag cannot be checked against the source here.',
    question: 'Q40',
  },
];

interface SeedDayLike {
  readonly date: string;
  readonly isPublicHoliday?: boolean;
  readonly holidayName?: string;
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
  const requested = process.argv[2];
  const found = await findSeedDirectory(requested);
  if (found === null) {
    console.log(
      'check-holidays: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data',
    );
    return;
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  const accepted = new Map(ACCEPTED_DIVERGENCES.map((entry) => [entry.date, entry]));
  const seenAccepted = new Set<string>();
  let daysChecked = 0;
  let holidaysMatched = 0;

  for (const file of found.files) {
    const raw = await readFile(path.join(found.dir, file), 'utf8');
    const document = JSON.parse(raw) as SeedMonthDocument;

    // Spill days are the adjacent-month cells the sheet prints to fill its first and last week.
    // They carry flags too, and a holiday in a spill cell is printed red like any other.
    const days = [
      ...(document.days as unknown as SeedDayLike[]),
      ...((document.spillDays ?? []) as unknown as SeedDayLike[]),
    ];
    if (days.length === 0) {
      continue;
    }

    const sorted = [...days].sort((left, right) => left.date.localeCompare(right.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }
    const calendar = holidayLookup(first.date, last.date, SOURCED_DECLARATIONS);

    for (const day of days) {
      daysChecked += 1;
      const computed = calendar.get(day.date);
      const flagged = day.isPublicHoliday === true;
      const isHoliday = computed !== undefined;

      if (flagged === isHoliday) {
        if (isHoliday) {
          holidaysMatched += 1;
          if (day.holidayName !== undefined && day.holidayName !== computed.name) {
            warnings.push(
              `${file} ${day.date}: sheet says "${day.holidayName}", calendar says "${computed.name}".`,
            );
          }
        }
        continue;
      }

      const excuse = accepted.get(day.date);
      if (excuse !== undefined) {
        seenAccepted.add(day.date);
        warnings.push(
          `${file} ${day.date}: accepted divergence (${excuse.question}) — ` +
            (isHoliday
              ? `the calendar has "${computed.name}" and the sheet does not flag it.`
              : 'the sheet flags it and the calendar does not.'),
        );
        continue;
      }

      problems.push(
        isHoliday
          ? `${file} ${day.date}: the calendar has "${computed.name}" (${computed.origin}) but the ` +
              'sheet does not flag it. A missed holiday under-credits whoever worked it.'
          : `${file} ${day.date}: the sheet flags a public holiday but the calendar has none. ` +
              'Either the date is a declaration missing from SOURCED_DECLARATIONS, or the flag is wrong.',
      );
    }
  }

  console.log(`check-holidays: ${String(found.files.length)} month(s) from ${found.dir}`);
  console.log(
    `  ${String(daysChecked)} day(s) checked, ${String(holidaysMatched)} public holiday(s) agreed with the Act.`,
  );

  const stale = ACCEPTED_DIVERGENCES.filter((entry) => !seenAccepted.has(entry.date));
  if (stale.length > 0 && found.dir === 'private/seed-data') {
    // An accepted divergence that no longer fires is a stale exemption, and a stale exemption is
    // how a real failure gets hidden later. Only assert this against the real data — the synthetic
    // fixture has no reason to contain the same dates.
    for (const entry of stale) {
      problems.push(
        `${entry.date} is listed in ACCEPTED_DIVERGENCES but no longer diverges. Remove it, and ` +
          `close ${entry.question}.`,
      );
    }
  }

  if (warnings.length > 0) {
    console.log('');
    for (const warning of warnings) {
      console.log(`  ~ ${warning}`);
    }
  }

  if (problems.length > 0) {
    console.error('');
    console.error(`check-holidays: ${String(problems.length)} problem(s):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('  no unexplained disagreements.');
  console.log('');
}

await main();
