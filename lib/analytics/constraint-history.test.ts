import { describe, expect, it } from 'vitest';

import {
  type ConstraintEvaluator,
  type ConstraintOccasion,
  constraintHistory,
  ERA_DEPENDENT_SPREAD,
  h02Evaluator,
  h05Evaluator,
  h07Evaluator,
  isEraDependent,
  resolvePeriod,
  SETTLED_MIN_OCCASIONS,
} from './constraint-history.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';
import type { Assignment, IsoDate, RosterDay, RosterPeriod } from './types.ts';
import type { WorkforceSpan } from './workforce.ts';

function span(fromMonth: string, toMonth: string, months = 1): WorkforceSpan {
  return { fromMonth, toMonth, months, roster: [] };
}

/** An evaluator that just replays a fixed list, so the aggregation can be tested on its own. */
function fixed(occasions: readonly ConstraintOccasion[]): ConstraintEvaluator {
  return {
    id: 'H-01',
    description: 'fixture',
    occasionIs: 'a fixture occasion',
    occasions: () => occasions,
  };
}

const EMPTY: RosterPeriod = { label: 'empty', days: [], assignments: [] };

function periodOver(dates: readonly IsoDate[]): RosterPeriod {
  return {
    label: 'test',
    days: dates.map((date) => ({
      date,
      patternId: 'A',
      dayClass: 'weekday' as const,
      isPublicHoliday: false,
    })),
    assignments: [],
  };
}

describe('constraintHistory aggregation', () => {
  const spans = [span('2024-01', '2024-03', 3), span('2024-04', '2024-06', 3)];

  it('rates each era separately and reports the spread between them', () => {
    const history = constraintHistory(
      resolvePeriod(periodOver(['2024-01-01', '2024-04-01']), PILOT_PATTERNS_V1),
      fixed([
        { date: '2024-01-15', breached: true },
        { date: '2024-02-15', breached: true },
        { date: '2024-03-15', breached: false },
        { date: '2024-05-15', breached: false },
        { date: '2024-06-15', breached: false },
      ]),
      spans,
    );

    expect(history.spans[0]?.rate).toBeCloseTo(2 / 3);
    expect(history.spans[1]?.rate).toBe(0);
    expect(history.spread).toBeCloseTo(2 / 3);
    expect(isEraDependent(history)).toBe(true);
  });

  it('gives an era with no occasion a null rate, not zero', () => {
    // Zero would read as "never breached", which is strong evidence for a rule. No occasion is no
    // evidence at all, and the two must not look the same.
    const history = constraintHistory(
      resolvePeriod(periodOver(['2024-01-01']), PILOT_PATTERNS_V1),
      fixed([{ date: '2024-01-15', breached: true }]),
      spans,
    );

    expect(history.spans[0]?.rate).toBe(1);
    expect(history.spans[1]?.rate).toBeNull();
    // One rated era is not a comparison.
    expect(history.spread).toBeNull();
    expect(isEraDependent(history)).toBe(false);
  });

  it('does not flag a constraint whose rate barely moves', () => {
    const history = constraintHistory(
      resolvePeriod(periodOver(['2024-01-01', '2024-04-01']), PILOT_PATTERNS_V1),
      fixed([
        { date: '2024-01-15', breached: true },
        { date: '2024-02-15', breached: false },
        { date: '2024-05-15', breached: true },
        { date: '2024-06-15', breached: false },
      ]),
      spans,
    );

    expect(history.spread).toBe(0);
    expect(isEraDependent(history)).toBe(false);
  });

  it('excludes occasions outside every era from the span rates but not from overall', () => {
    const history = constraintHistory(
      resolvePeriod(periodOver(['2023-01-01', '2024-01-01']), PILOT_PATTERNS_V1),
      fixed([
        { date: '2023-11-15', breached: true }, // before the first span
        { date: '2024-01-15', breached: false },
      ]),
      spans,
    );

    expect(history.spans[0]?.occasions).toBe(1);
    expect(history.overall.occasions).toBe(2);
  });
});

describe('becameSatisfied — the rule that turned on', () => {
  it('flags a rule breached early and never since, where spread alone would miss it', () => {
    // H-02's real shape, and the reason this second test exists: 5% of doctor-days before the
    // boundary, none of the 2,190 after. A total collapse worth only five absolute points.
    const early: ConstraintOccasion[] = Array.from({ length: 100 }, (_, index) => ({
      date: '2024-01-15',
      breached: index < 5,
    }));
    const clean: ConstraintOccasion[] = Array.from({ length: SETTLED_MIN_OCCASIONS }, () => ({
      date: '2024-05-15',
      breached: false,
    }));
    const history = constraintHistory(
      resolvePeriod(periodOver(['2024-01-01', '2024-04-01']), PILOT_PATTERNS_V1),
      fixed([...early, ...clean]),
      [span('2024-01', '2024-03', 3), span('2024-04', '2024-06', 3)],
    );

    // Spread is 0.05 — comfortably below the threshold, so it alone calls this stable.
    expect(history.spread).toBeCloseTo(0.05);
    expect(history.spread ?? 0).toBeLessThan(ERA_DEPENDENT_SPREAD);
    // becameSatisfied is what catches it.
    expect(history.becameSatisfied).toBe(true);
    expect(isEraDependent(history)).toBe(true);
  });

  it('does not flag a rule whose clean stretch is too short to mean anything', () => {
    const history = constraintHistory(
      resolvePeriod(periodOver(['2024-01-01', '2024-04-01']), PILOT_PATTERNS_V1),
      fixed([
        { date: '2024-01-15', breached: true },
        { date: '2024-05-15', breached: false },
        { date: '2024-06-15', breached: false },
      ]),
      [span('2024-01', '2024-03', 3), span('2024-04', '2024-06', 3)],
    );

    expect(history.becameSatisfied).toBe(false);
  });

  it('is false for a rule that was never breached at all', () => {
    const clean: ConstraintOccasion[] = Array.from({ length: SETTLED_MIN_OCCASIONS }, () => ({
      date: '2024-01-15',
      breached: false,
    }));
    const history = constraintHistory(
      resolvePeriod(periodOver(['2024-01-01']), PILOT_PATTERNS_V1),
      fixed(clean),
      [span('2024-01', '2024-03', 3)],
    );

    // Never broken is not "became true" — there was nothing to turn on.
    expect(history.becameSatisfied).toBe(false);
  });
});

describe('⚠️ the occasion is the unit', () => {
  const days: RosterDay[] = [
    // 2026-01-03 is a Saturday; 2026-01-05 a Monday.
    { date: '2026-01-03', patternId: 'B', dayClass: 'saturday', isPublicHoliday: false },
    { date: '2026-01-05', patternId: 'B', dayClass: 'weekday', isPublicHoliday: false },
  ];
  const patternB = PILOT_PATTERNS_V1.find((pattern) => pattern.id === 'B');
  const shiftIds = (patternB?.shifts ?? []).map((shift) => shift.id);

  function period(assignments: readonly Assignment[]): RosterPeriod {
    return { label: 'occasions', days, assignments };
  }

  it('counts H-07 per Pattern B DAY, not per assignment on it', () => {
    // The bug this pins. Built per-assignment first, H-07's era spread came out 19 points and the
    // tool called it stable; on Pattern B days it is 75 points and matches the catalogue's
    // "53% before August 2024, 9% after". A day with four shifts is ONE chance to break the rule.
    expect(shiftIds.length).toBeGreaterThan(1);
    const first = shiftIds[0];
    const second = shiftIds[1];
    if (first === undefined || second === undefined) {
      return;
    }

    const history = constraintHistory(
      resolvePeriod(
        period([
          { date: '2026-01-05', shiftId: first, doctor: 'D01', provenance: 'directed' },
          { date: '2026-01-05', shiftId: second, doctor: 'D09', provenance: 'directed' },
        ]),
        PILOT_PATTERNS_V1,
      ),
      h07Evaluator(new Set(['D01'])),
      [span('2026-01', '2026-01', 1)],
    );

    // Two Pattern B days, two occasions — not the four assignments' worth.
    expect(history.overall.occasions).toBe(2);
    expect(history.overall.breaches).toBe(1);
    expect(history.overall.rate).toBe(0.5);
  });

  it('counts H-05 per SATURDAY, so a compliant one is evidence for the rule', () => {
    // Counting D02's Saturday assignments instead makes every occasion a breach and reports a
    // constant 100%, which is not a measurement. The Saturday D02 did not work must count.
    const first = shiftIds[0];
    if (first === undefined) {
      return;
    }
    const history = constraintHistory(
      resolvePeriod(
        period([{ date: '2026-01-03', shiftId: first, doctor: 'D09', provenance: 'directed' }]),
        PILOT_PATTERNS_V1,
      ),
      h05Evaluator(new Set(['D02'])),
      [span('2026-01', '2026-01', 1)],
    );

    expect(history.overall.occasions).toBe(1);
    expect(history.overall.breaches).toBe(0);
    expect(history.overall.rate).toBe(0);
  });

  it('counts H-02 per doctor-day WORKED, so headcount does not move the rate', () => {
    const first = shiftIds[0];
    const second = shiftIds[1];
    if (first === undefined || second === undefined) {
      return;
    }
    const history = constraintHistory(
      resolvePeriod(
        period([
          { date: '2026-01-05', shiftId: first, doctor: 'D01', provenance: 'directed' },
          { date: '2026-01-05', shiftId: second, doctor: 'D01', provenance: 'directed' },
          { date: '2026-01-03', shiftId: first, doctor: 'D09', provenance: 'directed' },
        ]),
        PILOT_PATTERNS_V1,
      ),
      h02Evaluator(),
      [span('2026-01', '2026-01', 1)],
    );

    // Two doctor-days worked: D01 on the 5th (twice — the breach) and D09 on the 3rd.
    expect(history.overall.occasions).toBe(2);
    expect(history.overall.breaches).toBe(1);
  });
});

describe('resolvePeriod', () => {
  it('skips an assignment whose shift is not in the catalogue rather than throwing', () => {
    // A reporting tool must still describe thirty-two good months when one is malformed.
    const resolved = resolvePeriod(
      {
        label: 'bad',
        days: [{ date: '2026-01-05', patternId: 'A', dayClass: 'weekday', isPublicHoliday: false }],
        assignments: [
          { date: '2026-01-05', shiftId: 'no-such-shift', doctor: 'D01', provenance: 'directed' },
        ],
      },
      PILOT_PATTERNS_V1,
    );

    expect(resolved.assignments).toEqual([]);
    expect(resolved.datesWorked.size).toBe(0);
  });

  it('handles an empty period', () => {
    const resolved = resolvePeriod(EMPTY, PILOT_PATTERNS_V1);
    expect(resolved.assignments).toEqual([]);
    expect(resolved.days).toEqual([]);
  });
});
