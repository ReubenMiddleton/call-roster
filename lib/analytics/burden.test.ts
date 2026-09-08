import { describe, expect, it } from 'vitest';
import { AGREED_BURDEN_V2, resolveBurden, validateBurdenSchedule } from './burden.ts';
import type { BurdenSchedule } from './burden-types.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';
import type { RosterDay, ShiftDefinition } from './types.ts';

function shift(id: string): ShiftDefinition {
  for (const pattern of PILOT_PATTERNS_V1) {
    const found = pattern.shifts.find((candidate) => candidate.id === id);
    if (found !== undefined) {
      return found;
    }
  }
  throw new Error(`test fixture error: no shift "${id}"`);
}

const weekday: RosterDay = { date: '2025-12-02', patternId: 'A', dayClass: 'weekday' };
const saturday: RosterDay = { date: '2025-12-06', patternId: 'A', dayClass: 'saturday' };
const sunday: RosterDay = { date: '2025-12-07', patternId: 'A', dayClass: 'sunday' };
const holiday: RosterDay = { date: '2025-12-16', patternId: 'A', dayClass: 'public-holiday' };
const christmas: RosterDay = {
  date: '2025-12-25',
  patternId: 'A',
  dayClass: 'public-holiday',
  specialDate: 'christmas',
};

describe('resolveBurden with the practice-agreed schedule', () => {
  it('reproduces the table in docs/domain/fairness.md', () => {
    const weight = (day: RosterDay, shiftId: string) =>
      resolveBurden(day, shift(shiftId), AGREED_BURDEN_V2).weight;

    expect(weight(weekday, 'std-morning')).toBe(1);
    expect(weight(weekday, 'std-afternoon')).toBe(1.75);
    expect(weight(weekday, 'std-night')).toBe(2.5);
    expect(weight(weekday, 'red-longday')).toBe(1.5);
    expect(weight(saturday, 'std-morning')).toBe(3);
    expect(weight(sunday, 'std-morning')).toBe(3);
    expect(weight(holiday, 'std-morning')).toBe(4);
  });

  it('prices Christmas night above Christmas morning', () => {
    // The bug this guards against: a day-level special-date rule would price the 07:00 shift on
    // 25 December at 6.0 as well, which is plainly wrong and would distort every December.
    expect(resolveBurden(christmas, shift('std-night'), AGREED_BURDEN_V2).weight).toBe(6);
    expect(resolveBurden(christmas, shift('std-morning'), AGREED_BURDEN_V2).weight).toBe(4);
  });

  it('returns the rule label so a credit can be explained', () => {
    expect(resolveBurden(sunday, shift('std-night'), AGREED_BURDEN_V2).rule).toBe('Sunday');
    expect(resolveBurden(christmas, shift('std-night'), AGREED_BURDEN_V2).rule).toBe(
      'Christmas night',
    );
  });

  it('prices a Sunday night and a Sunday morning the same, which the practice confirmed', () => {
    // Asked twice. On 2026-08-31 the principal said the weights were fair as they stood; on
    // 2026-09-04 he levelled Sunday DOWN to Saturday's 3.0 while raising the weekday afternoon.
    // The night/morning equality survived both, so it is deliberate rather than an omission —
    // which is worth pinning, because it is exactly the sort of thing a later reader would "fix".
    const night = resolveBurden(sunday, shift('std-night'), AGREED_BURDEN_V2).weight;
    const morning = resolveBurden(sunday, shift('std-morning'), AGREED_BURDEN_V2).weight;
    expect(night).toBe(morning);
    expect(night).toBe(3);
    // And a Sunday now costs exactly a Saturday.
    expect(resolveBurden(saturday, shift('std-morning'), AGREED_BURDEN_V2).weight).toBe(night);
  });

  it('prices Friday from 17:00 as weekend work — question W, answered 2026-09-04', () => {
    // The weekend starts Friday 17:00, and the principal confirmed the back half prices with
    // Saturday and Sunday at 3.0. This replaces an assertion that recorded the open question by
    // pinning Friday at weekday rates.
    const friday: RosterDay = { date: '2025-12-05', patternId: 'B', dayClass: 'weekday' };
    expect(resolveBurden(friday, shift('fri-evening'), AGREED_BURDEN_V2).weight).toBe(3);
    expect(resolveBurden(friday, shift('fri-night'), AGREED_BURDEN_V2).weight).toBe(3);
    // ⚠️ And the front half is NOT weekend work. `fri-midday` starts at 12:00, so it falls to the
    // floor rather than picking up the 15:00 weekday rule — he priced the 15:00–23:00 shift, not
    // this one. Pinned so the gap stays visible instead of being quietly filled in.
    expect(resolveBurden(friday, shift('fri-early'), AGREED_BURDEN_V2).weight).toBe(1);
    expect(resolveBurden(friday, shift('fri-midday'), AGREED_BURDEN_V2).weight).toBe(1);
  });

  it('prices a weekday from 15:00 above a morning, but leaves 12:00 alone', () => {
    // The distinction that made this a `fromHour` rule rather than a `shiftKind: 'afternoon'` one:
    // `std-afternoon` (15:00) and `fri-midday` (12:00) share the kind and must not share the price.
    const weekdayB: RosterDay = { date: '2025-12-03', patternId: 'B', dayClass: 'weekday' };
    expect(resolveBurden(weekday, shift('std-afternoon'), AGREED_BURDEN_V2).weight).toBe(1.75);
    expect(resolveBurden(weekdayB, shift('fri-midday'), AGREED_BURDEN_V2).weight).toBe(1);
  });

  it('throws rather than returning 0 when no rule matches', () => {
    const noCatchAll: BurdenSchedule = {
      version: 'test-no-catch-all',
      validFrom: '2025-01-01',
      confidence: 'ASSUMED',
      rules: [{ label: 'Sundays only', match: { dayClass: 'sunday' }, weight: 3.5 }],
    };
    // Returning 0 here would make a whole month's burden quietly vanish from the ledger.
    expect(() => resolveBurden(weekday, shift('std-morning'), noCatchAll)).toThrow(
      /no rule matching/,
    );
  });
});

describe('validateBurdenSchedule', () => {
  it('passes the practice-agreed schedule', () => {
    expect(validateBurdenSchedule(AGREED_BURDEN_V2)).toEqual([]);
  });

  it('catches a catch-all placed above more specific rules', () => {
    // The nastiest misconfiguration available: the schedule looks complete and correct, and
    // prices every shift in the practice at 1.0.
    const shadowed: BurdenSchedule = {
      version: 'test-shadowed',
      validFrom: '2025-01-01',
      confidence: 'ASSUMED',
      rules: [
        { label: 'everything', match: {}, weight: 1 },
        { label: 'Sunday', match: { dayClass: 'sunday' }, weight: 3.5 },
      ],
    };
    expect(validateBurdenSchedule(shadowed)).toContainEqual(
      expect.stringContaining('every rule after it is unreachable'),
    );
  });

  it('catches a missing catch-all, an empty rule list and a bad weight', () => {
    expect(
      validateBurdenSchedule({
        version: 'test-empty',
        validFrom: '2025-01-01',
        confidence: 'ASSUMED',
        rules: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no rules'),
        expect.stringContaining('no catch-all'),
      ]),
    );

    expect(
      validateBurdenSchedule({
        version: 'test-negative',
        validFrom: '2025-01-01',
        confidence: 'ASSUMED',
        rules: [{ label: 'negative', match: {}, weight: -1 }],
      }),
    ).toContainEqual(expect.stringContaining('negative weight'));
  });

  it('catches an inverted validity interval', () => {
    expect(
      validateBurdenSchedule({
        version: 'test-interval',
        validFrom: '2026-01-01',
        validTo: '2025-01-01',
        confidence: 'ASSUMED',
        rules: [{ label: 'everything', match: {}, weight: 1 }],
      }),
    ).toContainEqual(expect.stringContaining('validTo is before validFrom'));
  });
});

describe('weekday and fromHour matching — added for question W', () => {
  /**
   * The audit finding this exists for: `patternId: 'B'` cannot express "a Friday from 17:00",
   * because a Friday that is a public holiday runs Pattern C and its `red-evening` is also
   * 17:00-23:00 on that Friday. A pattern-keyed rule would price Good Friday evening as a weekday
   * and every other Friday evening as a weekend.
   */
  const withFridayRule: BurdenSchedule = {
    version: 'test-friday',
    validFrom: '2025-01-01',
    confidence: 'ASSUMED',
    rules: [
      { label: 'Friday from 17:00', match: { weekday: 5, fromHour: 17 }, weight: 3 },
      { label: 'weekday night', match: { dayClass: 'weekday', shiftKind: 'night' }, weight: 2.5 },
      { label: 'weekday daytime', match: {}, weight: 1 },
    ],
  };

  // 2025-12-05 is a Friday; 2025-12-04 a Thursday.
  const fridayB: RosterDay = { date: '2025-12-05', patternId: 'B', dayClass: 'weekday' };
  const fridayC: RosterDay = { date: '2025-12-05', patternId: 'C', dayClass: 'weekday' };
  const thursday: RosterDay = { date: '2025-12-04', patternId: 'A', dayClass: 'weekday' };

  it('catches a Friday evening on Pattern B and on Pattern C alike', () => {
    // The whole point. Both are 17:00-23:00 on the same Friday.
    expect(resolveBurden(fridayB, shift('fri-evening'), withFridayRule).weight).toBe(3);
    expect(resolveBurden(fridayC, shift('red-evening'), withFridayRule).weight).toBe(3);
  });

  it('catches the Friday night on either pattern', () => {
    expect(resolveBurden(fridayB, shift('fri-night'), withFridayRule).weight).toBe(3);
    expect(resolveBurden(fridayC, shift('red-night'), withFridayRule).weight).toBe(3);
  });

  it('leaves the Friday morning side alone', () => {
    // 07:00 and 12:00 are before the boundary, so they stay weekday work.
    expect(resolveBurden(fridayB, shift('fri-early'), withFridayRule).weight).toBe(1);
    expect(resolveBurden(fridayB, shift('fri-midday'), withFridayRule).weight).toBe(1);
  });

  it('does not leak onto other weekdays', () => {
    expect(resolveBurden(thursday, shift('std-night'), withFridayRule).weight).toBe(2.5);
    expect(resolveBurden(thursday, shift('std-afternoon'), withFridayRule).weight).toBe(1);
  });

  it('rejects a weekday or hour that could never match', () => {
    // A weekday of 7 or an hour of 24 would silently never fire, so the schedule would look
    // correct and price those shifts at the catch-all instead.
    const bad: BurdenSchedule = {
      version: 'test-bad-match',
      validFrom: '2025-01-01',
      confidence: 'ASSUMED',
      rules: [
        { label: 'impossible weekday', match: { weekday: 7 }, weight: 3 },
        { label: 'impossible hour', match: { fromHour: 24 }, weight: 3 },
        { label: 'everything', match: {}, weight: 1 },
      ],
    };
    const problems = validateBurdenSchedule(bad);
    expect(problems).toContainEqual(expect.stringContaining('must be 0-6'));
    expect(problems).toContainEqual(expect.stringContaining('must be 0-23'));
  });
});
