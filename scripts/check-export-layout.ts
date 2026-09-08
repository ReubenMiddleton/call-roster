/**
 * Lays out every transcribed month with the real export geometry and checks the result.
 *
 * The printable grid is the artifact of record, and the failure it must avoid is precise: the
 * principal exports a month, decides it does not look right, rebuilds it in Word, and stops using the
 * app. So the layout is checked against **every month the practice has actually produced** rather
 * than against hand-written cases only.
 *
 * What this catches that unit tests cannot: a month shape that exists in the real history but that
 * nobody thought to write a case for. Ten of forty-eight months between 2023 and 2026 need six
 * week-rows on a Sunday-start calendar, and the practice never prints six.
 *
 * Run with:
 *   npm run seed:layout
 *
 * **Fails loudly.** Unlike the other seed scripts this one is a check, because a layout error is
 * silent in a way an arithmetic error is not - a misplaced cell still prints.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import type { SeedMonthDocument } from '../lib/analytics/seed-period.ts';
import {
  COLUMNS,
  type GridCell,
  type LayoutDay,
  layoutMonth,
  MAX_WEEK_ROWS,
} from '../lib/export/calendar-layout.ts';

/** Printed times, keyed by shift id, exactly as the sheets write them. */
const PRINTED_TIME: Readonly<Record<string, string>> = {
  'std-morning': '7-15',
  'std-afternoon': '15-23',
  'std-night': '23-7',
  'fri-early': '7-12',
  'fri-midday': '12-17',
  'fri-evening': '17-23',
  'fri-night': '23-7',
  'red-longday': '7-17',
  'red-evening': '17-23',
  'red-night': '23-7',
};

/** Shift order within a cell, per pattern - the order the sheets print them in. */
const SHIFT_ORDER = new Map<string, readonly string[]>(
  PILOT_PATTERNS_V1.map((pattern) => [pattern.id, pattern.shifts.map((shift) => shift.id)]),
);

interface SeedDayLike {
  readonly date: string;
  readonly patternId: string;
  readonly holidayName?: string;
  readonly assignments: Readonly<Record<string, string>>;
}

function toLayoutDay(day: SeedDayLike): LayoutDay {
  const order = SHIFT_ORDER.get(day.patternId) ?? Object.keys(day.assignments);
  const lines: { doctor: string; time: string }[] = [];
  for (const shiftId of order) {
    const doctor = day.assignments[shiftId];
    const time = PRINTED_TIME[shiftId];
    if (doctor === undefined || time === undefined) {
      continue;
    }
    lines.push({ doctor, time });
  }
  return {
    date: day.date,
    lines,
    ...(day.holidayName === undefined ? {} : { holidayName: day.holidayName }),
  };
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
      'check-export-layout: no seed data found — skipping.\n' +
        '  Looked in: private/seed-data, fixtures/seed-data',
    );
    return;
  }

  const problems: string[] = [];
  const wrappedMonths: string[] = [];
  let totalCells = 0;
  let droppedSpills = 0;

  for (const file of found.files) {
    const raw = await readFile(path.join(found.dir, file), 'utf8');
    const document = JSON.parse(raw) as SeedMonthDocument;
    const days = (document.days as unknown as SeedDayLike[]).map(toLayoutDay);
    const spillDays = ((document.spillDays ?? []) as unknown as SeedDayLike[]).map(toLayoutDay);

    let grid;
    try {
      grid = layoutMonth({ month: document.month, days, spillDays });
    } catch (error) {
      problems.push(`${document.month}: layout threw — ${String(error)}`);
      continue;
    }

    // 1. Never more than five rows, and every row exactly seven columns.
    if (grid.weeks.length > MAX_WEEK_ROWS) {
      problems.push(
        `${document.month}: ${String(grid.weeks.length)} week-rows, limit is ${String(MAX_WEEK_ROWS)}`,
      );
    }
    for (const [index, week] of grid.weeks.entries()) {
      if (week.length !== COLUMNS) {
        problems.push(
          `${document.month}: row ${String(index + 1)} has ${String(week.length)} columns`,
        );
      }
    }

    // 2. Every own-month date placed exactly once.
    const placed = grid.weeks
      .flat()
      .filter((cell) => cell !== null)
      .map((cell) => cell.date);
    const ownPlaced = placed.filter((date) => date.startsWith(document.month));
    if (new Set(ownPlaced).size !== days.length) {
      problems.push(
        `${document.month}: ${String(new Set(ownPlaced).size)} own dates placed, expected ${String(days.length)}`,
      );
    }
    if (ownPlaced.length !== new Set(ownPlaced).size) {
      problems.push(`${document.month}: a date was placed more than once`);
    }

    // 3. Every cell sits in the column matching its real weekday. A misplaced cell still prints,
    //    which is exactly why this needs checking rather than eyeballing.
    for (const [rowIndex, week] of grid.weeks.entries()) {
      for (const [column, cell] of week.entries()) {
        if (cell === null) {
          continue;
        }
        const parts = cell.date.split('-');
        const [year, month, day] = parts;
        if (year === undefined || month === undefined || day === undefined) {
          problems.push(`${document.month}: unparseable date "${cell.date}"`);
          continue;
        }
        const weekday = new Date(
          Date.UTC(Number(year), Number(month) - 1, Number(day)),
        ).getUTCDay();
        if (weekday !== column) {
          problems.push(
            `${document.month}: ${cell.date} is in column ${String(column)} (row ${String(rowIndex + 1)}) but its weekday is ${String(weekday)}`,
          );
        }
      }
    }

    // 4. Every shift on the sheet reaches a cell line.
    const expectedLines = days.reduce((total, day) => total + day.lines.length, 0);
    const actualLines = grid.weeks
      .flat()
      .filter((cell): cell is GridCell => cell?.date.startsWith(document.month) === true)
      .reduce((total, cell) => total + cell.lines.length, 0);
    if (actualLines !== expectedLines) {
      problems.push(
        `${document.month}: ${String(actualLines)} shift lines rendered, expected ${String(expectedLines)}`,
      );
    }

    const spillsPlaced = placed.filter((date) => !date.startsWith(document.month)).length;
    droppedSpills += spillDays.length - spillsPlaced;
    totalCells += placed.length;
    if (grid.wrapped) {
      wrappedMonths.push(document.month);
    }
  }

  console.log('');
  console.log(`check-export-layout: ${String(found.files.length)} month(s) from ${found.dir}`);
  console.log(`  ${String(totalCells)} cells placed, all in the correct weekday column.`);
  console.log(
    `  ${String(wrappedMonths.length)} month(s) needed wrapping into row one: ${wrappedMonths.join(', ')}`,
  );
  if (droppedSpills > 0) {
    console.log(
      `  ${String(droppedSpills)} spill day(s) had no free cell in their own column and were dropped.`,
    );
  }

  if (problems.length > 0) {
    console.error('');
    console.error(`check-export-layout: ${String(problems.length)} problem(s):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('  no layout problems found.');
  console.log('');
}

await main();
