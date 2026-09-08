/**
 * Constraint verdicts computed **per era**, not averaged across all of them.
 *
 * ## The failure this exists to catch
 *
 * `docs/domain/constraints.md` states the rule and then admits nothing enforced it:
 *
 * > **A constraint verdict should state the span it was computed over, and say so when that span
 * > crosses a composition change.**
 *
 * It was written after three constraints turned out to be artefacts of one workforce event. H-02,
 * H-05 and H-07 are all true statements about this practice *since August 2024* and all false about
 * it before, because D04 became a full participant that month. A verdict computed over the whole
 * period reports the average of two different practices and flags nothing — the original 15-month
 * window contains four workforce changes, and the full 33-month window contains ten.
 *
 * "Re-verify when the workforce changes" is not a usable rule here: the composition changes roughly
 * every three months. **This module is the usable version** — evaluate every constraint against
 * every span of stable composition, then report the spread. A constraint whose breach rate is flat
 * across eras is a habit. One that steps at a boundary is an artefact of who was available.
 *
 * ## ⚠️ The occasion is the unit, and getting this wrong silently halves every finding
 *
 * A rate needs a denominator, and the only defensible one is **the number of occasions on which the
 * rule could have been broken**. That is not the same as the number of assignments, and the
 * difference is not cosmetic:
 *
 * - **H-07** — *"D01 never works a Pattern B day."* The occasion is a **Pattern B day**: on each
 *   one, D01 either appears or does not. Counting *assignments* instead puts roughly four shifts in
 *   the denominator for every occasion, diluting the rate — and the era spread with it — about
 *   fourfold. Built that way first, it reported H-07 as stable at a 19-point spread; on the correct
 *   denominator it is **53% before August 2024 and 9% after**, matching the catalogue exactly.
 * - **H-05** — *"D02 never works a Saturday."* The occasion is a **Saturday**. Using D02's Saturday
 *   assignments as the denominator makes every one of them a breach and reports a constant 100%,
 *   which is not a measurement at all.
 *
 * So an evaluator yields occasions, each flagged breached or not. Rules whose occasion genuinely is
 * a single slot — H-06, where the Friday back half is either held by a pool doctor or is not — say
 * so by yielding one occasion per assignment.
 *
 * ## What this decides: nothing
 *
 * It reports era-dependence. Whether an era-dependent constraint should be dropped, softened, or
 * given a validity interval is a **design decision for the owner** — `constraints.md` logs it as
 * such, and question AA is the domain half of it. This module exists so that decision is made
 * against measured spread rather than a remembered anecdote.
 */

import { dayOfWeek, indexShifts } from './shifts.ts';
import type {
  DoctorCode,
  IsoDate,
  RosterDay,
  RosterPeriod,
  ShiftDefinition,
  ShiftPattern,
} from './types.ts';
import { spansWorkforceChange, type WorkforceSpan, type WorkforceTimeline } from './workforce.ts';

/** One chance for a rule to be broken, and whether it was. */
export interface ConstraintOccasion {
  /** The date it falls on — how occasions are bucketed into eras. */
  readonly date: IsoDate;
  readonly breached: boolean;
}

/** Everything an evaluator gets: the period, plus its assignments resolved against the catalogue. */
export interface ResolvedPeriod {
  readonly period: RosterPeriod;
  readonly days: readonly RosterDay[];
  /** Assignments whose day and shift both resolved, with those resolutions attached. */
  readonly assignments: readonly {
    readonly date: IsoDate;
    readonly doctor: DoctorCode;
    readonly day: RosterDay;
    readonly shift: ShiftDefinition;
  }[];
  /** Dates each doctor worked at all, for occasion rules keyed on presence. */
  readonly datesWorked: ReadonlyMap<DoctorCode, ReadonlySet<IsoDate>>;
}

export interface ConstraintEvaluator {
  /** The catalogue ID. `npm run docs:check` fails on one with no definition. */
  readonly id: string;
  readonly description: string;
  /** What one occasion is, in words. Printed, because the denominator is the thing to check. */
  readonly occasionIs: string;
  occasions(resolved: ResolvedPeriod): readonly ConstraintOccasion[];
}

export interface SpanVerdict {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly months: number;
  readonly occasions: number;
  readonly breaches: number;
  /** `breaches / occasions`, or `null` when the rule had no occasion in this span. */
  readonly rate: number | null;
}

export interface ConstraintHistory {
  readonly id: string;
  readonly description: string;
  readonly occasionIs: string;
  readonly spans: readonly SpanVerdict[];
  /** The verdict over the whole period — what the catalogue quotes today. */
  readonly overall: SpanVerdict;
  /**
   * Largest gap between any two span rates, ignoring spans with no occasion.
   *
   * `null` when fewer than two spans have a rate. **This is the number that matters**: a constraint
   * with a spread near zero is a habit, and one with a spread near one changed with the workforce.
   */
  readonly spread: number | null;
  /**
   * The rule was breached in some era and has been breached in **none** since — it *became* true.
   *
   * A second era-dependence test, because absolute spread alone misses this shape. H-02 was broken
   * in 5% of doctor-days before August 2024 and in none of the 2,190 since; that is a complete
   * collapse but only a five-point move, so `spread` calls it stable. The catalogue records it as
   * one of the three constraints the August 2024 workforce event turned on, so a measure that
   * cannot see it is not doing its job.
   *
   * Requires {@link SETTLED_MIN_OCCASIONS} in the clean stretch, so "never breached lately" is not
   * reported off three Saturdays.
   */
  readonly becameSatisfied: boolean;
}

/**
 * Occasions a clean stretch needs before "the rule became true" is a claim rather than a gap.
 *
 * 200 — enough that a rare breach would very likely have appeared. Deliberately generous: the cost
 * of a false "this became a real rule" is encoding a constraint that then fights the roster, which
 * is exactly the H-07 failure mode this module exists to prevent.
 */
export const SETTLED_MIN_OCCASIONS = 200;

/**
 * Spread above which a constraint is called era-dependent rather than a habit. `[ASSUMED]`
 *
 * 0.25 — a rule breached a quarter more often in one era than another is describing two different
 * practices. Calibrated against the two the catalogue already names: H-07 moves 53% → 9% and H-05
 * 23% → 4% across August 2024, so both land clearly above it. It is a reporting threshold only —
 * nothing is enforced on it and no behaviour changes if it moves.
 */
export const ERA_DEPENDENT_SPREAD = 0.25;

/** Resolves a period once, so every evaluator shares the work and the same view of it. */
export function resolvePeriod(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
): ResolvedPeriod {
  const shiftIndex = indexShifts(patterns);
  const dayIndex = new Map<IsoDate, RosterDay>(period.days.map((day) => [day.date, day]));
  const assignments: ResolvedPeriod['assignments'][number][] = [];
  const datesWorked = new Map<DoctorCode, Set<IsoDate>>();

  for (const assignment of period.assignments) {
    const day = dayIndex.get(assignment.date);
    const shift = shiftIndex.get(assignment.shiftId);
    // A dangling assignment is a seed-data bug and `validate-seed-data` fails the gate on it.
    // Skipping rather than throwing keeps this a reporting tool: it should still describe
    // thirty-two good months when one is malformed.
    if (day === undefined || shift === undefined) {
      continue;
    }
    assignments.push({ date: assignment.date, doctor: assignment.doctor, day, shift });
    let dates = datesWorked.get(assignment.doctor);
    if (dates === undefined) {
      dates = new Set<IsoDate>();
      datesWorked.set(assignment.doctor, dates);
    }
    dates.add(assignment.date);
  }

  return { period, days: period.days, assignments, datesWorked };
}

function verdictOver(
  occasions: readonly ConstraintOccasion[],
  fromMonth: string,
  toMonth: string,
  months: number,
): SpanVerdict {
  let total = 0;
  let breaches = 0;
  for (const occasion of occasions) {
    const month = occasion.date.slice(0, 7);
    if (month < fromMonth || month > toMonth) {
      continue;
    }
    total += 1;
    if (occasion.breached) {
      breaches += 1;
    }
  }
  return {
    fromMonth,
    toMonth,
    months,
    occasions: total,
    breaches,
    rate: total === 0 ? null : breaches / total,
  };
}

/**
 * Evaluates one constraint against every span of stable composition.
 *
 * The spans come from {@link WorkforceTimeline}, so they are derived from the roster itself rather
 * than from a stated employment record — which the practice does not keep.
 */
export function constraintHistory(
  resolved: ResolvedPeriod,
  evaluator: ConstraintEvaluator,
  spans: readonly WorkforceSpan[],
): ConstraintHistory {
  const occasions = evaluator.occasions(resolved);
  const months = resolved.days.map((day) => day.date.slice(0, 7)).sort();
  const first = months[0] ?? '';
  const last = months.at(-1) ?? '';

  const spanVerdicts = spans.map((span) =>
    verdictOver(occasions, span.fromMonth, span.toMonth, span.months),
  );
  const rates = spanVerdicts
    .map((verdict) => verdict.rate)
    .filter((rate): rate is number => rate !== null);

  // The last era with a breach; everything after it is the clean stretch.
  let lastBreach = -1;
  for (const [index, verdict] of spanVerdicts.entries()) {
    if (verdict.breaches > 0) {
      lastBreach = index;
    }
  }
  const cleanOccasions = spanVerdicts
    .slice(lastBreach + 1)
    .reduce((running, verdict) => running + verdict.occasions, 0);

  return {
    id: evaluator.id,
    description: evaluator.description,
    occasionIs: evaluator.occasionIs,
    spans: spanVerdicts,
    overall: verdictOver(occasions, first, last, months.length),
    spread: rates.length < 2 ? null : Math.max(...rates) - Math.min(...rates),
    becameSatisfied: lastBreach >= 0 && cleanOccasions >= SETTLED_MIN_OCCASIONS,
  };
}

/**
 * Whether a constraint's breach rate moved enough across eras to distrust a single verdict.
 *
 * Two ways in, because era-dependence has two shapes here: a rule that *shifted* (H-05, H-07 —
 * caught by spread) and a rule that *turned on* (H-02 — caught by `becameSatisfied`, whose absolute
 * move is only five points).
 */
export function isEraDependent(history: ConstraintHistory): boolean {
  if (history.becameSatisfied) {
    return true;
  }
  return history.spread !== null && history.spread >= ERA_DEPENDENT_SPREAD;
}

/**
 * Whether the catalogue's headline verdict for this constraint crosses a composition change.
 *
 * Separate from {@link isEraDependent} on purpose: this asks *"is the quoted number computed across
 * a boundary"*, which is true of almost every verdict in the catalogue, while era-dependence asks
 * *"did it actually move"*. The first is a caveat; the second is a finding.
 */
export function verdictCrossesChange(
  timeline: WorkforceTimeline,
  history: ConstraintHistory,
): boolean {
  return (
    spansWorkforceChange(timeline, history.overall.fromMonth, history.overall.toMonth).length > 0
  );
}

// ── The catalogue's evaluators ────────────────────────────────────────────────────────
//
// ⚠️ These encode each constraint as WRITTEN, including the parts the data has falsified. That is
// deliberate: the point is to measure how well each one holds, so an evaluator quietly adjusted to
// fit the data would report every rule as perfect.

/** Night shift IDs. */
export const NIGHT_SHIFT_IDS: ReadonlySet<string> = new Set([
  'std-night',
  'fri-night',
  'red-night',
]);

/** Friday's pool-only back half — see H-06. */
export const FRIDAY_BACK_HALF_IDS: ReadonlySet<string> = new Set(['fri-evening', 'fri-night']);

/**
 * H-02: at most one shift per doctor per day.
 *
 * The occasion is a **doctor-day on which that doctor worked**. A day they were not on cannot break
 * the rule, and counting it would make the rate a function of headcount rather than of behaviour —
 * which is precisely the confusion this module exists to remove.
 */
export function h02Evaluator(): ConstraintEvaluator {
  return {
    id: 'H-02',
    description: 'at most one shift per doctor per day',
    occasionIs: 'a doctor-day worked',
    occasions: ({ assignments }) => {
      const counts = new Map<string, number>();
      for (const entry of assignments) {
        const key = `${entry.doctor}|${entry.date}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, count]) => ({
        date: key.split('|')[1] ?? '',
        breached: count > 1,
      }));
    },
  };
}

/** H-05: the named doctor is never assigned a Saturday. The occasion is a **Saturday**. */
export function h05Evaluator(excluded: ReadonlySet<DoctorCode>): ConstraintEvaluator {
  return {
    id: 'H-05',
    description: 'the Saturday standing rule',
    occasionIs: 'a Saturday',
    occasions: ({ days, datesWorked }) =>
      days
        .filter((day) => dayOfWeek(day.date) === 6)
        .map((day) => ({
          date: day.date,
          breached: [...excluded].some((doctor) => datesWorked.get(doctor)?.has(day.date) === true),
        })),
  };
}

/**
 * H-06: Friday's evening and night exclude the named doctors.
 *
 * The occasion genuinely **is** the slot here — each back-half shift is either held by a pool doctor
 * or is not — so this yields one occasion per assignment, unlike H-05 and H-07.
 */
export function h06Evaluator(excluded: ReadonlySet<DoctorCode>): ConstraintEvaluator {
  return {
    id: 'H-06',
    description: "Friday's back half is pool doctors only",
    occasionIs: 'a Friday evening or night slot',
    occasions: ({ assignments }) =>
      assignments
        .filter((entry) => FRIDAY_BACK_HALF_IDS.has(entry.shift.id))
        .map((entry) => ({ date: entry.date, breached: excluded.has(entry.doctor) })),
  };
}

/** H-07: the named doctor never works a Pattern B day. The occasion is a **Pattern B day**. */
export function h07Evaluator(excluded: ReadonlySet<DoctorCode>): ConstraintEvaluator {
  return {
    id: 'H-07',
    description: 'the Pattern B standing rule',
    occasionIs: 'a Pattern B day',
    occasions: ({ days, datesWorked }) =>
      days
        .filter((day) => day.patternId === 'B')
        .map((day) => ({
          date: day.date,
          breached: [...excluded].some((doctor) => datesWorked.get(doctor)?.has(day.date) === true),
        })),
  };
}
