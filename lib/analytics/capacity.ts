/**
 * Pre-flight capacity arithmetic: is there enough anchor time to cover the slots only anchors can
 * work?
 *
 * **This needs no solver.** It is subtraction, and it answers the question the practice actually has
 * trouble with weeks before a solve would.
 *
 * ## The structural constraint it measures
 *
 * Pool GPs cannot work weekday shifts starting before 17:00 — they are at their own practices.
 * `[CONFIRMED]` by the principal and verified at 98.7% across 1,086 pool shifts. See
 * `docs/domain/workforce.md`.
 *
 * So a month's slots divide into two pools that are **not interchangeable**:
 *
 * - **Restricted** — weekday, starting before 17:00, not a public holiday. **Only anchors can work
 *   these.** Across 33 months, pool doctors covered 14 of 1,356 of them: 1.0%.
 * - **Open** — everything else. Anyone can work these.
 *
 * The measured consequence is the point: across 33 months, restricted slots consume **74% of an
 * anchor's entire monthly capacity** before a single night, weekend or holiday shift is counted. In
 * January 2024, with three anchors and 43 restricted slots, it was **99%**.
 *
 * ## ⚠️ What this does NOT do, because the hypothesis failed
 *
 * It was built expecting anchor pressure to **predict** constraint breaches — specifically the 34
 * H-02 double shifts. **It does not, and the metric must not be sold as though it does.**
 *
 * Correlation between pressure and doubles across 33 months is **0.611**: real, and not decisive.
 * The counterexamples settle it:
 *
 * - **May 2025** ran at 0.94 pressure with three anchors and produced **zero** doubles.
 * - **March 2024** ran at 0.64 and produced **three**.
 * - Every month from August 2024 onward has zero doubles regardless of pressure, including several
 *   above 0.75.
 *
 * What actually separates the two eras is **August 2024**, when D04 took the Tuesday-night slot — a
 * composition change, not a load change. So pressure describes a real and uncomfortable constraint;
 * it does not forecast a breach. Reporting it as a forecast would be exactly the
 * plausible-but-unsupported claim this project keeps catching.
 *
 * **What it is genuinely good for:** when an anchor becomes unavailable, this says how much of the
 * month has no possible substitute. That is a fact about structure rather than a prediction about
 * behaviour, and it is available in October rather than on 20 December.
 *
 * ## Availability comes from data, not from a list
 *
 * This module used to take `anchors` and `pool` as two hard-coded arrays. It now takes every
 * doctor's availability and weights each contribution by `restrictedEligibility` — because the first
 * attempt at deriving the tier was binary, classified anyone with a single weekday exception as a
 * full anchor, and would have understated pressure by three doctors. `lib/analytics/availability.ts`
 * derives the practice's own anchor/pool split from the assignments alone, and reproduces it exactly.
 */

import { type DoctorAvailability, restrictedEligibility, tierOf } from './availability.ts';
import { dayOfWeek } from './shifts.ts';
import type { DoctorCode, RosterDay, ShiftPattern } from './types.ts';

/**
 * The hour before which pool doctors are unavailable on a weekday.
 *
 * Same boundary as the weekend, and not by coincidence: 17:00 is when the workforce changes shape.
 */
export const RESTRICTED_BEFORE_HOUR = 17;

/**
 * Shifts an anchor works in a typical month.
 *
 * `[CONFIRMED]` by the principal: *"anchor doctors usually work 14-15 shifts a month while pool
 * doctors usually work anywhere between 3 and 6."* The measured mean across 33 months is 15.7 for
 * D01, so 14.5 is the conservative middle of his range rather than an observed average — a capacity
 * ceiling should under-promise.
 */
export const ANCHOR_SHIFTS_PER_MONTH = 14.5;

/** Shifts a pool doctor works in a typical month. `[CONFIRMED]` — his range is 3 to 6. */
export const POOL_SHIFTS_PER_MONTH = 4.5;

export type CapacityLevel =
  /** Comfortable: the anchors could absorb an absence. */
  | 'ok'
  /** Tight: an anchor absence would have to be solved rather than absorbed. */
  | 'tight'
  /** No slack: the restricted slots alone consume the anchors' whole month. */
  | 'no-slack'
  /** Impossible: more restricted slots than the anchors can physically work. */
  | 'shortfall';

export interface CapacityForecast {
  readonly label: string;
  /** Slots only anchors can work: weekday, before 17:00, not a public holiday. */
  readonly restrictedSlots: number;
  /** Every other slot in the period. */
  readonly openSlots: number;
  readonly anchorCount: number;
  readonly poolCount: number;
  /** `anchorCount × ANCHOR_SHIFTS_PER_MONTH`, scaled to the period's length in months. */
  readonly anchorCapacity: number;
  /**
   * Restricted slots as a fraction of total anchor capacity.
   *
   * 1.0 means the restricted slots alone would consume every shift the anchors work. Above 1.0 is
   * arithmetically impossible without doubling up or leaving slots uncovered.
   */
  readonly pressure: number;
  /** Anchor shifts left over once the restricted slots are covered. Negative is a shortfall. */
  readonly anchorSlack: number;
  readonly level: CapacityLevel;
  /**
   * How many anchors could become unavailable before `level` reaches `shortfall`.
   *
   * The number the principal actually needs in October: *"how many of us can be away at once?"*
   */
  readonly absencesTolerated: number;
  /** Health warnings that must travel with the numbers. */
  readonly caveats: readonly string[];
}

/** One doctor's contribution to capacity. */
export interface DoctorCapacityInput {
  readonly availability: DoctorAvailability;
  /**
   * Shifts this doctor works in a typical month.
   *
   * Defaults to the tier-derived figure — the principal's own 14–15 for a doctor eligible for
   * essentially all restricted slots, 3–6 for one eligible for essentially none. Supply a real
   * number where one is known; it beats a category every time.
   */
  readonly monthlyShifts?: number;
}

export interface ForecastInput {
  readonly label: string;
  readonly days: readonly RosterDay[];
  readonly patterns: readonly ShiftPattern[];
  /**
   * Every doctor on the roster, with their availability.
   *
   * **Replaced two hard-coded `anchors` and `pool` arrays.** Capacity for restricted slots is now
   * each doctor's monthly ceiling weighted by the fraction of restricted slots they can actually
   * work, so a doctor who can cover one weekday contributes one weekday's worth — not a whole
   * tier's. See `restrictedEligibility` for why the binary version was wrong.
   */
  readonly doctors: readonly DoctorCapacityInput[];
  /** Doctors known to be unavailable for the period — leave, departure, another practice. */
  readonly unavailable?: readonly DoctorCode[];
}

function levelFor(pressure: number): CapacityLevel {
  if (pressure > 1) {
    return 'shortfall';
  }
  if (pressure >= 0.9) {
    return 'no-slack';
  }
  if (pressure >= 0.75) {
    return 'tight';
  }
  return 'ok';
}

/**
 * Counts a period's slots, split by whether a pool doctor could work them.
 *
 * A shift is restricted when it starts before 17:00 on a Monday–Friday that is not a public holiday.
 * The holiday exclusion matters and is not a nicety: on a public holiday the GPs' own practices are
 * closed, so they *are* available — which is the observation that confirmed the mechanism rather than
 * merely the pattern.
 */
export function countSlots(
  days: readonly RosterDay[],
  patterns: readonly ShiftPattern[],
): { restricted: number; open: number } {
  const patternIndex = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  let restricted = 0;
  let open = 0;

  for (const day of days) {
    const pattern = patternIndex.get(day.patternId);
    if (pattern === undefined) {
      continue;
    }
    const weekday = dayOfWeek(day.date);
    const isMondayToFriday = weekday >= 1 && weekday <= 5;
    const poolAreFree = day.dayClass === 'public-holiday';

    for (const shift of pattern.shifts) {
      const onlyAnchors =
        isMondayToFriday && !poolAreFree && shift.startHour < RESTRICTED_BEFORE_HOUR;
      if (onlyAnchors) {
        restricted += 1;
      } else {
        open += 1;
      }
    }
  }

  return { restricted, open };
}

/**
 * Computes the forecast.
 *
 * Capacity is scaled by the period's length in 30-day months so a fortnight and a quarter both give a
 * meaningful pressure figure rather than one that only works on calendar months.
 */
export function forecastCapacity(input: ForecastInput): CapacityForecast {
  const { restricted, open } = countSlots(input.days, input.patterns);

  const unavailable = new Set(input.unavailable ?? []);
  const monthsInPeriod = input.days.length / 30;

  // Each doctor's contribution: their monthly ceiling, weighted by the fraction of restricted slots
  // they can actually work. A doctor eligible for one weekday in five contributes a fifth.
  interface Contribution {
    readonly doctor: DoctorCode;
    readonly capacity: number;
    readonly isAnchor: boolean;
  }
  const contributions: Contribution[] = [];
  let poolCount = 0;

  for (const entry of input.doctors) {
    const doctor = entry.availability.doctor;
    const tier = tierOf(entry.availability, input.days, input.patterns, RESTRICTED_BEFORE_HOUR);
    if (tier !== 'anchor') {
      poolCount += 1;
    }
    if (unavailable.has(doctor)) {
      continue;
    }
    const ceiling =
      entry.monthlyShifts ?? (tier === 'anchor' ? ANCHOR_SHIFTS_PER_MONTH : POOL_SHIFTS_PER_MONTH);
    const eligibility = restrictedEligibility(
      entry.availability,
      input.days,
      input.patterns,
      RESTRICTED_BEFORE_HOUR,
    );
    const capacity = ceiling * monthsInPeriod * eligibility;
    if (capacity > 0) {
      contributions.push({ doctor, capacity, isAnchor: tier === 'anchor' });
    }
  }

  const anchorCapacity = contributions.reduce((total, entry) => total + entry.capacity, 0);
  const pressure = anchorCapacity === 0 ? Number.POSITIVE_INFINITY : restricted / anchorCapacity;
  const anchorSlack = anchorCapacity - restricted;

  // How many more of them could go before the restricted slots become unworkable. Removing the
  // largest contributors first, because that is the question worth answering: the worst case, not
  // the average one.
  const descending = [...contributions].sort((a, b) => b.capacity - a.capacity);
  let absencesTolerated = 0;
  let remaining = anchorCapacity;
  for (const entry of descending) {
    remaining -= entry.capacity;
    if (remaining < restricted) {
      break;
    }
    absencesTolerated += 1;
  }
  const availableAnchors = contributions.filter((entry) => entry.isAnchor);

  const caveats: string[] = [
    'Anchor and pool monthly volumes are the practice principal’s own figures (14–15 and 3–6). They are typical, not contractual — he confirmed there is no target per doctor.',
    'Restricted slots assume pool doctors cannot work a weekday before 17:00. [CONFIRMED], and verified at 98.7% across 1,086 pool shifts — but two doctors alternate a Monday afternoon, so it is a strong rule rather than an absolute one.',
    '⚠️ Pressure does NOT predict constraint breaches. It was tested against the 34 H-02 double shifts and correlates at only 0.611, with counterexamples in both directions. It measures structure, not behaviour.',
  ];
  if (unavailable.size > 0) {
    caveats.push(
      `${String(unavailable.size)} doctor(s) treated as unavailable: ${[...unavailable].join(', ')}.`,
    );
  }
  if (contributions.length === 0) {
    caveats.push(
      'Nobody on the roster can work a restricted slot, so pressure is infinite. Every weekday daytime slot is unworkable.',
    );
  }

  return {
    label: input.label,
    restrictedSlots: restricted,
    openSlots: open,
    anchorCount: availableAnchors.length,
    poolCount,
    anchorCapacity,
    pressure,
    anchorSlack,
    level: levelFor(pressure),
    absencesTolerated,
    caveats,
  };
}
