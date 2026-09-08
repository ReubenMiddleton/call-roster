import { describe, expect, it } from 'vitest';
import { AGREED_BURDEN_V2, resolveBurden } from './burden.ts';
import {
  classifyDay,
  dayOfWeek,
  inclusiveDayCount,
  indexShifts,
  isWeekendShift,
  patternHours,
  PILOT_PATTERNS_V1,
} from './shifts.ts';
import type { DayClass, RosterDay, ShiftDefinition, ShiftPattern } from './types.ts';

describe('dayOfWeek', () => {
  it('reads weekdays in UTC regardless of the host timezone', () => {
    // 2025-12-25 was a Thursday; 2026-01-01 a Thursday; 2025-12-28 a Sunday.
    expect(dayOfWeek('2025-12-25')).toBe(4);
    expect(dayOfWeek('2026-01-01')).toBe(4);
    expect(dayOfWeek('2025-12-28')).toBe(0);
    expect(dayOfWeek('2025-12-27')).toBe(6);
  });

  it('rejects anything that is not an ISO date', () => {
    expect(() => dayOfWeek('25/12/2025')).toThrow(/not an ISO date/);
    expect(() => dayOfWeek('2025-12')).toThrow(/not an ISO date/);
    expect(() => dayOfWeek('')).toThrow(/not an ISO date/);
  });
});

describe('classifyDay', () => {
  it('classifies ordinary weekdays, Saturdays and Sundays', () => {
    expect(classifyDay('2025-12-24', false)).toBe('weekday');
    expect(classifyDay('2025-12-27', false)).toBe('saturday');
    expect(classifyDay('2025-12-28', false)).toBe('sunday');
  });

  it('lets Saturday and Sunday outrank a public holiday', () => {
    // Reversed on 2026-08-31. Asked whether a holiday falling on a Saturday counts once or twice,
    // the principal answered: "it counts once as a Saturday, not a Saturday and a holiday." So the
    // weight is 3.0 rather than 5.0, and a holiday-on-Saturday roster looks like a Saturday.
    //
    // 2025-12-27 is a Saturday, 2025-12-28 a Sunday, 2025-12-25 a Thursday.
    expect(classifyDay('2025-12-27', true)).toBe('saturday');
    expect(classifyDay('2025-12-28', true)).toBe('sunday');
    // A holiday on a weekday is still a holiday.
    expect(classifyDay('2025-12-25', true)).toBe('public-holiday');
  });
});

describe('the pilot pattern catalogue', () => {
  it('has every pattern summing to exactly 24 hours', () => {
    // The same invariant scripts/validate-seed-data.mjs enforces on the transcribed sheets. A
    // pattern that does not sum to 24 means a coverage gap on a 24/7 single-cover roster.
    for (const pattern of PILOT_PATTERNS_V1) {
      expect(patternHours(pattern), `pattern ${pattern.id}`).toBe(24);
    }
  });

  it('gives every shift a unique id across patterns', () => {
    const index = indexShifts(PILOT_PATTERNS_V1);
    const declared = PILOT_PATTERNS_V1.flatMap((pattern) => pattern.shifts);
    expect(index.size).toBe(declared.length);
  });

  it('has exactly one night shift per pattern', () => {
    for (const pattern of PILOT_PATTERNS_V1) {
      const nights = pattern.shifts.filter((shift) => shift.kind === 'night');
      expect(nights, `pattern ${pattern.id}`).toHaveLength(1);
    }
  });
});

describe('indexShifts', () => {
  it('throws when two patterns reuse one shift id', () => {
    // Left to merge silently, std-night from pattern A and pattern B would be
    // indistinguishable in the ledger and one of them would be credited at the other's weight.
    const clashing: ShiftPattern[] = [
      {
        id: 'A',
        shifts: [{ id: 'night', patternId: 'A', startHour: 23, hours: 8, kind: 'night' }],
      },
      {
        id: 'B',
        shifts: [{ id: 'night', patternId: 'B', startHour: 23, hours: 8, kind: 'night' }],
      },
    ];
    expect(() => indexShifts(clashing)).toThrow(/defined in both pattern/);
  });
});

describe('inclusiveDayCount', () => {
  it('counts both ends', () => {
    expect(inclusiveDayCount('2025-12-01', '2025-12-01')).toBe(1);
    expect(inclusiveDayCount('2025-12-01', '2025-12-31')).toBe(31);
  });

  it('crosses month and year boundaries', () => {
    expect(inclusiveDayCount('2025-12-31', '2026-01-01')).toBe(2);
    expect(inclusiveDayCount('2025-01-01', '2025-12-31')).toBe(365);
    // 2024 was a leap year.
    expect(inclusiveDayCount('2024-01-01', '2024-12-31')).toBe(366);
  });
});

describe('isWeekendShift', () => {
  const day = (date: string, dayClass: DayClass, patternId = 'A'): RosterDay => ({
    date,
    patternId,
    dayClass,
  });
  const slot = (id: string): ShiftDefinition => {
    for (const pattern of PILOT_PATTERNS_V1) {
      const found = pattern.shifts.find((candidate) => candidate.id === id);
      if (found !== undefined) {
        return found;
      }
    }
    throw new Error(`test fixture error: no shift "${id}"`);
  };

  it('starts the weekend at Friday 17:00, per the practice', () => {
    // [CONFIRMED 2026-08-31]: "weekend starts at Friday 17:00". 2025-12-05 is a Friday.
    const friday = day('2025-12-05', 'weekday', 'B');
    expect(isWeekendShift(friday, slot('fri-early'))).toBe(false); // starts 07:00
    expect(isWeekendShift(friday, slot('fri-midday'))).toBe(false); // starts 12:00
    expect(isWeekendShift(friday, slot('fri-evening'))).toBe(true); // starts 17:00
    expect(isWeekendShift(friday, slot('fri-night'))).toBe(true); // starts 23:00
  });

  it('counts all of Saturday and Sunday', () => {
    expect(isWeekendShift(day('2025-12-06', 'saturday'), slot('std-morning'))).toBe(true);
    expect(isWeekendShift(day('2025-12-07', 'sunday'), slot('std-morning'))).toBe(true);
  });

  it('does not count an ordinary weekday, or a weekday public holiday', () => {
    expect(isWeekendShift(day('2025-12-02', 'weekday'), slot('std-night'))).toBe(false);
    // 16 December 2025 is a Tuesday public holiday. A holiday is not weekend work.
    expect(isWeekendShift(day('2025-12-16', 'public-holiday'), slot('std-morning'))).toBe(false);
  });

  it('agrees with the burden table on Friday, but stays a separate mechanism', () => {
    // Question W was answered on 2026-09-04: Friday from 17:00 is weekend work and prices at 3.0.
    // So the two now AGREE on the back half — but they are still separate mechanisms and must not
    // be wired together, because they disagree on the front half by design.
    const friday = day('2025-12-05', 'weekday', 'B');

    expect(isWeekendShift(friday, slot('fri-night'))).toBe(true);
    expect(resolveBurden(friday, slot('fri-night'), AGREED_BURDEN_V2).weight).toBe(3);

    // The front half is neither weekend nor repriced — `fri-early` starts at 07:00.
    expect(isWeekendShift(friday, slot('fri-early'))).toBe(false);
    expect(resolveBurden(friday, slot('fri-early'), AGREED_BURDEN_V2).weight).toBe(1);
  });
});
