/**
 * Equity measures, and the normalisation that makes them comparable across doctors who are
 * available for entirely different things.
 *
 * ## Which measure to optimise, and which only to report
 *
 * Matl, Hartl and Vidal's survey of workload-equity functions (*Workload Equity in Vehicle
 * Routing Problems: A Survey and Analysis*, arXiv:1605.08565) is the clearest statement of the
 * trap here. They identify axiomatic properties an equity measure should satisfy and conclude
 * that **monotonic equity functions are the appropriate ones**, because non-monotonic measures
 * produce Pareto-optimal solutions that are *workload inconsistent* — solutions where everyone's
 * workload is equal to or worse than in some other equally "optimal" solution.
 *
 * Every dispersion measure in this file — Gini, Jain, coefficient of variation, mean absolute
 * deviation, range — is **non-monotonic**: each can be improved by giving the least-loaded person
 * more work, even when nobody needed the help. Range is the most obviously perverse (it improves
 * if the best-off person is made worse off) but the others differ only in degree.
 *
 * **So: optimise `compareLeximax`. Report the rest.**
 *
 * One honest qualification, because it changes how much the survey's warning bites here. In
 * vehicle routing, total workload is elastic — tours can be lengthened. In rostering, coverage is
 * a hard constraint, so **total burden is fixed**: you cannot give one doctor more without taking
 * it from another. That removes the survey's sharpest pathology and is why the dispersion
 * measures are safe as *reported indicators*. It does not make them safe as objectives, because
 * the solver can still shuffle burden between people to chase a dispersion number rather than to
 * help the worst-off.
 *
 * ## Why report anything the objective is not minimising
 *
 * If the numbers shown to doctors are exactly the terms being minimised, the product is grading
 * its own homework. See `docs/domain/fairness.md`.
 */

import type { DoctorCode } from './types.ts';

/** Sum of a list. Explicit because `[].reduce` with no initial value throws. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Arithmetic mean. Returns 0 for an empty list rather than NaN. */
export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/**
 * Gini coefficient of a non-negative distribution. 0 = perfectly equal, → 1 = fully concentrated.
 *
 * **Report only, never optimise** — see the module note. The bounded, scale-independent,
 * population-independent behaviour that makes Gini a good *indicator* is exactly what makes it a
 * misleading *objective*.
 *
 * Returns 0 for fewer than two values and for an all-zero distribution: one person cannot be
 * unequal, and neither can nobody working at all.
 */
export function gini(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  if (values.some((value) => value < 0)) {
    throw new Error('gini is undefined for negative values');
  }
  const total = sum(values);
  if (total === 0) {
    return 0;
  }
  const ascending = [...values].sort((a, b) => a - b);
  let weighted = 0;
  for (const [index, value] of ascending.entries()) {
    // 1-based rank, per the standard formula.
    weighted += (index + 1) * value;
  }
  const n = ascending.length;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/**
 * Jain's fairness index. 1 = perfectly equal, 1/n = one person carrying everything.
 *
 * **Report only.** Included alongside Gini because the two disagree in useful ways: Jain is far
 * more sensitive to a single outlier, which is the shape this practice's data actually has — four
 * doctors carry 54% of the load. Where Gini says "moderately unequal" and Jain says "badly
 * unequal", Jain is describing the outlier and Gini is describing the middle.
 */
export function jainIndex(values: readonly number[]): number {
  if (values.length === 0) {
    return 1;
  }
  const largest = Math.max(...values);
  if (largest <= 0) {
    return 1;
  }
  // Scaled by the largest value before squaring. Jain's index is scale-invariant, so this
  // changes nothing mathematically — but it is not cosmetic: squaring un-scaled values
  // underflows to zero for very small inputs and overflows to Infinity for very large ones, and
  // both give 0/0 or Infinity/Infinity. A property test found the underflow case
  // (`[0, 5e-324]` returned NaN), and NaN reaching a fairness dashboard is worse than a
  // wrong number, because it looks like a broken product rather than a bad roster.
  const scaled = values.map((value) => value / largest);
  const total = sum(scaled);
  const sumOfSquares = sum(scaled.map((value) => value * value));
  if (sumOfSquares === 0) {
    return 1;
  }
  return (total * total) / (values.length * sumOfSquares);
}

/** Mean absolute deviation from the mean. Report only. */
export function meanAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const average = mean(values);
  return mean(values.map((value) => Math.abs(value - average)));
}

/**
 * Coefficient of variation: standard deviation over the mean. Report only.
 *
 * Dimensionless, so it can be compared between a burden distribution and a night-count
 * distribution — which raw standard deviation cannot.
 */
export function coefficientOfVariation(values: readonly number[]): number {
  const average = mean(values);
  if (average === 0) {
    return 0;
  }
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / average;
}

/**
 * The leximax vector: burdens sorted worst-first.
 *
 * Burden is a bad, so the fair objective is *leximax* — minimise the largest, then the
 * second-largest, and so on. (The same idea is called *leximin* when the quantity is a good.)
 *
 * This is the vector the solver should minimise lexicographically, and it is the one measure here
 * that is monotonic: reducing anyone's burden can never make the vector worse.
 */
export function leximaxVector(values: readonly number[]): readonly number[] {
  return [...values].sort((a, b) => b - a);
}

/**
 * Lexicographic comparison of two burden distributions, worst-off first.
 *
 * Returns a negative number if `a` is fairer than `b`, positive if `b` is fairer, 0 if the two are
 * indistinguishable. Fairer means: the worst-off person is better off; failing that, the
 * second-worst; and so on.
 *
 * Note this is strictly stronger than plain min-max. Min-max is *indifferent* between two
 * solutions with the same maximum, which lets gross unfairness hide among everyone who is not the
 * single worst-off person.
 *
 * Distributions of different length are compared over their common prefix, then the longer one is
 * treated as fairer only if its extra entries are all zero — otherwise it carries burden the
 * other does not. Comparing unequal-size groups is usually a bug in the caller, though: scope
 * both to the same membership window first.
 */
export function compareLeximax(a: readonly number[], b: readonly number[]): number {
  const left = leximaxVector(a);
  const right = leximaxVector(b);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      break;
    }
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  const leftTail = sum(left.slice(shared));
  const rightTail = sum(right.slice(shared));
  return leftTail - rightTail;
}

/**
 * How a doctor's entitlement to burden was derived. **The heart of the normalisation problem.**
 *
 * The question this answers: *what should this doctor's share have been?* Get it wrong and the
 * fairness objective actively harms people — see `revealed-opportunity` below.
 */
export type EntitlementBasis =
  /**
   * Everyone entitled to the same share. Honest only where everyone is genuinely
   * interchangeable, which this practice is not: it has anchors on standing weekday slots and
   * pool doctors who work weekends around a job at another practice.
   */
  | 'equal'
  /**
   * Share proportional to days of active membership in the period. Corrects for joiners and
   * leavers, and nothing else. The right minimum bar, and wrong for a weekends-only doctor.
   */
  | 'active-days'
  /**
   * Share proportional to the **burden of the slots the doctor could actually have worked**.
   *
   * This is the one that solves the problem the practice owner identified: a doctor who only
   * works weekends should not be judged against a doctor who only works weekdays.
   *
   * The mechanism matters. Naively dividing burden by a headcount or an FTE fraction *punishes*
   * the weekends-only doctor, because every shift they can work is a high-burden one: they look
   * chronically overloaded, the objective responds by taking weekends away, and weekends are the
   * only thing they can work. Putting the burden of their *opportunity set* in the denominator
   * cancels this exactly — a weekend-heavy numerator over a weekend-heavy denominator.
   *
   * `[INFERRED]` when computed from history, because the practice has never recorded
   * availability. See `revealedOpportunity` in `ledger.ts` for what the proxy can and cannot see.
   */
  | 'revealed-opportunity'
  /** Supplied by the caller — a contracted FTE, or a target agreed with the practice. */
  | 'explicit';

export interface LoadRatio {
  readonly doctor: DoctorCode;
  /** Burden actually carried. */
  readonly carried: number;
  /** Burden a fair share would have been, given the entitlement weights. */
  readonly expected: number;
  /**
   * `carried / expected`. 1.0 is an exactly fair share; above 1 is overloaded.
   *
   * `null` when `expected` is 0 — a doctor with no entitlement at all (no active days, or an
   * empty opportunity set). Deliberately not 0 or Infinity: "not comparable" is the truth, and
   * both substitutes would put them at one end of a fairness ranking they do not belong in.
   */
  readonly ratio: number | null;
}

/**
 * Converts burden carried plus entitlement weights into dimensionless load ratios.
 *
 * `expected_i = totalBurden × weight_i / Σ weight`, so the ratios are comparable across doctors
 * *and* across periods of different length, which raw burden totals are not.
 */
export function computeLoadRatios(
  carried: ReadonlyMap<DoctorCode, number>,
  entitlementWeights: ReadonlyMap<DoctorCode, number>,
): readonly LoadRatio[] {
  const totalBurden = sum([...carried.values()]);
  const totalWeight = sum([...entitlementWeights.values()]);

  const doctors = new Set<DoctorCode>([...carried.keys(), ...entitlementWeights.keys()]);
  const ratios: LoadRatio[] = [];

  for (const doctor of doctors) {
    const carriedBurden = carried.get(doctor) ?? 0;
    const weight = entitlementWeights.get(doctor) ?? 0;
    const expected = totalWeight === 0 ? 0 : (totalBurden * weight) / totalWeight;
    ratios.push({
      doctor,
      carried: carriedBurden,
      expected,
      ratio: expected === 0 ? null : carriedBurden / expected,
    });
  }

  ratios.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
  return ratios;
}
