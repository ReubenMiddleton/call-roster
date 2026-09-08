/**
 * Pre-flight capacity tests.
 *
 * Note what is asserted and what is not. The module measures a **structural** constraint — how much of
 * an anchor's month is locked into slots no pool doctor can work — and there is no test claiming it
 * predicts a constraint breach, because it was tested against the 34 real H-02 doubles and does not.
 * See the module comment.
 */

import { describe, expect, it } from 'vitest';
import type { DoctorAvailability } from './availability.ts';
import {
  ANCHOR_SHIFTS_PER_MONTH,
  countSlots,
  type DoctorCapacityInput,
  forecastCapacity,
  RESTRICTED_BEFORE_HOUR,
} from './capacity.ts';
import { classifyDay, PILOT_PATTERNS_V1 } from './shifts.ts';
import type { RosterDay } from './types.ts';

/** A run of consecutive dates, with a pattern chosen per weekday as the practice does. */
function days(from: string, count: number, holidays: ReadonlySet<string> = new Set()): RosterDay[] {
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const out: RosterDay[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(start + index * 86_400_000).getUTCDay();
    out.push({
      date,
      // Friday runs Pattern B; everything else Pattern A. Matches the practice.
      patternId: weekday === 5 ? 'B' : 'A',
      dayClass: classifyDay(date, holidays.has(date)),
    });
  }
  return out;
}

/** No availability rules: can work anything. The anchor shape. */
function anchor(doctor: string): DoctorCapacityInput {
  const availability: DoctorAvailability = {
    doctor,
    rules: [],
    evidence: { shiftsObserved: 400, contradictions: 0 },
  };
  return { availability };
}

/** Blocked before 17:00 on every weekday. The pool-GP shape. */
function poolDoctor(doctor: string, exceptWeekdays?: readonly number[]): DoctorCapacityInput {
  const availability: DoctorAvailability = {
    doctor,
    rules: [
      {
        kind: 'no-weekday-before',
        hour: 17,
        ...(exceptWeekdays === undefined ? {} : { exceptWeekdays }),
      },
    ],
    evidence: { shiftsObserved: 120, contradictions: 0 },
  };
  return { availability };
}

const FOUR_ANCHORS = ['D01', 'D02', 'D03', 'D04'].map(anchor);
const EIGHT_POOL = ['D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13'].map((d) =>
  poolDoctor(d),
);

describe('countSlots', () => {
  it('counts a weekday morning as restricted and a Saturday as open', () => {
    // 2025-02-03 is a Monday, 2025-02-01 a Saturday.
    const monday = countSlots(days('2025-02-03', 1), PILOT_PATTERNS_V1);
    expect(monday.restricted).toBe(2); // 07:00 and 15:00
    expect(monday.open).toBe(1); // 23:00

    const saturday = countSlots(days('2025-02-01', 1), PILOT_PATTERNS_V1);
    expect(saturday.restricted).toBe(0);
    expect(saturday.open).toBe(3);
  });

  it('treats a public holiday as open, because the GPs’ own practices are closed', () => {
    // The observation that confirmed the mechanism rather than merely the pattern: pool doctors DO
    // work daytime shifts on holidays - 40 times across 33 months.
    const holiday = '2025-05-01'; // a Thursday
    const asHoliday = countSlots(days(holiday, 1, new Set([holiday])), PILOT_PATTERNS_V1);
    const asWeekday = countSlots(days(holiday, 1), PILOT_PATTERNS_V1);

    expect(asHoliday.restricted).toBe(0);
    expect(asHoliday.open).toBe(3);
    expect(asWeekday.restricted).toBe(2);
  });

  it('counts Friday’s morning side as restricted and its back half as open', () => {
    // Pattern B splits at 12:00 and 17:00. The 17:00 boundary is where the workforce changes shape,
    // which is why H-06's "back half is pool-only" was never a rule about who is banned.
    const friday = countSlots(days('2025-02-07', 1), PILOT_PATTERNS_V1); // a Friday
    expect(friday.restricted).toBe(2); // 07:00 and 12:00
    expect(friday.open).toBe(2); // 17:00 and 23:00
  });

  it('ignores a pattern it does not know rather than guessing', () => {
    const unknown: RosterDay[] = [{ date: '2025-02-03', patternId: 'Z', dayClass: 'weekday' }];
    expect(countSlots(unknown, PILOT_PATTERNS_V1)).toEqual({ restricted: 0, open: 0 });
  });
});

describe('forecastCapacity', () => {
  const february = days('2025-02-01', 28);
  const roster = [...FOUR_ANCHORS, ...EIGHT_POOL];

  function forecast(overrides: Partial<Parameters<typeof forecastCapacity>[0]> = {}) {
    return forecastCapacity({
      label: '2025-02',
      days: february,
      patterns: PILOT_PATTERNS_V1,
      doctors: roster,
      ...overrides,
    });
  }

  it('classifies the roster correctly from availability alone', () => {
    const result = forecast();
    expect(result.anchorCount).toBe(4);
    expect(result.poolCount).toBe(8);
  });

  it('reports the practice’s real shape with slack but not much', () => {
    // The measured finding: restricted slots consume about three quarters of anchor capacity across
    // 33 real months, before any night, weekend or holiday shift is counted.
    const result = forecast();
    expect(result.pressure).toBeGreaterThan(0.6);
    expect(result.pressure).toBeLessThan(0.9);
    expect(result.anchorSlack).toBeGreaterThan(0);
  });

  it('escalates monotonically as doctors become unavailable', () => {
    const order = ['ok', 'tight', 'no-slack', 'shortfall'];
    const levels = [0, 1, 2, 3].map(
      (absent) => forecast({ unavailable: ['D01', 'D02', 'D03'].slice(0, absent) }).level,
    );
    for (let index = 1; index < levels.length; index += 1) {
      expect(order.indexOf(levels[index] ?? 'ok')).toBeGreaterThanOrEqual(
        order.indexOf(levels[index - 1] ?? 'ok'),
      );
    }
    expect(levels[levels.length - 1]).toBe('shortfall');
  });

  it('answers the question the principal actually has: how many can be away at once', () => {
    const result = forecast();
    expect(result.absencesTolerated).toBeGreaterThanOrEqual(0);
    expect(result.absencesTolerated).toBeLessThan(4);
  });

  it('removes the largest contributors first, so the answer is the worst case', () => {
    // "How many can be away" must not depend on WHICH ones. Removing the smallest first would give
    // a flattering number that fails the moment an anchor is the one on leave.
    const result = forecast();
    const withAnchorGone = forecast({ unavailable: ['D01'] });
    expect(withAnchorGone.anchorCapacity).toBeLessThan(result.anchorCapacity);
    // One anchor gone costs a whole anchor's worth, not an average doctor's worth.
    const perAnchor = ANCHOR_SHIFTS_PER_MONTH * (february.length / 30);
    expect(result.anchorCapacity - withAnchorGone.anchorCapacity).toBeCloseTo(perAnchor, 5);
  });

  it('⚠️ adding pool doctors does not relieve the pressure', () => {
    // The whole point, and the thing a naive headcount forecast gets wrong. Pool doctors cannot work
    // a restricted slot, so recruiting five more changes nothing about the bottleneck.
    const withFew = forecast({ doctors: [...FOUR_ANCHORS, poolDoctor('D06')] });
    const withMany = forecast({
      doctors: [...FOUR_ANCHORS, ...EIGHT_POOL, poolDoctor('D14'), poolDoctor('D15')],
    });
    expect(withMany.pressure).toBeCloseTo(withFew.pressure, 10);
    expect(withMany.level).toBe(withFew.level);
  });

  it('⚠️ counts a one-weekday exception as a fifth of a doctor, not a whole one', () => {
    // The regression test for a real design error. The first version of the tier test classified
    // anyone with any exception as a full anchor; over the real data that made three pool doctors
    // into anchors and would have UNDERSTATED the pressure by three people.
    const withPartial = forecast({
      doctors: [...FOUR_ANCHORS, poolDoctor('D07', [1])], // Mondays only
    });
    const withPure = forecast({ doctors: [...FOUR_ANCHORS, poolDoctor('D07')] });
    const withFullAnchor = forecast({ doctors: [...FOUR_ANCHORS, anchor('D07')] });

    // The partial doctor adds a little capacity...
    expect(withPartial.anchorCapacity).toBeGreaterThan(withPure.anchorCapacity);
    // ...but nothing like a whole anchor.
    expect(withPartial.anchorCapacity).toBeLessThan(withFullAnchor.anchorCapacity * 0.9);
    // And they are still reported as pool, not anchor.
    expect(withPartial.poolCount).toBe(1);
    expect(withPartial.anchorCount).toBe(4);
  });

  it('reports infinite pressure rather than dividing by zero', () => {
    const result = forecast({ doctors: EIGHT_POOL });
    expect(result.pressure).toBe(Number.POSITIVE_INFINITY);
    expect(result.level).toBe('shortfall');
    expect(result.absencesTolerated).toBe(0);
    expect(result.caveats).toContainEqual(expect.stringContaining('Nobody on the roster'));
  });

  it('takes a real monthly figure over a tier-derived one', () => {
    // A known number beats a category every time.
    const generous = forecast({
      doctors: [{ ...anchor('D01'), monthlyShifts: 30 }, ...FOUR_ANCHORS.slice(1)],
    });
    expect(generous.anchorCapacity).toBeGreaterThan(forecast().anchorCapacity);
  });

  it('scales with the period’s length rather than assuming a calendar month', () => {
    const fortnight = forecast({ label: 'fortnight', days: days('2025-02-01', 14) });
    // Roughly the same pressure over half the days, because capacity halves too. Not identical: a
    // fortnight has a different weekday mix than a whole month.
    expect(Math.abs(fortnight.pressure - forecast().pressure)).toBeLessThan(0.25);
  });

  it('always carries the caveat that it predicts nothing', () => {
    // Load-bearing. The predictive hypothesis was tested against 34 real H-02 doubles and failed at
    // r=0.611 with counterexamples both ways. A reader must not infer a forecast from a structure
    // measurement.
    expect(forecast().caveats).toContainEqual(
      expect.stringContaining('does NOT predict constraint breaches'),
    );
  });
});

describe('the confirmed constants', () => {
  it('uses the principal’s own monthly figures and the 17:00 boundary', () => {
    // 14.5 is the conservative middle of his stated 14-15; a capacity ceiling should under-promise.
    expect(ANCHOR_SHIFTS_PER_MONTH).toBe(14.5);
    expect(RESTRICTED_BEFORE_HOUR).toBe(17);
  });
});
