import { describe, expect, it } from 'vitest';
import { holidayLookup } from './holidays.ts';
import {
  datesNeedingDecision,
  PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
  PILOT_HOLIDAY_SUSPENDS_V1,
  PILOT_WEEKDAY_DEFAULTS_V1,
  resolveMonth,
  resolvePattern,
} from './pattern-precedence.ts';

/** The pilot practice's configuration, with a real holiday calendar behind it. */
function pilot(overrides: Partial<Parameters<typeof resolvePattern>[1]> = {}) {
  return {
    weekdayDefaults: PILOT_WEEKDAY_DEFAULTS_V1,
    holidaySuspends: PILOT_HOLIDAY_SUSPENDS_V1,
    suggestWhenUndetermined: PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
    holidays: holidayLookup('2020-01-01', '2030-12-31'),
    ...overrides,
  };
}

describe('the weekday default', () => {
  it('runs pattern A Monday to Thursday and at the weekend', () => {
    // 2026-09-07 is a Monday; the week runs to Sunday the 13th.
    const week = [
      ['2026-09-06', 'A'], // Sunday
      ['2026-09-07', 'A'], // Monday
      ['2026-09-08', 'A'], // Tuesday
      ['2026-09-09', 'A'], // Wednesday
      ['2026-09-10', 'A'], // Thursday
      ['2026-09-12', 'A'], // Saturday
    ] as const;
    for (const [date, expected] of week) {
      const resolved = resolvePattern(date, pilot());
      expect(resolved.patternId).toBe(expected);
      expect(resolved.source).toBe('weekday-default');
      expect(resolved.needsDecision).toBe(false);
    }
  });

  it('runs pattern B on an ordinary Friday', () => {
    const resolved = resolvePattern('2026-09-11', pilot());
    expect(resolved.patternId).toBe('B');
    expect(resolved.reason).toBe('Fridays normally run pattern B.');
  });
});

describe('a public holiday', () => {
  it('leaves an ordinary weekday alone — it varies who works, not the shift times', () => {
    // 16 December 2025, a Tuesday. The source shows it ran Pattern A normally; holidays vary the
    // ANCHOR pattern, they do not change the shift structure of a Pattern A day.
    const resolved = resolvePattern('2025-12-16', pilot());
    expect(resolved.patternId).toBe('A');
    expect(resolved.isPublicHoliday).toBe(true);
    expect(resolved.holidayName).toBe('Day of Reconciliation');
    expect(resolved.needsDecision).toBe(false);
  });

  it('refuses to choose a pattern when it lands on a Friday', () => {
    // Good Friday 2026, 3 April. Pattern B is dropped and nothing replaces it automatically.
    const resolved = resolvePattern('2026-04-03', pilot());
    expect(resolved.patternId).toBeUndefined();
    expect(resolved.source).toBe('undetermined');
    expect(resolved.needsDecision).toBe(true);
    expect(resolved.reason).toContain('Good Friday');
    expect(resolved.reason).toContain('Choose the shift times');
  });

  it('still refuses to resolve, even though the practice has chosen A eight times out of eight', () => {
    // The regression test for a tempting shortcut. `npm run seed:patterns` measured every holiday
    // Friday in 33 months and all eight ran Pattern A — but H-05, H-06 and H-07 were each written
    // from "zero counterexamples in sixteen months" and each was later falsified by the primary
    // source. The evidence goes into `suggestion`, never into `patternId`.
    const observed = ['2024-03-29', '2024-08-09', '2025-03-21', '2025-04-18', '2025-12-26'];
    for (const holidayFriday of [...observed, '2026-04-03', '2026-05-01']) {
      const resolved = resolvePattern(holidayFriday, pilot());
      expect(resolved.patternId).toBeUndefined();
      expect(resolved.suggestion).toBe('A');
    }
  });

  it('changes nothing when the practice suspends no pattern', () => {
    // A tenant that works holidays exactly like any other day is a legitimate configuration.
    const resolved = resolvePattern('2026-04-03', pilot({ holidaySuspends: new Set() }));
    expect(resolved.patternId).toBe('B');
    expect(resolved.isPublicHoliday).toBe(true);
  });
});

describe('precedence', () => {
  it('lets a per-date pattern override beat the weekday default', () => {
    const resolved = resolvePattern(
      '2026-09-11', // a Friday, default B
      pilot({ dateOverrides: new Map([['2026-09-11', 'C']]) }),
    );
    expect(resolved.patternId).toBe('C');
    expect(resolved.source).toBe('date-override');
  });

  it('lets a per-date override settle a holiday Friday', () => {
    // The admin answering the question the resolver asked. This is the whole point of level 2
    // sitting above level 3: once he has chosen, it stops asking.
    const resolved = resolvePattern(
      '2026-04-03',
      pilot({ dateOverrides: new Map([['2026-04-03', 'A']]) }),
    );
    expect(resolved.patternId).toBe('A');
    expect(resolved.needsDecision).toBe(false);
    expect(resolved.isPublicHoliday).toBe(true);
  });

  it('lets a custom shift set beat a named pattern', () => {
    const resolved = resolvePattern(
      '2026-09-11',
      pilot({
        customShiftDates: new Set(['2026-09-11']),
        dateOverrides: new Map([['2026-09-11', 'C']]),
      }),
    );
    expect(resolved.source).toBe('custom-shifts');
    expect(resolved.patternId).toBeUndefined();
    expect(resolved.needsDecision).toBe(false);
  });

  it('says so rather than silently resolving nothing when a weekday has no default', () => {
    const resolved = resolvePattern('2026-09-11', pilot({ weekdayDefaults: ['A'] }));
    expect(resolved.source).toBe('undetermined');
    expect(resolved.reason).toContain('No default pattern is configured');
  });
});

describe('resolveMonth', () => {
  it('returns every date of the month, in order', () => {
    const month = resolveMonth('2026-09', pilot());
    expect(month).toHaveLength(30);
    expect(month[0]?.date).toBe('2026-09-01');
    expect(month[29]?.date).toBe('2026-09-30');
  });

  it('handles February in a leap year', () => {
    expect(resolveMonth('2028-02', pilot())).toHaveLength(29);
    expect(resolveMonth('2027-02', pilot())).toHaveLength(28);
  });

  it('surfaces exactly the dates a human has to settle', () => {
    // April 2026: Good Friday on the 3rd is the only holiday Friday. Family Day (6th) is a Monday
    // and Freedom Day (27th) is a Monday, so both keep pattern A.
    const month = resolveMonth('2026-04', pilot());
    const pending = datesNeedingDecision(month);
    expect(pending.map((resolution) => resolution.date)).toEqual(['2026-04-03']);
  });

  it('asks for nothing in a month with no holiday Friday', () => {
    expect(datesNeedingDecision(resolveMonth('2026-09', pilot()))).toEqual([]);
  });

  it('refuses a malformed month rather than resolving a plausible wrong one', () => {
    expect(() => resolveMonth('2026', pilot())).toThrow(/not an ISO month/);
    expect(() => resolveMonth('2026-13', pilot())).toThrow(/not an ISO month/);
    expect(() => resolveMonth('2026-XX', pilot())).toThrow(/not an ISO month/);
  });
});

describe('the suggestion', () => {
  it('is offered on a holiday Friday but never applied', () => {
    // The distinction the whole module turns on. `patternId` stays undefined, so any consumer that
    // skips the prompt still gets nothing — which is the correct outcome.
    const resolved = resolvePattern('2026-04-03', pilot());
    expect(resolved.suggestion).toBe('A');
    expect(resolved.patternId).toBeUndefined();
    expect(resolved.needsDecision).toBe(true);
    expect(resolved.reason).toContain('suggested, not applied');
  });

  it('is absent on every date the calendar can resolve', () => {
    // A suggestion on a resolved date would be noise at best and a second, conflicting answer at
    // worst.
    for (const date of ['2026-09-07', '2026-09-11', '2025-12-16']) {
      expect(resolvePattern(date, pilot()).suggestion).toBeUndefined();
    }
  });

  it('is omitted entirely when the tenant supplies none', () => {
    // Built without the key rather than with `undefined`: `exactOptionalPropertyTypes` is on, so
    // "absent" and "present but undefined" are different types, and absent is the real case.
    const resolved = resolvePattern('2026-04-03', {
      weekdayDefaults: PILOT_WEEKDAY_DEFAULTS_V1,
      holidaySuspends: PILOT_HOLIDAY_SUSPENDS_V1,
      holidays: holidayLookup('2026-01-01', '2026-12-31'),
    });
    expect(resolved.suggestion).toBeUndefined();
    expect(resolved.needsDecision).toBe(true);
    expect(resolved.reason).not.toContain('suggested');
  });

  it('reflects the pilot practice’s eight-for-eight history', () => {
    // Measured by `npm run seed:patterns`, not assumed. [INFERRED] and it stays that way — this
    // asserts what the constant is, not that the practice is bound by it.
    expect(PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1).toBe('A');
  });
});
