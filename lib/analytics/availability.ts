/**
 * Per-doctor availability: what a doctor *can* work, as distinct from what they would *prefer*.
 *
 * ## The distinction this module refuses to blur
 *
 * `docs/product/glossary.md` separates **UNAVAILABLE** (hard — cannot work) from **PREFER_NOT**
 * (soft — would rather not), and the separation is load-bearing here:
 *
 * - **Availability is hard.** A pool GP cannot work a Tuesday morning because they are physically at
 *   another practice. No penalty weight makes that possible.
 * - **A preference is soft.** D03 not working nights is `[CONFIRMED]` *"yes but flexible"*. Modelling
 *   that as unavailability would silently remove a flexibility the principal told us he has.
 *
 * **Only hard availability lives in this file.** Preferences belong with the constraint catalogue and
 * the solver's penalty registry, where they can be traded away and reported.
 *
 * ## Why availability is derived rather than declared
 *
 * The practice has never recorded availability, so for historical data it is inferred from what each
 * doctor was *observed* doing. That proxy can only understate — a doctor willing to work Tuesday
 * nights who was never offered one looks unavailable. Every inferred rule is therefore `[INFERRED]`
 * and carries its own evidence count, so a caller can tell a rule supported by 400 observations from
 * one supported by three.
 *
 * ## What this replaces
 *
 * `capacity.ts` previously took `anchors` and `pool` as two hard-coded arrays — a gap flagged when it
 * was written. **Anchor and pool are not roles**; per the brief they must never become an enum.
 *
 * The first attempt at fixing that was itself wrong, and running it over the real data caught it: a
 * binary anchor/pool test classified anyone with *any* weekday exception as an anchor, which made
 * three pool doctors into anchors and would have understated capacity pressure. The quantity is
 * genuinely graded, so `restrictedEligibility` returns a fraction and the tier label is reporting
 * only. See `restrictedEligibility`.
 */

import { dayOfWeek } from './shifts.ts';
import type {
  DoctorCode,
  RosterDay,
  RosterPeriod,
  ShiftDefinition,
  ShiftPattern,
} from './types.ts';

/**
 * A hard availability rule. If it matches, the doctor cannot be assigned — full stop.
 *
 * **One kind, deliberately.** It was first written as a discriminated union anticipating more, which
 * lint correctly rejected: a single-member union is an interface, and the discriminant check it
 * required was provably dead code. Only one rule has a real case behind it, and this file's own
 * principle applies to itself — a rule nobody needs is a rule that gets misused. If a second kind
 * ever arrives, converting back to a union is a two-line change.
 */
export interface AvailabilityRule {
  /**
   * Cannot work a shift starting before `hour` on an ordinary weekday.
   *
   * The pool-GP case, `[CONFIRMED]` and verified at 98.7%: they are at their own practices until
   * late afternoon.
   *
   * **Public holidays are exempt, intrinsically.** On a holiday their own practice is closed, so they
   * are free — and that asymmetry is what confirmed the *mechanism* rather than merely the pattern
   * (40 pool daytime shifts on holidays across 33 months). Baked into the rule rather than left to
   * the caller, because forgetting it would reintroduce the error.
   */
  readonly kind: 'no-weekday-before';
  readonly hour: number;
  /**
   * Weekdays the rule does not apply to, 0 = Sunday.
   *
   * Exists for a real case: D07 and D09 alternate a Monday 15:00–23:00 shift fortnightly, the only
   * exceptions in 1,086 pool shifts. Without this they would be misclassified as anchors.
   */
  readonly exceptWeekdays?: readonly number[];
}

export interface DoctorAvailability {
  readonly doctor: DoctorCode;
  readonly rules: readonly AvailabilityRule[];
  /**
   * How much observation each rule rests on.
   *
   * `shiftsObserved` is the doctor's total; `contradictions` counts shifts that violate their own
   * inferred rules. A rule with contradictions is a *tendency* that was inferred too strongly, and a
   * caller should say so rather than enforce it.
   */
  readonly evidence: {
    readonly shiftsObserved: number;
    readonly contradictions: number;
  };
}

/** Whether a doctor can be assigned a given slot. Hard availability only. */
export function canWork(
  availability: DoctorAvailability,
  day: RosterDay,
  shift: ShiftDefinition,
): boolean {
  for (const rule of availability.rules) {
    // A holiday exempts the rule: their own practice is closed, so they are free.
    if (day.dayClass === 'public-holiday') {
      continue;
    }
    const weekday = dayOfWeek(day.date);
    const isMondayToFriday = weekday >= 1 && weekday <= 5;
    if (!isMondayToFriday) {
      continue;
    }
    if (rule.exceptWeekdays?.includes(weekday) === true) {
      continue;
    }
    if (shift.startHour < rule.hour) {
      return false;
    }
  }
  return true;
}

/**
 * The fraction of a period's restricted slots this doctor could actually work, 0 to 1.
 *
 * **This replaced a binary anchor/pool test, which was wrong.** The first version classified anyone
 * with *any* exception as an anchor — so D07 and D09, who between them alternate a single Monday
 * afternoon, counted as full anchors. Running it over the real data classified three pool doctors as
 * anchors, which would have overcounted anchor capacity by three people and **understated the
 * pressure**: the exact wrong direction for a warning.
 *
 * A fraction is the honest answer, because the underlying quantity is genuinely graded. D07 can cover
 * Monday afternoons and nothing else before 17:00; that is neither "anchor" nor "cannot".
 */
export function restrictedEligibility(
  availability: DoctorAvailability,
  days: readonly RosterDay[],
  patterns: readonly ShiftPattern[],
  restrictedBeforeHour: number,
): number {
  const patternIndex = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  let restricted = 0;
  let eligible = 0;

  for (const day of days) {
    const pattern = patternIndex.get(day.patternId);
    if (pattern === undefined) {
      continue;
    }
    const weekday = dayOfWeek(day.date);
    const isMondayToFriday = weekday >= 1 && weekday <= 5;
    if (!isMondayToFriday || day.dayClass === 'public-holiday') {
      continue;
    }
    for (const shift of pattern.shifts) {
      if (shift.startHour >= restrictedBeforeHour) {
        continue;
      }
      restricted += 1;
      if (canWork(availability, day, shift)) {
        eligible += 1;
      }
    }
  }

  return restricted === 0 ? 0 : eligible / restricted;
}

/**
 * A doctor's tier — a **reporting label only**, never an input to the arithmetic.
 *
 * Three values rather than two, because the data has three shapes: doctors available for essentially
 * all restricted slots, doctors available for essentially none, and two who alternate one Monday
 * afternoon and belong in neither box.
 *
 * Per the brief, anchor and pool must never be an enum on the doctor. This is a *consequence* of
 * availability, computed on demand, so a doctor whose other job changes reclassifies itself — and
 * `capacity.ts` uses `restrictedEligibility` rather than this, so a label can never silently become
 * a capacity assumption.
 */
export function tierOf(
  availability: DoctorAvailability,
  days: readonly RosterDay[],
  patterns: readonly ShiftPattern[],
  restrictedBeforeHour: number,
): 'anchor' | 'partial' | 'pool' {
  const eligibility = restrictedEligibility(availability, days, patterns, restrictedBeforeHour);
  if (eligibility >= 0.8) {
    return 'anchor';
  }
  if (eligibility <= 0.2) {
    return 'pool';
  }
  return 'partial';
}

/**
 * Infers availability for every doctor in a period, from what they were observed working.
 *
 * The inference is deliberately narrow: it asserts `no-weekday-before` only when a doctor has
 * **never** been observed working an ordinary weekday shift before `hour`, and it records any
 * weekday where they have as an exception rather than as a contradiction.
 *
 * ⚠️ **This can only understate availability.** A doctor never offered a Tuesday morning looks unable
 * to work one. Every result is `[INFERRED]`, and `evidence.shiftsObserved` is the number a caller
 * should check before treating a rule as real — a rule resting on three shifts is not a rule.
 */
export function inferAvailability(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
  restrictedBeforeHour: number,
): ReadonlyMap<DoctorCode, DoctorAvailability> {
  const shiftIndex = new Map<string, ShiftDefinition>();
  for (const pattern of patterns) {
    for (const shift of pattern.shifts) {
      shiftIndex.set(shift.id, shift);
    }
  }
  const dayIndex = new Map(period.days.map((day) => [day.date, day]));

  interface Observation {
    total: number;
    /** Weekdays on which this doctor worked an ordinary shift starting before the hour. */
    earlyWeekdays: Set<number>;
  }
  const seen = new Map<DoctorCode, Observation>();

  for (const assignment of period.assignments) {
    const day = dayIndex.get(assignment.date);
    const shift = shiftIndex.get(assignment.shiftId);
    if (day === undefined || shift === undefined) {
      continue;
    }
    let observation = seen.get(assignment.doctor);
    if (observation === undefined) {
      observation = { total: 0, earlyWeekdays: new Set() };
      seen.set(assignment.doctor, observation);
    }
    observation.total += 1;

    // A holiday tells us nothing about weekday availability - their practice is closed either way.
    if (day.dayClass === 'public-holiday') {
      continue;
    }
    const weekday = dayOfWeek(assignment.date);
    if (weekday >= 1 && weekday <= 5 && shift.startHour < restrictedBeforeHour) {
      observation.earlyWeekdays.add(weekday);
    }
  }

  const result = new Map<DoctorCode, DoctorAvailability>();
  for (const [doctor, observation] of seen) {
    // Never seen on an early weekday at all: infer the rule with no exceptions.
    if (observation.earlyWeekdays.size === 0) {
      result.set(doctor, {
        doctor,
        rules: [{ kind: 'no-weekday-before', hour: restrictedBeforeHour }],
        evidence: { shiftsObserved: observation.total, contradictions: 0 },
      });
      continue;
    }

    // Seen on every weekday: no rule at all, they are an anchor.
    if (observation.earlyWeekdays.size === 5) {
      result.set(doctor, {
        doctor,
        rules: [],
        evidence: { shiftsObserved: observation.total, contradictions: 0 },
      });
      continue;
    }

    // Seen on some: the rule holds with those weekdays as exceptions. This is the D07/D09 shape.
    result.set(doctor, {
      doctor,
      rules: [
        {
          kind: 'no-weekday-before',
          hour: restrictedBeforeHour,
          exceptWeekdays: [...observation.earlyWeekdays].sort((a, b) => a - b),
        },
      ],
      evidence: { shiftsObserved: observation.total, contradictions: 0 },
    });
  }

  return result;
}

/**
 * Groups doctors by tier, **for reporting**.
 *
 * Not for capacity arithmetic — that uses `restrictedEligibility` per doctor, so a doctor who can
 * cover one weekday contributes one weekday's worth rather than a whole tier's worth.
 */
export function groupByTier(
  availabilities: Iterable<DoctorAvailability>,
  days: readonly RosterDay[],
  patterns: readonly ShiftPattern[],
  restrictedBeforeHour: number,
): { anchors: DoctorCode[]; partial: DoctorCode[]; pool: DoctorCode[] } {
  const anchors: DoctorCode[] = [];
  const partial: DoctorCode[] = [];
  const pool: DoctorCode[] = [];
  for (const availability of availabilities) {
    const tier = tierOf(availability, days, patterns, restrictedBeforeHour);
    if (tier === 'anchor') {
      anchors.push(availability.doctor);
    } else if (tier === 'partial') {
      partial.push(availability.doctor);
    } else {
      pool.push(availability.doctor);
    }
  }
  return { anchors: anchors.sort(), partial: partial.sort(), pool: pool.sort() };
}
