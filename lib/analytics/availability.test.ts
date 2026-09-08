/**
 * Availability tests.
 *
 * The distinction under test throughout: **availability is hard, a preference is soft.** A pool GP
 * cannot work a Tuesday morning — no penalty weight makes it possible. D03 not working nights is
 * flexible and belongs nowhere near this file.
 */

import { describe, expect, it } from 'vitest';
import {
  canWork,
  type DoctorAvailability,
  groupByTier,
  inferAvailability,
  restrictedEligibility,
  tierOf,
} from './availability.ts';
import { classifyDay, PILOT_PATTERNS_V1 } from './shifts.ts';
import type { Assignment, RosterDay, RosterPeriod, ShiftDefinition } from './types.ts';

const HOUR = 17;

function shift(id: string): ShiftDefinition {
  for (const pattern of PILOT_PATTERNS_V1) {
    const found = pattern.shifts.find((candidate) => candidate.id === id);
    if (found !== undefined) {
      return found;
    }
  }
  throw new Error(`test fixture error: no shift "${id}"`);
}

function day(date: string, isHoliday = false): RosterDay {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    date,
    patternId: weekday === 5 ? 'B' : 'A',
    dayClass: classifyDay(date, isHoliday),
  };
}

function blocked(doctor: string, exceptWeekdays?: readonly number[]): DoctorAvailability {
  return {
    doctor,
    rules: [
      {
        kind: 'no-weekday-before',
        hour: HOUR,
        ...(exceptWeekdays === undefined ? {} : { exceptWeekdays }),
      },
    ],
    evidence: { shiftsObserved: 120, contradictions: 0 },
  };
}

function unrestricted(doctor: string): DoctorAvailability {
  return { doctor, rules: [], evidence: { shiftsObserved: 400, contradictions: 0 } };
}

/** A month of consecutive dates. */
function month(
  from: string,
  count: number,
  holidays: ReadonlySet<string> = new Set(),
): RosterDay[] {
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return day(date, holidays.has(date));
  });
}

describe('canWork', () => {
  // 2025-02-03 Monday, 2025-02-04 Tuesday, 2025-02-01 Saturday, 2025-02-07 Friday.
  it('blocks a weekday shift before the hour', () => {
    expect(canWork(blocked('D06'), day('2025-02-04'), shift('std-morning'))).toBe(false);
    expect(canWork(blocked('D06'), day('2025-02-04'), shift('std-afternoon'))).toBe(false);
  });

  it('allows a weekday shift at or after the hour', () => {
    expect(canWork(blocked('D06'), day('2025-02-04'), shift('std-night'))).toBe(true);
  });

  it('allows the whole weekend', () => {
    expect(canWork(blocked('D06'), day('2025-02-01'), shift('std-morning'))).toBe(true);
    expect(canWork(blocked('D06'), day('2025-02-02'), shift('std-morning'))).toBe(true);
  });

  it('⚠️ exempts a public holiday, because their own practice is closed', () => {
    // The asymmetry that confirmed the MECHANISM rather than merely the pattern: pool doctors work
    // 40 daytime shifts on holidays across 33 months. Baked into the rule rather than left to the
    // caller, because forgetting it would reintroduce the error.
    const holiday = '2025-05-01'; // a Thursday
    expect(canWork(blocked('D06'), day(holiday, false), shift('std-morning'))).toBe(false);
    expect(canWork(blocked('D06'), day(holiday, true), shift('std-morning'))).toBe(true);
  });

  it('honours a weekday exception', () => {
    // The D07/D09 shape: they alternate a Monday 15:00-23:00, the only exceptions in 1,086 pool
    // shifts. 2025-02-03 is a Monday, 2025-02-04 a Tuesday.
    const mondayOnly = blocked('D07', [1]);
    expect(canWork(mondayOnly, day('2025-02-03'), shift('std-afternoon'))).toBe(true);
    expect(canWork(mondayOnly, day('2025-02-04'), shift('std-afternoon'))).toBe(false);
  });

  it('allows everything when there are no rules', () => {
    expect(canWork(unrestricted('D01'), day('2025-02-04'), shift('std-morning'))).toBe(true);
  });

  it('splits Friday at the hour, not at the pattern', () => {
    // Pattern B's 12:00 shift is restricted; its 17:00 shift is not. This is why H-06's "back half
    // is pool-only" was never a rule about who is banned.
    const friday = day('2025-02-07');
    expect(canWork(blocked('D06'), friday, shift('fri-midday'))).toBe(false);
    expect(canWork(blocked('D06'), friday, shift('fri-evening'))).toBe(true);
  });
});

describe('restrictedEligibility', () => {
  const february = month('2025-02-01', 28);

  it('is 1 for a doctor with no restrictions', () => {
    expect(restrictedEligibility(unrestricted('D01'), february, PILOT_PATTERNS_V1, HOUR)).toBe(1);
  });

  it('is 0 for a doctor blocked on every weekday', () => {
    expect(restrictedEligibility(blocked('D06'), february, PILOT_PATTERNS_V1, HOUR)).toBe(0);
  });

  it('⚠️ is about a fifth for a one-weekday exception, not one', () => {
    // The regression test for a real design error. The first version of the tier test was binary
    // and classified anyone with any exception as a full anchor; over the real data that made three
    // pool doctors into anchors and would have UNDERSTATED the capacity pressure.
    const eligibility = restrictedEligibility(
      blocked('D07', [1]),
      february,
      PILOT_PATTERNS_V1,
      HOUR,
    );
    expect(eligibility).toBeGreaterThan(0.1);
    expect(eligibility).toBeLessThan(0.3);
  });

  it('is 0 for a period with no restricted slots at all', () => {
    // A fortnight of weekends. Dividing by zero here would produce NaN and poison the forecast.
    const weekendsOnly = [day('2025-02-01'), day('2025-02-02'), day('2025-02-08')];
    expect(restrictedEligibility(unrestricted('D01'), weekendsOnly, PILOT_PATTERNS_V1, HOUR)).toBe(
      0,
    );
  });
});

describe('tierOf', () => {
  const february = month('2025-02-01', 28);
  const tier = (availability: DoctorAvailability) =>
    tierOf(availability, february, PILOT_PATTERNS_V1, HOUR);

  it('has three values, because the data has three shapes', () => {
    expect(tier(unrestricted('D01'))).toBe('anchor');
    expect(tier(blocked('D06'))).toBe('pool');
    // One weekday in five is ~20%, which lands on the pool side of the boundary.
    expect(tier(blocked('D07', [1]))).toBe('pool');
    // Three weekdays in five is comfortably in between.
    expect(tier(blocked('D07', [1, 2, 3]))).toBe('partial');
  });
});

describe('inferAvailability, against the real data’s shapes', () => {
  /** Builds a period from a list of [date, shiftId, doctor] triples. */
  function periodOf(rows: readonly (readonly [string, string, string])[]): RosterPeriod {
    const dates = [...new Set(rows.map(([date]) => date))].sort();
    const assignments: Assignment[] = rows.map(([date, shiftId, doctor]) => ({
      date,
      shiftId,
      doctor,
      provenance: 'directed',
    }));
    return { label: 'inferred', days: dates.map((date) => day(date)), assignments };
  }

  it('infers the block for a doctor never seen on an early weekday', () => {
    // 2025-02-04 Tuesday night, 2025-02-01 Saturday morning.
    const period = periodOf([
      ['2025-02-04', 'std-night', 'D06'],
      ['2025-02-01', 'std-morning', 'D06'],
    ]);
    const availability = inferAvailability(period, PILOT_PATTERNS_V1, HOUR).get('D06');
    expect(availability?.rules).toEqual([{ kind: 'no-weekday-before', hour: HOUR }]);
    expect(availability?.evidence.shiftsObserved).toBe(2);
  });

  it('infers no rule at all for a doctor seen on every weekday', () => {
    // 2025-02-03 Mon .. 2025-02-07 Fri.
    const period = periodOf([
      ['2025-02-03', 'std-morning', 'D01'],
      ['2025-02-04', 'std-morning', 'D01'],
      ['2025-02-05', 'std-morning', 'D01'],
      ['2025-02-06', 'std-morning', 'D01'],
      ['2025-02-07', 'fri-early', 'D01'],
    ]);
    expect(inferAvailability(period, PILOT_PATTERNS_V1, HOUR).get('D01')?.rules).toEqual([]);
  });

  it('records the weekdays it did see as exceptions — the D07 shape', () => {
    const period = periodOf([
      ['2025-02-03', 'std-afternoon', 'D07'], // a Monday, before 17:00
      ['2025-02-04', 'std-night', 'D07'], // a Tuesday, after
    ]);
    const availability = inferAvailability(period, PILOT_PATTERNS_V1, HOUR).get('D07');
    expect(availability?.rules).toEqual([
      { kind: 'no-weekday-before', hour: HOUR, exceptWeekdays: [1] },
    ]);
  });

  it('⚠️ learns nothing about weekday availability from a holiday', () => {
    // Critical, and easy to get wrong. A pool doctor working a holiday daytime shift is NOT
    // evidence they can work an ordinary weekday - their practice was closed. Counting it would
    // reclassify most of the pool as anchors.
    const holiday = '2025-05-01'; // a Thursday
    const period: RosterPeriod = {
      label: 'holiday-only',
      days: [day(holiday, true)],
      assignments: [
        { date: holiday, shiftId: 'std-morning', doctor: 'D06', provenance: 'directed' },
      ],
    };
    const availability = inferAvailability(period, PILOT_PATTERNS_V1, HOUR).get('D06');
    expect(availability?.rules).toEqual([{ kind: 'no-weekday-before', hour: HOUR }]);
  });

  it('skips an assignment naming an unknown shift rather than guessing', () => {
    const period = periodOf([['2025-02-04', 'graveyard', 'D06']]);
    const availability = inferAvailability(period, PILOT_PATTERNS_V1, HOUR).get('D06');
    // Counted as observed but contributes no weekday evidence.
    expect(availability).toBeUndefined();
  });
});

describe('groupByTier', () => {
  const february = month('2025-02-01', 28);

  it('groups and sorts, for reporting only', () => {
    const groups = groupByTier(
      [unrestricted('D02'), unrestricted('D01'), blocked('D06'), blocked('D07', [1, 2, 3])],
      february,
      PILOT_PATTERNS_V1,
      HOUR,
    );
    expect(groups.anchors).toEqual(['D01', 'D02']);
    expect(groups.pool).toEqual(['D06']);
    expect(groups.partial).toEqual(['D07']);
  });
});
