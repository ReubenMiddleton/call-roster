/**
 * Weekday wire-format tests.
 *
 * These pin an **asymmetry on purpose.** This side maps `MONDAY` to 1; the Python side maps it to 0.
 * Both are right. If someone "fixes" either side to agree with the other, one of these tests fails
 * loudly — which is the entire point, because the alternative failure mode is a doctor rostered on
 * the wrong day with no error anywhere.
 *
 * The mirror test is `solver/tests/test_wire.py::test_monday_is_zero_on_this_side`.
 */

import { describe, expect, it } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import {
  isWeekdayName,
  nameFromWeekday,
  namesFromWeekdays,
  WEEKDAY_NAMES,
  weekdayFromName,
  weekdaysFromNames,
} from './weekday.ts';

describe('the integer convention', () => {
  it('⚠️ maps MONDAY to 1, because this side is Date.getUTCDay()', () => {
    // Python's date.weekday() maps MONDAY to 0. Do not reconcile them; convert at the boundary.
    expect(weekdayFromName('MONDAY')).toBe(1);
    expect(weekdayFromName('SUNDAY')).toBe(0);
    expect(weekdayFromName('SATURDAY')).toBe(6);
  });

  it('agrees with Date.getUTCDay() for a known week', () => {
    // 2025-02-02 is a Sunday, so seven consecutive dates cover the week in this side's order.
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(Date.UTC(2025, 1, 2 + offset));
      expect(nameFromWeekday(date.getUTCDay())).toBe(WEEKDAY_NAMES[offset]);
    }
  });
});

describe('weekdayFromName', () => {
  it('throws on an unknown name rather than defaulting', () => {
    // A silent fallback here puts a doctor on the wrong day.
    expect(() => weekdayFromName('Monday')).toThrow(/Not a weekday name/);
    expect(() => weekdayFromName('MON')).toThrow(/Not a weekday name/);
    expect(() => weekdayFromName('')).toThrow(/Not a weekday name/);
  });
});

describe('nameFromWeekday', () => {
  it('throws outside 0-6 instead of leaking undefined onto the wire', () => {
    expect(() => nameFromWeekday(7)).toThrow(/out of range/);
    expect(() => nameFromWeekday(-1)).toThrow(/out of range/);
  });
});

describe('isWeekdayName', () => {
  it('accepts every name and rejects near-misses', () => {
    for (const name of WEEKDAY_NAMES) {
      expect(isWeekdayName(name)).toBe(true);
    }
    expect(isWeekdayName('TUES')).toBe(false);
    expect(isWeekdayName('monday')).toBe(false);
  });
});

describe('the list conversions', () => {
  it('round-trips the D07 shape', () => {
    // D07 and D09 alternate a Monday 15:00-23:00, the only exceptions in 1,086 pool shifts.
    expect(namesFromWeekdays([1])).toEqual(['MONDAY']);
    expect(weekdaysFromNames(['MONDAY'])).toEqual([1]);
  });

  it('deduplicates and sorts, so output is stable', () => {
    expect(namesFromWeekdays([3, 1, 3])).toEqual(['MONDAY', 'WEDNESDAY']);
    expect(weekdaysFromNames(['FRIDAY', 'MONDAY', 'FRIDAY'])).toEqual([1, 5]);
  });

  it('handles the empty case, which is the common one', () => {
    // Most doctors have no weekday exception at all.
    expect(namesFromWeekdays([])).toEqual([]);
    expect(weekdaysFromNames([])).toEqual([]);
  });
});

test.prop([fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 7 })])(
  'any set of weekdays survives a round trip through the wire format',
  (weekdays) => {
    expect(weekdaysFromNames(namesFromWeekdays(weekdays))).toEqual(
      [...weekdays].sort((a, b) => a - b),
    );
  },
);

test.prop([fc.constantFrom(...WEEKDAY_NAMES)])(
  'any name survives a round trip through the integer',
  (name) => {
    expect(nameFromWeekday(weekdayFromName(name))).toBe(name);
  },
);
