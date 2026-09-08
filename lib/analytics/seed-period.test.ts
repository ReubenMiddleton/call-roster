import { describe, expect, it } from 'vitest';
import { AGREED_BURDEN_V2 } from './burden.ts';
import { buildLedger } from './ledger.ts';
import { loadSeedPeriod, type SeedMonthDocument, splitByMonth } from './seed-period.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';

/** A December sheet with a January spill, mirroring the real transcription format. */
const december: SeedMonthDocument = {
  month: '2025-12',
  days: [
    {
      date: '2025-12-25',
      patternId: 'A',
      isPublicHoliday: true,
      holidayName: 'Christmas Day',
      assignments: { 'std-morning': 'S01', 'std-afternoon': 'S02', 'std-night': 'S03' },
    },
    {
      date: '2025-12-31',
      patternId: 'C',
      assignments: { 'red-longday': 'S01', 'red-evening': 'S02', 'red-night': 'S03' },
    },
  ],
  spillDays: [
    {
      date: '2026-01-01',
      patternId: 'A',
      isPublicHoliday: true,
      holidayName: "New Year's Day",
      assignments: { 'std-morning': 'S04', 'std-afternoon': 'S05', 'std-night': 'S01' },
    },
  ],
};

/** The January sheet, which owns 1 January and names a different doctor on the night. */
const january: SeedMonthDocument = {
  month: '2026-01',
  days: [
    {
      date: '2026-01-01',
      patternId: 'A',
      isPublicHoliday: true,
      holidayName: "New Year's Day",
      assignments: { 'std-morning': 'S04', 'std-afternoon': 'S05', 'std-night': 'S02' },
    },
  ],
};

describe('loadSeedPeriod', () => {
  it('excludes spill days by default, so adjacent months do not double-count', () => {
    // The bug this prevents is silent and expensive: every date printed on two sheets would be
    // credited twice, inflating the ledger for whoever happens to work month boundaries.
    const period = loadSeedPeriod([december, january], 'two-months');
    expect(period.days.map((day) => day.date)).toEqual(['2025-12-25', '2025-12-31', '2026-01-01']);
    // Nine assignments, not twelve.
    expect(period.assignments).toHaveLength(9);
  });

  it('lets the owning month win where two sheets disagree', () => {
    // December's spill names S01 on the night of 1 January; January names S02. January owns the
    // date, so January wins — the rule adopted after the real December 2025 and January 2026
    // sheets were found to disagree about exactly this shift.
    const period = loadSeedPeriod([december, january], 'two-months');
    const newYearNight = period.assignments.find(
      (assignment) => assignment.date === '2026-01-01' && assignment.shiftId === 'std-night',
    );
    expect(newYearNight?.doctor).toBe('S02');
  });

  it('throws rather than silently merging when a date appears twice', () => {
    expect(() => loadSeedPeriod([january, january], 'duplicated')).toThrow(/appears twice/);
  });

  it('includes spill days only when explicitly asked', () => {
    const period = loadSeedPeriod([december], 'december', { includeSpillDays: true });
    expect(period.days.map((day) => day.date)).toContain('2026-01-01');
    expect(period.assignments).toHaveLength(9);
  });

  it('marks every historical assignment as unknown provenance', () => {
    // The sheets record who worked, never why. Upgrading this to `directed` would silently
    // assert that no doctor ever asked for extra work.
    const period = loadSeedPeriod([december], 'december');
    expect(period.assignments.every((assignment) => assignment.provenance === 'unknown')).toBe(
      true,
    );
  });

  it('classifies public holidays from the sheet flag', () => {
    const period = loadSeedPeriod([december], 'december');
    const christmas = period.days.find((day) => day.date === '2025-12-25');
    expect(christmas?.dayClass).toBe('public-holiday');
  });

  it('names Christmas and New Year’s Eve so the night shift can be priced separately', () => {
    const period = loadSeedPeriod([december], 'december');
    expect(period.days.find((day) => day.date === '2025-12-25')?.specialDate).toBe('christmas');
    expect(period.days.find((day) => day.date === '2025-12-31')?.specialDate).toBe('new-years-eve');
  });

  it('prices the named nights above the rest of the same day', () => {
    const period = loadSeedPeriod([december], 'december');
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    // S03 works Christmas night (6.0) and New Year's Eve night (6.0).
    const s03 = ledger.entries.find((entry) => entry.doctor === 'S03');
    expect(s03?.burden).toBeCloseTo(12, 10);
    // S01 works Christmas morning (4.0, public holiday) and the 31 December long day
    // (1.5, an ordinary weekday reduced day — 31 December is not a public holiday in SA).
    const s01 = ledger.entries.find((entry) => entry.doctor === 'S01');
    expect(s01?.burden).toBeCloseTo(5.5, 10);
  });

  it('sorts days and assignments by date regardless of input order', () => {
    const period = loadSeedPeriod([january, december], 'out-of-order');
    const dates = period.days.map((day) => day.date);
    expect([...dates].sort()).toEqual(dates);
    const assignmentDates = period.assignments.map((assignment) => assignment.date);
    expect([...assignmentDates].sort()).toEqual(assignmentDates);
  });

  it('tolerates a sheet with no spill days', () => {
    expect(() => loadSeedPeriod([january], 'january')).not.toThrow();
  });
});

describe('splitByMonth', () => {
  it('buckets days and assignments into their own calendar months', () => {
    const period = loadSeedPeriod([december, january], 'two-months');
    const months = splitByMonth(period);
    expect(months.map((month) => month.label)).toEqual(['2025-12', '2026-01']);
    expect(months[0]?.days).toHaveLength(2);
    expect(months[1]?.days).toHaveLength(1);
    expect(months[0]?.assignments).toHaveLength(6);
    expect(months[1]?.assignments).toHaveLength(3);
  });

  it('conserves every day and every assignment', () => {
    const period = loadSeedPeriod([december, january], 'two-months');
    const months = splitByMonth(period);
    const totalDays = months.reduce((count, month) => count + month.days.length, 0);
    const totalAssignments = months.reduce((count, month) => count + month.assignments.length, 0);
    expect(totalDays).toBe(period.days.length);
    expect(totalAssignments).toBe(period.assignments.length);
  });
});
