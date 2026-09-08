/**
 * Request-builder tests.
 *
 * The builder's job is to make the things the Python parser rejects **impossible to express**, so
 * these tests come in two halves: the conversions that must be exact, and the inputs that must be
 * refused before they reach the wire.
 *
 * The end-to-end proof — this side emits, Python parses and solves — is `npm run seed:request`,
 * because it needs the Python toolchain and a unit test should not.
 */

import { AGREED_BURDEN_V2 } from '../analytics/burden.ts';
import { describe, expect, it } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import type { DoctorAvailability } from '../analytics/availability.ts';
import { classifyDay, PILOT_PATTERNS_V1 } from '../analytics/shifts.ts';
import type { RosterDay } from '../analytics/types.ts';
import {
  buildSolveRequest,
  type BuildRequestInput,
  CONTRACT_VERSION,
  RequestBuildError,
} from './request.ts';

const HORIZON = { start: '2026-09-01', end: '2026-09-30' } as const;

function day(date: string, patternId = 'A', isPublicHoliday = false): RosterDay {
  return {
    date,
    patternId,
    dayClass: classifyDay(date, isPublicHoliday),
    isPublicHoliday,
  };
}

function base(overrides: Partial<BuildRequestInput> = {}): BuildRequestInput {
  return {
    solveRunId: 'run-1',
    tenantId: 'tenant-1',
    rosterId: 'roster-1',
    horizon: HORIZON,
    doctors: [
      { code: 'D01', availableFrom: '2024-01-01' },
      { code: 'D06', availableFrom: '2024-01-01' },
    ],
    days: [day('2026-09-01'), day('2026-09-04', 'B')],
    patterns: PILOT_PATTERNS_V1,
    burdenWeights: { weekday_day: 1 },
    burdenSchedule: AGREED_BURDEN_V2,
    constraints: [{ id: 'H-01', mode: 'BLOCK', weight: 1_000_000 }],
    ...overrides,
  };
}

function availabilityFor(
  doctor: string,
  hour: number,
  exceptWeekdays?: readonly number[],
): DoctorAvailability {
  return {
    doctor,
    rules: [
      {
        kind: 'no-weekday-before',
        hour,
        ...(exceptWeekdays === undefined ? {} : { exceptWeekdays }),
      },
    ],
    evidence: { shiftsObserved: 120, contradictions: 1 },
  };
}

describe('buildSolveRequest', () => {
  it('emits the current contract version', () => {
    expect(buildSolveRequest(base()).contractVersion).toBe(CONTRACT_VERSION);
    expect(CONTRACT_VERSION.split('.')[0]).toBe('1');
  });

  it('emits every field the contract documents, including the four not yet consumed', () => {
    // Omitting them would let their shapes rot until the day something needs them.
    const request = buildSolveRequest(base());
    for (const field of [
      'burdenLedger',
      'burdenWeights',
      'lockedAssignments',
      'previousPublished',
    ] as const) {
      expect(request[field], field).toBeDefined();
    }
  });

  it('defaults the time budget rather than omitting it', () => {
    expect(buildSolveRequest(base()).timeBudgetSeconds).toBe(30);
    expect(buildSolveRequest(base({ timeBudgetSeconds: 5 })).timeBudgetSeconds).toBe(5);
  });

  it('defaults staffCategory and nulls an open-ended membership', () => {
    const [doctor] = buildSolveRequest(base()).doctors;
    expect(doctor?.staffCategory).toBe('independent_practitioner');
    expect(doctor?.availableUntil).toBeNull();
  });
});

describe('shift conversion', () => {
  it('turns start hour and duration into HH:00 boundaries', () => {
    const [first] = buildSolveRequest(base()).days;
    const morning = first?.shifts.find((shift) => shift.shiftId === 'std-morning');
    expect(morning).toEqual({
      shiftId: 'std-morning',
      kind: 'morning',
      start: '07:00',
      end: '15:00',
      // Resolved from AGREED_BURDEN_V2: 1 September 2026 is an ordinary Tuesday.
      burdenWeight: 1,
    });
  });

  it('⚠️ derives endsNextDay from the arithmetic, not from the kind', () => {
    // 23:00 + 8h = 31, i.e. 07:00 the next day. Deriving it from kind === 'night' would be the
    // same mistake as inferring kind from endsNextDay: a coincidence of this practice's hours.
    const [first] = buildSolveRequest(base()).days;
    const night = first?.shifts.find((shift) => shift.shiftId === 'std-night');
    expect(night).toEqual({
      shiftId: 'std-night',
      kind: 'night',
      start: '23:00',
      end: '07:00',
      endsNextDay: true,
      // A weekday night is 2.5, not 1.0 — the flat five-key map could not say that.
      burdenWeight: 2.5,
    });
  });

  it('omits endsNextDay entirely for a same-day shift', () => {
    // Absent rather than false, because the parser defaults it and an explicit false adds noise.
    const [first] = buildSolveRequest(base()).days;
    const morning = first?.shifts.find((shift) => shift.shiftId === 'std-morning');
    expect(morning).not.toHaveProperty('endsNextDay');
  });

  it('gives Pattern B four shifts and Pattern A three', () => {
    const request = buildSolveRequest(base());
    expect(request.days.find((entry) => entry.patternId === 'A')?.shifts).toHaveLength(3);
    expect(request.days.find((entry) => entry.patternId === 'B')?.shifts).toHaveLength(4);
  });

  it('carries a kind on every shift, using this side’s vocabulary', () => {
    // Realigned 2026-09-01: Python held fri_early/fri_midday/fri_evening/long_day. It now holds
    // these five, because kind is a burden concept and those were pattern positions.
    const kinds = new Set(
      buildSolveRequest(
        base({ days: [day('2026-09-04', 'B'), day('2026-09-07', 'C')] }),
      ).days.flatMap((entry) => entry.shifts.map((shift) => shift.kind)),
    );
    for (const kind of kinds) {
      expect(['morning', 'afternoon', 'evening', 'night', 'long-day']).toContain(kind);
    }
  });
});

describe('⚠️ the public-holiday fact', () => {
  it('is taken from the explicit flag, not from dayClass', () => {
    const holiday = day('2026-09-24', 'A', true); // a Thursday
    const [wire] = buildSolveRequest(base({ days: [holiday] })).days;
    expect(wire?.isPublicHoliday).toBe(true);
  });

  it('survives a holiday falling on a Saturday, which dayClass loses', () => {
    // The regression test for a lossy conflation. classifyDay lets Saturday outrank
    // public-holiday, because the principal said it "counts once as a Saturday". Correct for
    // burden — and it means the calendar fact is not in dayClass at all.
    const saturdayHoliday = day('2026-09-26', 'A', true);
    expect(saturdayHoliday.dayClass).toBe('saturday');

    const [wire] = buildSolveRequest(base({ days: [saturdayHoliday] })).days;
    expect(wire?.isPublicHoliday, 'the holiday was lost on the way to the wire').toBe(true);
  });

  it('asks the calendar for a day that does not state the fact', () => {
    const legacy: RosterDay = {
      date: '2026-09-24', // Heritage Day
      patternId: 'A',
      dayClass: 'public-holiday',
    };
    const [wire] = buildSolveRequest(base({ days: [legacy] })).days;
    expect(wire?.isPublicHoliday).toBe(true);
  });

  it('⚠️ answers a weekend holiday the old dayClass fallback got wrong', () => {
    // The regression test for the fallback this replaced. Christmas Day 2022 was a SUNDAY, so
    // classifyDay returns 'sunday' and `dayClass === 'public-holiday'` is false — the old code
    // sent Christmas across the wire as an ordinary Sunday, and the burden schedule prices a
    // public holiday well above one. The calendar knows better.
    const legacy: RosterDay = {
      date: '2022-12-25',
      patternId: 'A',
      dayClass: classifyDay('2022-12-25', false),
    };
    expect(legacy.dayClass).toBe('sunday');
    expect(legacy.isPublicHoliday).toBeUndefined();

    const [wire] = buildSolveRequest(
      base({ days: [legacy], horizon: { start: '2022-12-01', end: '2022-12-31' } }),
    ).days;
    expect(
      wire?.isPublicHoliday,
      'Christmas on a Sunday reached the solver as a plain Sunday',
    ).toBe(true);
  });

  it('lets an explicit false override the calendar', () => {
    // The practice not observing a statutory holiday is a fact only they have. `??` means the
    // stated value wins over the derived one in both directions, not just the true one.
    const notObserved: RosterDay = {
      date: '2026-09-24',
      patternId: 'A',
      dayClass: 'weekday',
      isPublicHoliday: false,
    };
    const [wire] = buildSolveRequest(base({ days: [notObserved] })).days;
    expect(wire?.isPublicHoliday).toBe(false);
  });

  it('accepts a proclaimed one-off the statutory calendar cannot derive', () => {
    const proclaimed: RosterDay = {
      date: '2026-09-02',
      patternId: 'A',
      dayClass: 'weekday',
    };
    const [wire] = buildSolveRequest(
      base({
        days: [proclaimed],
        declaredHolidays: [{ date: '2026-09-02', name: 'Test election day', source: 'unit test' }],
      }),
    ).days;
    expect(wire?.isPublicHoliday).toBe(true);
  });

  it('is false, not undefined, when the day is ordinary', () => {
    const [wire] = buildSolveRequest(base()).days;
    expect(wire?.isPublicHoliday).toBe(false);
  });
});

describe('⚠️ weekday conversion', () => {
  it('emits a name for a recurring slot, never the integer', () => {
    const request = buildSolveRequest(
      base({ recurringSlots: [{ doctor: 'D01', weekday: 1, shiftId: 'std-morning' }] }),
    );
    // 1 is Monday on this side and Tuesday on the other. The name is unambiguous.
    expect(request.recurringSlots[0]?.weekday).toBe('MONDAY');
  });

  it('emits names for an availability exception — the D07 shape', () => {
    const request = buildSolveRequest(
      base({ availability: new Map([['D06', availabilityFor('D06', 17, [1])]]) }),
    );
    expect(request.availability[0]?.rules[0]?.exceptWeekdays).toEqual(['MONDAY']);
  });

  it('throws on a weekday outside 0-6 rather than emitting nonsense', () => {
    expect(() =>
      buildSolveRequest(base({ recurringSlots: [{ doctor: 'D01', weekday: 7, shiftId: 'x' }] })),
    ).toThrow(/out of range/);
  });
});

describe('availability conversion', () => {
  it('carries the hour and the evidence', () => {
    const request = buildSolveRequest(
      base({ availability: new Map([['D06', availabilityFor('D06', 17)]]) }),
    );
    expect(request.availability[0]?.rules[0]?.hour).toBe(17);
    expect(request.availability[0]?.derivedFrom).toEqual({
      shiftsObserved: 120,
      contradictions: 1,
    });
  });

  it('omits exceptWeekdays when there are none, rather than sending an empty array', () => {
    const request = buildSolveRequest(
      base({ availability: new Map([['D06', availabilityFor('D06', 17)]]) }),
    );
    expect(request.availability[0]?.rules[0]).not.toHaveProperty('exceptWeekdays');
  });

  it('omits an unrestricted doctor entirely', () => {
    // Absent means unrestricted. An empty rule list would read as "restricted, in no way",
    // which is a different claim.
    const unrestricted: DoctorAvailability = {
      doctor: 'D01',
      rules: [],
      evidence: { shiftsObserved: 400, contradictions: 0 },
    };
    const request = buildSolveRequest(base({ availability: new Map([['D01', unrestricted]]) }));
    expect(request.availability).toEqual([]);
  });

  it('refuses a second rule rather than silently dropping it', () => {
    const twoRules: DoctorAvailability = {
      doctor: 'D06',
      rules: [
        { kind: 'no-weekday-before', hour: 17 },
        { kind: 'no-weekday-before', hour: 9 },
      ],
      evidence: { shiftsObserved: 10, contradictions: 0 },
    };
    expect(() => buildSolveRequest(base({ availability: new Map([['D06', twoRules]]) }))).toThrow(
      /needs a contract change/,
    );
  });

  it('refuses availability for a doctor who is not in the request', () => {
    expect(() =>
      buildSolveRequest(base({ availability: new Map([['D99', availabilityFor('D99', 17)]]) })),
    ).toThrow(/not among this request/);
  });
});

describe('refusals', () => {
  it('refuses a day whose pattern is not supplied', () => {
    // Emitting it would let the solver fall back to its own table — a single-tenant leak.
    expect(() => buildSolveRequest(base({ days: [day('2026-09-01', 'Z')] }))).toThrow(
      /not in the supplied patterns/,
    );
  });

  it('refuses a day outside the horizon', () => {
    expect(() => buildSolveRequest(base({ days: [day('2026-10-01')] }))).toThrow(
      /outside the horizon/,
    );
  });

  it('refuses a duplicate date', () => {
    expect(() => buildSolveRequest(base({ days: [day('2026-09-01'), day('2026-09-01')] }))).toThrow(
      /duplicate date/,
    );
  });

  it('refuses a duplicate doctor code', () => {
    expect(() =>
      buildSolveRequest(
        base({
          doctors: [
            { code: 'D01', availableFrom: '2024-01-01' },
            { code: 'D01', availableFrom: '2024-01-01' },
          ],
        }),
      ),
    ).toThrow(/duplicate doctor code/);
  });

  it('refuses an empty doctor list and an empty day list', () => {
    expect(() => buildSolveRequest(base({ doctors: [] }))).toThrow(/Nothing can be rostered/);
    expect(() => buildSolveRequest(base({ days: [] }))).toThrow(/nothing to solve/);
  });

  it('refuses a preference with no dates', () => {
    expect(() =>
      buildSolveRequest(base({ preferences: [{ doctor: 'D01', type: 'PREFER', dates: [] }] })),
    ).toThrow(/no meaning/);
  });

  it('refuses a preference or slot for an unknown doctor', () => {
    expect(() =>
      buildSolveRequest(
        base({ preferences: [{ doctor: 'D99', type: 'PREFER', dates: ['2026-09-01'] }] }),
      ),
    ).toThrow(/not a doctor here/);
    expect(() =>
      buildSolveRequest(base({ recurringSlots: [{ doctor: 'D99', weekday: 1, shiftId: 'x' }] })),
    ).toThrow(/not a doctor here/);
  });

  it('throws RequestBuildError, so a caller can distinguish it', () => {
    expect(() => buildSolveRequest(base({ days: [day('2026-10-01')] }))).toThrow(RequestBuildError);
  });
});

describe('determinism', () => {
  it('sorts the ledger and preference dates, so two identical inputs give one output', () => {
    // A request that differs only in key order produces a different solve_run row and a
    // different cache key for no reason.
    const input = base({
      burdenLedger: new Map([
        ['D06', { cumulativeBurden: 96, entitlement: 80 }],
        ['D01', { cumulativeBurden: 142.5, entitlement: 130 }],
      ]),
      preferences: [{ doctor: 'D01', type: 'PREFER_NOT', dates: ['2026-09-04', '2026-09-01'] }],
    });
    const request = buildSolveRequest(input);
    expect(request.burdenLedger.map((entry) => entry.doctorCode)).toEqual(['D01', 'D06']);
    expect(request.preferences[0]?.dates).toEqual(['2026-09-01', '2026-09-04']);
  });

  it('drops ledger entries for doctors not in the request', () => {
    // A departed doctor's cumulative burden is history, not an input to this month's solve.
    const request = buildSolveRequest(
      base({
        burdenLedger: new Map([
          ['D01', { cumulativeBurden: 10, entitlement: 12 }],
          ['D15', { cumulativeBurden: 200, entitlement: 190 }],
        ]),
      }),
    );
    expect(request.burdenLedger.map((entry) => entry.doctorCode)).toEqual(['D01']);
  });

  test.prop([fc.integer({ min: 0, max: 6 })])(
    'any valid weekday round-trips to a name and back',
    (weekday) => {
      const request = buildSolveRequest(
        base({ recurringSlots: [{ doctor: 'D01', weekday, shiftId: 'std-morning' }] }),
      );
      const name = request.recurringSlots[0]?.weekday;
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
    },
  );
});
