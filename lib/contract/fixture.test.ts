/**
 * Tests over the shared fixture, from this side of the boundary.
 *
 * `solver/tests/test_contract.py` parses the same file and asserts the `Instance` it produces. This
 * file asserts what only this side can: that the weekday names in it mean what this side thinks they
 * mean, and that no integer weekday has crept in anywhere.
 *
 * The three-way field-set consistency check — fixture against the contract document against
 * `contract.py`'s allowed sets — is `npm run contract:check`, because it reads Python source and
 * that is a script's job rather than a unit test's.
 *
 * See `fixtures/README.md`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isWeekdayName, weekdayFromName, weekdaysFromNames } from './weekday.ts';

const FIXTURE = 'fixtures/solver-request.json';

interface Fixture {
  readonly contractVersion: string;
  readonly doctors: readonly { readonly code: string }[];
  readonly days: readonly {
    readonly date: string;
    readonly patternId: string;
    readonly isPublicHoliday: boolean;
    readonly shifts: readonly {
      readonly shiftId: string;
      readonly kind: string;
      readonly start: string;
      readonly end: string;
      readonly endsNextDay?: boolean;
    }[];
  }[];
  readonly availability: readonly {
    readonly doctorCode: string;
    readonly rules: readonly {
      readonly hour: number;
      readonly exceptWeekdays?: readonly string[];
    }[];
  }[];
  readonly recurringSlots: readonly { readonly doctorCode: string; readonly weekday: string }[];
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;

/**
 * Sections whose keys are domain data rather than contract fields.
 *
 * `burdenWeights` maps a burden *class* to a weight, and two of those classes are `weekday_day` and
 * `weekday_night` — the word "weekday" without being weekdays. Skipped, or the walk below flags
 * them as integer weekdays, which is what happened on its first run.
 */
const UNDECOMPOSED = new Set(['burdenWeights']);

/** Every value in the tree under a key whose name mentions a weekday. */
function weekdayValues(node: unknown, key = ''): { key: string; value: unknown }[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => weekdayValues(child, key));
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node)
      .filter(([childKey]) => !UNDECOMPOSED.has(childKey))
      .flatMap(([childKey, child]) => weekdayValues(child, childKey));
  }
  return /weekday/i.test(key) ? [{ key, value: node }] : [];
}

describe('the shared fixture', () => {
  it('is at a contract version this side supports', () => {
    // A major bump is a breaking change; the Python parser refuses one and so should this.
    expect(fixture.contractVersion.split('.')[0]).toBe('1');
  });

  it('has no duplicate doctor codes', () => {
    const codes = fixture.doctors.map((doctor) => doctor.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses doctor codes, never names — the data boundary', () => {
    // This directory is public and reaches screenshots. names:check covers it too; this fails
    // faster and says why.
    for (const doctor of fixture.doctors) {
      expect(doctor.code).toMatch(/^D\d{2}$/);
    }
  });
});

describe('⚠️ weekdays in the fixture', () => {
  it('are all names, never integers', () => {
    // The whole mechanism exists for this. An integer would mean Monday to one side and
    // Tuesday to the other, with nothing raising an error.
    const found = weekdayValues(fixture);
    expect(found.length).toBeGreaterThan(0);
    for (const { key, value } of found) {
      expect(typeof value, `${key} carried a ${typeof value}`).toBe('string');
      expect(isWeekdayName(String(value)), `${key} = ${String(value)}`).toBe(true);
    }
  });

  it("resolve to this side's integers, which differ from Python's", () => {
    // D07's exception is MONDAY. Here that is 1; test_contract.py asserts it is 0 there.
    const d07 = fixture.availability.find((entry) => entry.doctorCode === 'D07');
    expect(d07).toBeDefined();
    const rule = d07?.rules[0];
    expect(rule).toBeDefined();
    expect(weekdaysFromNames(rule?.exceptWeekdays ?? [])).toEqual([1]);

    const monday = fixture.recurringSlots.find((slot) => slot.weekday === 'MONDAY');
    expect(monday).toBeDefined();
    expect(weekdayFromName('MONDAY')).toBe(1);
  });

  it('name a weekday that matches the date it is attached to', () => {
    // Not a tautology: it checks the fixture is internally coherent, so a test asserting
    // "MONDAY" cannot pass against a date that is actually a Thursday.
    for (const day of fixture.days) {
      const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
      // 2026-09-04 is a Friday, and Friday is the only day running Pattern B.
      if (day.patternId === 'B') {
        expect(weekday, `${day.date} runs Pattern B but is not a Friday`).toBe(5);
      }
    }
  });
});

describe('shifts in the fixture', () => {
  it('all carry a kind, which is not derivable from the times', () => {
    for (const day of fixture.days) {
      for (const shift of day.shifts) {
        expect(shift.kind, `${day.date}/${shift.shiftId}`).toBeTruthy();
      }
    }
  });

  it('mark every overnight shift as endsNextDay', () => {
    // Without the flag, 23:00-07:00 is minus sixteen hours and burden goes negative.
    for (const day of fixture.days) {
      for (const shift of day.shifts) {
        const start = Number(shift.start.slice(0, 2));
        const end = Number(shift.end.slice(0, 2));
        if (end <= start) {
          expect(shift.endsNextDay, `${day.date}/${shift.shiftId}`).toBe(true);
        }
      }
    }
  });

  it('put boundaries on the hour, because the solver models integer hours', () => {
    for (const day of fixture.days) {
      for (const shift of day.shifts) {
        expect(shift.start.endsWith(':00'), `${shift.shiftId} start`).toBe(true);
        expect(shift.end.endsWith(':00'), `${shift.shiftId} end`).toBe(true);
      }
    }
  });

  it('give Pattern B four shifts and the others three', () => {
    for (const day of fixture.days) {
      expect(day.shifts.length, `${day.date} (${day.patternId})`).toBe(
        day.patternId === 'B' ? 4 : 3,
      );
    }
  });

  it('includes a public holiday, because H-10 exempts one', () => {
    // The counter-intuitive branch: pool doctors work holiday daytime shifts because their own
    // practices are closed. A fixture without one leaves that path untested on both sides.
    expect(fixture.days.some((day) => day.isPublicHoliday)).toBe(true);
  });
});
