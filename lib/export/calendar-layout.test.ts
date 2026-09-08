/**
 * Layout tests for the printable month grid.
 *
 * The specific cases below are the real sheets, chosen because each exercises something the naive
 * implementation gets wrong. Where a date and a cell position are asserted together, that pairing was
 * read off a photographed export rather than reasoned about.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COLUMNS, type LayoutDay, layoutMonth, MAX_WEEK_ROWS } from './calendar-layout.ts';

/** A day with the practice's ordinary three shifts. */
function ordinary(date: string): LayoutDay {
  return {
    date,
    lines: [
      { doctor: 'S01', time: '7-15' },
      { doctor: 'S02', time: '15-23' },
      { doctor: 'S03', time: '23-7' },
    ],
  };
}

function fullMonth(month: string, days: number): LayoutDay[] {
  return Array.from({ length: days }, (_, index) =>
    ordinary(`${month}-${String(index + 1).padStart(2, '0')}`),
  );
}

/** Finds the cell holding a date, as [row, column], or null. */
function locate(grid: ReturnType<typeof layoutMonth>, date: string): [number, number] | null {
  for (const [row, week] of grid.weeks.entries()) {
    for (const [column, cell] of week.entries()) {
      if (cell?.date === date) {
        return [row, column];
      }
    }
  }
  return null;
}

describe('the five-row rule', () => {
  it('never prints a sixth row, for any month in a four-year span', () => {
    // A Sunday-start calendar needs six rows for ten of these forty-eight months. The practice
    // never prints one, so neither may the export: a sixth row changes the row height, which
    // changes whether the grid fits a page.
    for (let year = 2023; year <= 2026; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const label = `${String(year)}-${String(month).padStart(2, '0')}`;
        const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const grid = layoutMonth({ month: label, days: fullMonth(label, days) });
        expect(grid.weeks.length, `${label} row count`).toBeLessThanOrEqual(MAX_WEEK_ROWS);
        for (const week of grid.weeks) {
          expect(week).toHaveLength(COLUMNS);
        }
      }
    }
  });

  it('places every day of the month exactly once, whatever the shape', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2023, max: 2030 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const label = `${String(year)}-${String(month).padStart(2, '0')}`;
          const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
          const grid = layoutMonth({ month: label, days: fullMonth(label, total) });

          const seen = grid.weeks
            .flat()
            .filter((cell) => cell !== null)
            .map((cell) => cell.date);
          expect(new Set(seen).size, `${label} unique dates`).toBe(total);
          expect(seen.length, `${label} total cells`).toBe(total);
        },
      ),
    );
  });
});

describe('wrapping, against the real sheets', () => {
  it('March 2025 prints 30 and 31 in row one, Sunday and Monday', () => {
    // Read off the photographed sheet. 1 March 2025 is a Saturday, so the natural layout needs six
    // rows; the practice wraps the last two days into the leading empties instead.
    const grid = layoutMonth({ month: '2025-03', days: fullMonth('2025-03', 31) });

    expect(grid.wrapped).toBe(true);
    expect(locate(grid, '2025-03-30')).toEqual([0, 0]); // row 1, Sunday
    expect(locate(grid, '2025-03-31')).toEqual([0, 1]); // row 1, Monday
    // And the 1st is still in its natural Saturday position.
    expect(locate(grid, '2025-03-01')).toEqual([0, 6]);
  });

  it('June 2024 wraps only the 30th', () => {
    const grid = layoutMonth({ month: '2024-06', days: fullMonth('2024-06', 30) });
    expect(grid.wrapped).toBe(true);
    expect(locate(grid, '2024-06-30')).toEqual([0, 0]);
    expect(locate(grid, '2024-06-29')).not.toEqual([0, 1]); // 29th stays in its own place
  });

  it('labels a wrapped day with a plain number, not a month name', () => {
    // A wrapped day still belongs to this month, so it prints like any other day. Only spill days
    // carry a month name, which is how the sheets disambiguate them.
    const grid = layoutMonth({ month: '2025-03', days: fullMonth('2025-03', 31) });
    const cell = grid.weeks[0]?.[0];
    expect(cell?.kind).toBe('wrapped');
    expect(cell?.label).toBe('30');
  });

  it('does not wrap a month that already fits', () => {
    // 1 December 2025 is a Monday: 1 leading empty + 31 days = 32 cells, five rows exactly.
    const grid = layoutMonth({ month: '2025-12', days: fullMonth('2025-12', 31) });
    expect(grid.wrapped).toBe(false);
    expect(locate(grid, '2025-12-31')).toEqual([4, 3]);
  });
});

describe('spill days', () => {
  it('December 2023 shows a wrapped own-day and a spill side by side', () => {
    // The case that forced wrapping and spilling to be computed together. 1 December 2023 is a
    // Friday, so the month needs six rows: 31 December wraps into row one's Sunday, and 1 January
    // follows it in Monday. Both were read off the sheet.
    const grid = layoutMonth({
      month: '2023-12',
      days: fullMonth('2023-12', 31),
      spillDays: [ordinary('2024-01-01')],
    });

    expect(grid.wrapped).toBe(true);
    expect(locate(grid, '2023-12-31')).toEqual([0, 0]);
    expect(locate(grid, '2024-01-01')).toEqual([0, 1]);
    expect(grid.weeks[0]?.[0]?.kind).toBe('wrapped');
    expect(grid.weeks[0]?.[1]?.kind).toBe('spill');
  });

  it('labels a spill day with its month, as the sheets do', () => {
    const grid = layoutMonth({
      month: '2023-12',
      days: fullMonth('2023-12', 31),
      spillDays: [ordinary('2024-01-01')],
    });
    expect(grid.weeks[0]?.[1]?.label).toBe('1 Jan');
  });

  it('places a spill day in the column of its real weekday', () => {
    // 1 September 2024 is a Sunday, and the August 2024 sheet prints it in the Sunday column.
    // Putting it anywhere else would misprint the calendar.
    const grid = layoutMonth({
      month: '2024-08',
      days: fullMonth('2024-08', 31),
      spillDays: [ordinary('2024-09-01')],
    });
    const at = locate(grid, '2024-09-01');
    expect(at?.[1]).toBe(0); // Sunday column
  });

  it('still places a spill correctly in a wrapped month', () => {
    // A wrapped March 2025 leaves Tuesday through Friday of row one free, so 1 April - a Tuesday -
    // lands in row one's Tuesday cell. Which is calendar-correct: it follows 31 March, wrapped
    // into Monday. An earlier version of this test assumed the cell was taken; it is not.
    const grid = layoutMonth({
      month: '2025-03',
      days: fullMonth('2025-03', 31),
      spillDays: [ordinary('2025-04-01')],
    });
    expect(locate(grid, '2025-04-01')).toEqual([0, 2]); // row 1, Tuesday
    expect(grid.weeks[0]?.[2]?.label).toBe('1 April');
  });

  it('drops a spill rather than moving it to the wrong column', () => {
    // A defensive guard rather than a real scenario - no ordinary month seems to reach it. March
    // 2026 starts on a Sunday with 31 days, so all five Sunday cells are occupied; a Sunday spill
    // has nowhere legitimate to go. Printing it in another column would misalign the calendar,
    // which is worse than omitting it.
    const grid = layoutMonth({
      month: '2026-03',
      days: fullMonth('2026-03', 31),
      spillDays: [ordinary('2026-04-05')], // a Sunday
    });
    expect(locate(grid, '2026-04-05')).toBeNull();
  });
});

describe('cell contents', () => {
  it('puts a gap before the night shift, on every day', () => {
    // Every one of the nineteen sheets separates the 23:00 line with a blank line. It reads as
    // dividing the day from the night and it matters at print size.
    const grid = layoutMonth({ month: '2025-02', days: fullMonth('2025-02', 28) });
    const cell = grid.weeks[0]?.[6]; // 1 February 2025 is a Saturday
    expect(cell?.lines.map((line) => line.gapBefore)).toEqual([false, false, true]);
  });

  it('detects the night shift from the printed time, not a shift id', () => {
    // The gap is a property of what the sheet shows. A tenant whose night shift is called
    // something else still gets the gap, as long as it starts at 23:00.
    const grid = layoutMonth({
      month: '2025-02',
      days: [
        {
          date: '2025-02-01',
          lines: [
            { doctor: 'S01', time: '7-17' },
            { doctor: 'S02', time: '17-23' },
            { doctor: 'S03', time: '23-7' },
          ],
        },
      ],
    });
    const lines = grid.weeks[0]?.[6]?.lines ?? [];
    expect(lines.map((line) => line.gapBefore)).toEqual([false, false, true]);
  });

  it('renders a date with no assignments as an empty cell rather than omitting it', () => {
    // Two Saturdays in December 2024 have a night shift time with no doctor against it. The grid
    // must still print the date; a missing cell would shift every later day by one.
    const grid = layoutMonth({
      month: '2025-02',
      days: [{ date: '2025-02-01', lines: [] }],
    });
    const cell = grid.weeks[0]?.[6];
    expect(cell).not.toBeNull();
    expect(cell?.date).toBe('2025-02-01');
    expect(cell?.lines).toEqual([]);
  });

  it('carries a holiday name through for the renderer to mark', () => {
    const grid = layoutMonth({
      month: '2025-05',
      days: [{ date: '2025-05-01', holidayName: "Workers' Day", lines: [] }],
    });
    expect(locate(grid, '2025-05-01')).toEqual([0, 4]); // 1 May 2025 is a Thursday
    expect(grid.weeks[0]?.[4]?.holidayName).toBe("Workers' Day");
  });
});

describe('trailing empty rows', () => {
  it('drops a row that would print blank', () => {
    // February 2026 starts on a Sunday with 28 days: four rows exactly. Printing a blank fifth
    // changes the row height and so changes whether the grid fits one page.
    const grid = layoutMonth({ month: '2026-02', days: fullMonth('2026-02', 28) });
    expect(grid.weeks).toHaveLength(4);
  });

  it('keeps a row that has any content at all', () => {
    const grid = layoutMonth({ month: '2025-12', days: fullMonth('2025-12', 31) });
    expect(grid.weeks).toHaveLength(5);
  });
});

describe('input validation', () => {
  it('rejects a malformed month', () => {
    expect(() => layoutMonth({ month: '2025', days: [] })).toThrow(/not an ISO month/);
    expect(() => layoutMonth({ month: '2025-13', days: [] })).toThrow(/not an ISO month/);
  });
});
