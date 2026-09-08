import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  coefficientOfVariation,
  compareLeximax,
  computeLoadRatios,
  gini,
  jainIndex,
  leximaxVector,
  mean,
  meanAbsoluteDeviation,
  sum,
} from './equity.ts';
import type { DoctorCode } from './types.ts';

/**
 * Non-negative burdens, the only kind that exist.
 *
 * Half-integers rather than arbitrary doubles, because that is what burden actually is: a sum of
 * weights like 1.0, 2.5 and 3.5. Arbitrary doubles generate denormals such as 5e-324, which are
 * a real source of numerical bugs (one is fixed in `jainIndex`) but not a real source of
 * *rosters*. Numerical robustness is asserted directly in the tests that care about it.
 */
const burdens = (minLength = 2, maxLength = 15) =>
  fc.array(
    fc.integer({ min: 0, max: 4000 }).map((halves) => halves / 2),
    { minLength, maxLength },
  );

describe('summary statistics', () => {
  it('handles the empty case without producing NaN', () => {
    expect(sum([])).toBe(0);
    expect(mean([])).toBe(0);
    expect(gini([])).toBe(0);
    expect(jainIndex([])).toBe(1);
    expect(meanAbsoluteDeviation([])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
  });
});

describe('gini', () => {
  it('is 0 for a perfectly equal distribution', () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0, 10);
  });

  it('approaches (n-1)/n when one person carries everything', () => {
    expect(gini([100, 0, 0, 0])).toBeCloseTo(0.75, 10);
    expect(gini([100, 0])).toBeCloseTo(0.5, 10);
  });

  it('rejects negative values rather than returning a meaningless number', () => {
    expect(() => gini([1, -1])).toThrow(/undefined for negative/);
  });

  it('stays within [0, (n-1)/n]', () => {
    fc.assert(
      fc.property(burdens(), (values) => {
        const g = gini(values);
        expect(g).toBeGreaterThanOrEqual(-1e-9);
        expect(g).toBeLessThanOrEqual((values.length - 1) / values.length + 1e-9);
      }),
    );
  });

  it('ignores the order the doctors are listed in', () => {
    fc.assert(
      fc.property(burdens(), (values) => {
        expect(gini([...values].reverse())).toBeCloseTo(gini(values), 9);
      }),
    );
  });
});

describe('jainIndex', () => {
  it('is 1 for a perfectly equal distribution and 1/n for full concentration', () => {
    expect(jainIndex([7, 7, 7])).toBeCloseTo(1, 10);
    expect(jainIndex([9, 0, 0])).toBeCloseTo(1 / 3, 10);
  });

  it('stays within [1/n, 1]', () => {
    fc.assert(
      fc.property(burdens(), (values) => {
        const j = jainIndex(values);
        expect(j).toBeLessThanOrEqual(1 + 1e-9);
        expect(j).toBeGreaterThanOrEqual(1 / values.length - 1e-9);
      }),
    );
  });

  it('is more sensitive than gini to a single outlier', () => {
    // The shape this practice's data actually has: four of thirteen doctors carry 54% of the
    // load. Both measures should register it; Jain should register it harder.
    const oneOutlier = [100, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const spreadOut = [28, 28, 28, 28, 28, 10, 10, 10, 10, 10];
    expect(sum(oneOutlier)).toBe(sum(spreadOut));
    const jainGap = jainIndex(spreadOut) - jainIndex(oneOutlier);
    const giniGap = gini(oneOutlier) - gini(spreadOut);
    expect(jainGap).toBeGreaterThan(giniGap);
  });
});

describe('the monotonicity property that decides which measure may be optimised', () => {
  // This block is the executable form of the finding in equity.ts's module comment, taken from
  // Matl, Hartl and Vidal (arXiv:1605.08565): non-monotonic equity measures admit
  // "workload inconsistent" optima. If these two tests ever disagree with each other, the
  // recommendation in docs/domain/fairness.md is wrong and needs revisiting.

  it('leximax is monotonic: reducing anyone’s burden never makes the outcome worse', () => {
    fc.assert(
      fc.property(
        burdens(2, 13),
        fc.nat({ max: 12 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (values, rawIndex, fraction) => {
          const index = rawIndex % values.length;
          const original = values[index];
          if (original === undefined) {
            return;
          }
          const reduced = [...values];
          reduced[index] = original * fraction;
          // Negative or zero means "a is fairer than or equal to b".
          expect(compareLeximax(reduced, values)).toBeLessThanOrEqual(0);
        },
      ),
    );
  });

  it('gini is NOT monotonic: loading up the least-burdened doctor improves it', () => {
    // The pathology, stated as a property rather than an anecdote. A solver minimising gini can
    // make the roster look fairer by loading up whoever is doing least — nobody is better off and
    // one doctor is worse off, yet the number goes down.
    //
    // Note the bound on `extra`: the extra burden must not push this doctor past the
    // next-lightest, or they stop being the least-burdened and the claim no longer holds. An
    // earlier version of this test omitted the bound and fast-check falsified it within twenty
    // cases, which is worth recording — the loose version is the intuitive one to write, and it
    // is wrong.
    fc.assert(
      fc.property(
        burdens(2, 13),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (values, fraction) => {
          const ascending = [...values].sort((a, b) => a - b);
          const smallest = ascending[0];
          const secondSmallest = ascending[1];
          if (smallest === undefined || secondSmallest === undefined) {
            return;
          }
          const headroom = secondSmallest - smallest;
          if (headroom <= 0) {
            return; // ties at the minimum leave no room to load one of them without reordering
          }
          const index = values.indexOf(smallest);
          const loaded = [...values];
          loaded[index] = smallest + headroom * fraction;
          expect(gini(loaded)).toBeLessThanOrEqual(gini(values) + 1e-9);
        },
      ),
    );
  });

  it('range is the most perverse of all: it improves when nobody is better off', () => {
    const range = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
    const before = [10, 4];
    // Double the lighter doctor's burden. Nobody is better off; one person is worse off.
    const after = [10, 8];
    expect(range(after)).toBeLessThan(range(before));
    // Leximax correctly reports this as a step backwards.
    expect(compareLeximax(after, before)).toBeGreaterThan(0);
  });
});

describe('compareLeximax', () => {
  it('prefers the distribution whose worst-off doctor is better off', () => {
    expect(compareLeximax([5, 5, 5], [7, 4, 4])).toBeLessThan(0);
  });

  it('breaks a tie on the maximum by looking at the second-worst', () => {
    // Plain min-max is indifferent here; both have a maximum of 9. Leximax is not, and it is
    // right not to be: the second distribution has a second doctor almost as badly off.
    expect(compareLeximax([9, 2, 2], [9, 8, 2])).toBeLessThan(0);
  });

  it('treats permutations of the same distribution as identical', () => {
    fc.assert(
      fc.property(burdens(), (values) => {
        expect(compareLeximax(values, [...values].reverse())).toBe(0);
      }),
    );
  });

  it('sorts worst-first', () => {
    expect(leximaxVector([1, 9, 5])).toEqual([9, 5, 1]);
  });
});

describe('computeLoadRatios', () => {
  const code = (value: string): DoctorCode => value;

  it('gives everyone a ratio of 1.0 when burden matches entitlement exactly', () => {
    const carried = new Map([
      [code('D01'), 30],
      [code('D02'), 10],
    ]);
    const weights = new Map([
      [code('D01'), 3],
      [code('D02'), 1],
    ]);
    const ratios = computeLoadRatios(carried, weights);
    for (const ratio of ratios) {
      expect(ratio.ratio).toBeCloseTo(1, 10);
    }
  });

  it('conserves total burden across the expected shares', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 500, noNaN: true }),
            fc.double({ min: 0.1, max: 10, noNaN: true }),
          ),
          { minLength: 1, maxLength: 15 },
        ),
        (pairs) => {
          const carried = new Map<DoctorCode, number>();
          const weights = new Map<DoctorCode, number>();
          for (const [index, pair] of pairs.entries()) {
            const [burden, weight] = pair;
            carried.set(code(`D${String(index).padStart(2, '0')}`), burden);
            weights.set(code(`D${String(index).padStart(2, '0')}`), weight);
          }
          const ratios = computeLoadRatios(carried, weights);
          const totalExpected = sum(ratios.map((ratio) => ratio.expected));
          const totalCarried = sum([...carried.values()]);
          // Fair shares must add up to the work that actually exists.
          expect(totalExpected).toBeCloseTo(totalCarried, 6);
        },
      ),
    );
  });

  it('reports "not comparable" rather than 0 or Infinity for a doctor with no entitlement', () => {
    const ratios = computeLoadRatios(new Map([[code('D01'), 12]]), new Map([[code('D01'), 0]]));
    const first = ratios[0];
    expect(first).toBeDefined();
    expect(first?.ratio).toBeNull();
    // The point: null keeps them out of the fairness ranking. 0 or Infinity would place them at
    // one end of it, which is a claim the data does not support.
  });

  it('ranks the most overloaded doctor first', () => {
    const ratios = computeLoadRatios(
      new Map([
        [code('D01'), 10],
        [code('D02'), 50],
      ]),
      new Map([
        [code('D01'), 1],
        [code('D02'), 1],
      ]),
    );
    expect(ratios.map((ratio) => ratio.doctor)).toEqual(['D02', 'D01']);
  });
});
