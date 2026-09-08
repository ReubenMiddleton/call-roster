import { describe, expect, it } from 'vitest';

import { AGREED_BURDEN_V2 } from './burden.ts';
import { cellKey, type EnvyInput, envyInputs, envyReport } from './envy.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';
import type { Assignment, RosterDay, RosterPeriod } from './types.ts';

/** Everyone available for everything, so feasibility never filters a pair out. */
const EVERYTHING = new Set<string>([
  cellKey('weekday', 'morning'),
  cellKey('weekday', 'afternoon'),
  cellKey('weekday', 'night'),
  cellKey('saturday', 'morning'),
  cellKey('sunday', 'morning'),
]);

function input(
  doctor: string,
  burden: number,
  heaviestShift: number,
  cells = EVERYTHING,
): EnvyInput {
  return { doctor, burden, heaviestShift, cells };
}

describe('envyReport', () => {
  it('reports no envy when everyone carries the same burden', () => {
    const report = envyReport([input('D01', 10, 2.5), input('D02', 10, 2.5)]);

    expect(report.pairs).toEqual([]);
    expect(report.isEf1).toBe(true);
    expect(report.comparablePairs).toBe(2);
  });

  it('is one-directional: only the heavier-laden doctor envies', () => {
    const report = envyReport([input('D01', 14, 2.5), input('D02', 10, 2.5)]);

    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]?.envious).toBe('D01');
    expect(report.pairs[0]?.envied).toBe('D02');
    expect(report.pairs[0]?.margin).toBe(4);
  });

  it('forgives a gap that one shift explains, and reports it as EF1', () => {
    // D01 carries 3.5 more, but their heaviest shift is a 3.5 Sunday: hand it over and the gap
    // closes exactly. This is the boundary, and it must land on the forgiving side.
    const report = envyReport([input('D01', 13.5, 3.5), input('D02', 10, 1)]);

    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]?.marginAfterOneShift).toBe(0);
    expect(report.violations).toEqual([]);
    expect(report.isEf1).toBe(true);
    expect(report.worstViolation).toBe(0);
  });

  it('does not forgive a gap wider than any single shift', () => {
    const report = envyReport([input('D01', 20, 3.5), input('D02', 10, 1)]);

    expect(report.violations).toHaveLength(1);
    expect(report.isEf1).toBe(false);
    expect(report.worstViolation).toBe(10);
  });

  it('cannot forgive anything for a doctor who worked nothing', () => {
    // heaviestShift 0 - there is no shift to give up. Guards the `?? 0` default meaning
    // "forgiven by default", which would be exactly backwards.
    const report = envyReport([input('D01', 5, 0), input('D02', 0, 0)]);

    expect(report.isEf1).toBe(false);
    expect(report.violations[0]?.marginAfterOneShift).toBe(5);
  });

  it('ignores envy toward a doctor whose work the envious one could not have done', () => {
    const weekdaysOnly = new Set([cellKey('weekday', 'morning')]);
    const weekendsOnly = new Set([cellKey('sunday', 'morning')]);
    // The weekday doctor carries far more, but could not have worked a Sunday, so the
    // comparison is meaningless and must not be counted.
    const report = envyReport([
      input('D01', 30, 1, weekdaysOnly),
      input('D02', 3.5, 3.5, weekendsOnly),
    ]);

    expect(report.pairs).toEqual([]);
    expect(report.comparablePairs).toBe(0);
    expect(report.isEf1).toBe(true);
  });

  it('counts a one-way comparison when availability is a strict superset', () => {
    // D01 can work everything D02 can, and more. So D01 may envy D02, but never the reverse -
    // and comparablePairs counts one ordered pair, not two.
    const both = new Set([cellKey('weekday', 'morning'), cellKey('sunday', 'morning')]);
    const weekdaysOnly = new Set([cellKey('weekday', 'morning')]);
    const report = envyReport([input('D01', 30, 1, both), input('D02', 3.5, 1, weekdaysOnly)]);

    expect(report.comparablePairs).toBe(1);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]?.envious).toBe('D01');
  });

  it('runs the containment envied-subset-of-envious, not the reverse', () => {
    // Pins the direction, because it looks backwards and someone will "fix" it. Envy means "I
    // would rather have your position", so the ENVIOUS doctor must be able to hold it. The
    // narrow doctor here carries more, but could not have worked the broad doctor's month, so
    // they cannot envy it - and the broad doctor, carrying less, has nothing to envy.
    const broad = new Set([cellKey('weekday', 'morning'), cellKey('sunday', 'morning')]);
    const narrow = new Set([cellKey('weekday', 'morning')]);
    const report = envyReport([input('D01', 40, 1, narrow), input('D02', 5, 1, broad)]);

    expect(report.pairs).toEqual([]);
    // One ordered pair was comparable - D02 could have worked D01's month - but D02 carries less,
    // so there is no envy. This is the case that separates "not comparable" from "no envy".
    expect(report.comparablePairs).toBe(1);
  });

  it('orders pairs worst margin first', () => {
    const report = envyReport([input('D01', 20, 1), input('D02', 15, 1), input('D03', 5, 1)]);

    const margins = report.pairs.map((pair) => pair.margin);
    expect(margins).toEqual([...margins].sort((a, b) => b - a));
    expect(report.pairs[0]).toMatchObject({ envious: 'D01', envied: 'D03', margin: 15 });
  });

  it('reports EF1 vacuously when nothing is comparable, and says so via comparablePairs', () => {
    // The trap this guards: "isEf1: true" with zero comparable pairs is not a fairness verdict,
    // it is an absence of evidence. Any caller reading isEf1 must read comparablePairs too.
    const report = envyReport([
      input('D01', 100, 1, new Set([cellKey('weekday', 'morning')])),
      input('D02', 0, 0, new Set([cellKey('sunday', 'morning')])),
    ]);

    expect(report.isEf1).toBe(true);
    expect(report.comparablePairs).toBe(0);
  });

  it('handles an empty practice', () => {
    expect(envyReport([])).toMatchObject({ pairs: [], isEf1: true, comparablePairs: 0 });
  });
});

describe('envyInputs', () => {
  const days: RosterDay[] = [
    { date: '2026-01-05', patternId: 'A', dayClass: 'weekday', isPublicHoliday: false },
    { date: '2026-01-06', patternId: 'A', dayClass: 'weekday', isPublicHoliday: false },
  ];

  function period(assignments: readonly Assignment[]): RosterPeriod {
    return { label: 'test', days, assignments };
  }

  const shiftIds = PILOT_PATTERNS_V1.find((pattern) => pattern.id === 'A')?.shifts ?? [];

  it('excludes requested burden from both the total and the heaviest shift', () => {
    const first = shiftIds[0]?.id;
    const night = shiftIds.find((shift) => shift.id.includes('night'))?.id ?? shiftIds[1]?.id;
    expect(first).toBeDefined();
    expect(night).toBeDefined();
    if (first === undefined || night === undefined) {
      return;
    }

    const directedOnly = envyInputs(
      period([
        { date: '2026-01-05', shiftId: first, doctor: 'D01', provenance: 'directed' },
        { date: '2026-01-06', shiftId: night, doctor: 'D01', provenance: 'requested' },
      ]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );

    const everything = envyInputs(
      period([
        { date: '2026-01-05', shiftId: first, doctor: 'D01', provenance: 'directed' },
        { date: '2026-01-06', shiftId: night, doctor: 'D01', provenance: 'directed' },
      ]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );

    const requestedExcluded = directedOnly[0];
    const allCounted = everything[0];
    expect(requestedExcluded).toBeDefined();
    expect(allCounted).toBeDefined();
    if (requestedExcluded === undefined || allCounted === undefined) {
      return;
    }
    expect(requestedExcluded.burden).toBeLessThan(allCounted.burden);
    expect(requestedExcluded.heaviestShift).toBeLessThanOrEqual(allCounted.heaviestShift);
  });

  it('takes opportunity cells from the caller when given, not from the period', () => {
    const first = shiftIds[0]?.id;
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    const supplied = new Map([['D01', new Set([cellKey('sunday', 'night')])]]);

    const inputs = envyInputs(
      period([{ date: '2026-01-05', shiftId: first, doctor: 'D01', provenance: 'directed' }]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      { cells: supplied },
    );

    // The period shows a weekday shift; the supplied cells say Sunday night. The supplied ones win,
    // which is what makes judging a candidate roster on a fixed comparison set possible.
    expect([...(inputs[0]?.cells ?? [])]).toEqual([cellKey('sunday', 'night')]);
  });
});
