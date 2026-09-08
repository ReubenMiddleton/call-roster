/**
 * How far a candidate roster departs from the way this practice usually rosters.
 *
 * ## Why this is an indicator and never a verdict
 *
 * The owner asked for *"a confidence interval for how likely a configuration is to match previous
 * months"*, so the reader can see *"definitively if the solver is being valuable"*. The need behind
 * that is real and important — **will this roster look normal to twelve colleagues, or will it look
 * bizarre and start an argument?** Nothing in the product answers it today.
 *
 * But **similarity to history must never be scored as quality**, and the glossary already says why in
 * two places. *"Presenting an indicator as a verdict is the main hazard in this area."* And the load
 * ratio is *"the only figure the product presents as a fairness verdict — everything else is an
 * indicator."*
 *
 * The reason it matters here more than usual: **the historical rosters are the thing this project
 * exists to improve on.** Gini on load ratio is 0.179 and the top four doctors carry 52.2% of the
 * burden. A product that scored options by resemblance to history would rank the option that
 * reproduces that unfairness highest, and steer the principal away from the only thing the software
 * is for. The history also contains known errors — two source time errors and three date-label
 * errors are recorded in the seed anomalies — and "matches history" would score reproducing a
 * 22-hour day as good.
 *
 * So: **departure is reported beside the load ratio, never blended with it, and a low departure is
 * not presented as better.** It answers *"how much will this surprise people?"*, which is a cost to
 * weigh, not a goal to maximise.
 *
 * ## And no single blended number
 *
 * `docs/product/analytics.md` lists *"a single fairness score per doctor"* under **what is
 * deliberately not measured** — *"compresses a verdict and five indicators into one number nobody can
 * argue with."* The same objection applies to one departure score, so there is none. Each axis is
 * reported and calibrated separately, and *"nights unusual, everything else typical"* is both more
 * honest and more actionable than *"87%"*.
 *
 * ## Distinct from churn, deliberately
 *
 * `churn` is already defined in the glossary: how much a **re-solve** rearranges the **previously
 * published** roster. Same shape — a distance between two rosters — different subject: churn
 * compares against one specific month people have already been told about, departure compares
 * against long-run habit. Conflating them is how `Shift`, `Duty` and `Session` become three types
 * modelling one concept.
 *
 * ⚠️ **The user-facing word is not settled.** "Departure" is this module's working term and is not in
 * the glossary. Logged as a question rather than invented into the domain language.
 *
 * ## The measure
 *
 * Each axis compares a per-doctor distribution in the candidate against the same distribution in
 * history, using **total variation distance** — `½ Σ |p−q|`, on `0..1`. It is chosen because it has a
 * plain-language reading: **the share of shifts that would have to change hands for the candidate to
 * match habit.** "About 12% of shifts sit differently from usual" is a sentence; "0.12 divergence" is
 * not.
 *
 * A raw distance is still uninterpretable on its own, which is what `npm run seed:departure` is for:
 * it computes these same axes for every real month against the history preceding it, so a candidate
 * can be placed against **how much this practice's own months actually vary.** That is the honest
 * version of what was asked for — not a confidence interval, but a reference band measured from 33
 * real months.
 */

import { anchorHolders, slotKey } from './anchors.ts';
import { indexShifts } from './shifts.ts';
import type { Assignment, DoctorCode, RosterDay, RosterPeriod, ShiftPattern } from './types.ts';

/** Which comparison an axis makes. */
export type DepartureAxisKey = 'share-of-shifts' | 'nights' | 'weekends' | 'anchor-slots';

/** Every axis, in report order. */
export const DEPARTURE_AXES: readonly DepartureAxisKey[] = [
  'share-of-shifts',
  'nights',
  'weekends',
  'anchor-slots',
];

/**
 * Below this many candidate slots an axis is noise and says so.
 *
 * One month holds roughly 30 nights across 13 doctors, so night and weekend axes sit close to this
 * line by construction. Reporting an unreliable number without saying it is unreliable is how an
 * indicator quietly becomes a verdict.
 */
export const MIN_SLOTS_FOR_AXIS = 20;

export interface DepartureAxis {
  readonly key: DepartureAxisKey;
  /** Plain language, addressed to a non-technical admin. */
  readonly label: string;
  /**
   * `0..1`. The share of shifts on this axis that would have to change hands to match habit.
   *
   * **Not a score.** A low number means familiar, which is a cost avoided, not a goal met.
   */
  readonly distance: number;
  /** Candidate slots the axis was computed over. */
  readonly slots: number;
  /** False when `slots` is below {@link MIN_SLOTS_FOR_AXIS}. Show it as provisional or not at all. */
  readonly reliable: boolean;
}

export interface DepartureProfile {
  readonly axes: readonly DepartureAxis[];
  /**
   * Doctors in the candidate with no history at all.
   *
   * Reported rather than folded in: a new joiner makes every axis look unusual for a reason that has
   * nothing to do with the roster being odd, and the admin needs to see the cause rather than the
   * symptom.
   */
  readonly doctorsWithoutHistory: readonly DoctorCode[];
  /**
   * Anchor slots whose usual holder did not get them, as `weekday shiftId → who instead`.
   *
   * The detail behind the `anchor-slots` axis, because *"Thursday night went to someone else"* is
   * what a colleague will actually notice and ask about.
   */
  readonly anchorMisses: readonly AnchorMiss[];
}

export interface AnchorMiss {
  readonly date: string;
  readonly shiftId: string;
  readonly usualHolder: DoctorCode;
  /** Absent when the slot is unfilled in the candidate. */
  readonly instead: DoctorCode | undefined;
}

/**
 * Total variation distance between two distributions given as raw counts.
 *
 * Both are normalised over the **union** of their keys, so a doctor present in one and absent from
 * the other contributes their full share to the distance rather than being silently dropped.
 * Two empty inputs are distance 0 — nothing to compare is not maximally different.
 */
export function totalVariationDistance(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  const leftTotal = [...left.values()].reduce((sum, value) => sum + value, 0);
  const rightTotal = [...right.values()].reduce((sum, value) => sum + value, 0);
  if (leftTotal === 0 || rightTotal === 0) {
    return leftTotal === rightTotal ? 0 : 1;
  }
  const keys = new Set([...left.keys(), ...right.keys()]);
  let total = 0;
  for (const key of keys) {
    total += Math.abs((left.get(key) ?? 0) / leftTotal - (right.get(key) ?? 0) / rightTotal);
  }
  return total / 2;
}

function countBy(assignments: readonly Assignment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    counts.set(assignment.doctor, (counts.get(assignment.doctor) ?? 0) + 1);
  }
  return counts;
}

/** UTC weekday, 0 = Sunday. Local here only; a weekday never crosses the solver boundary. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function dayIndex(days: readonly RosterDay[]): Map<string, RosterDay> {
  return new Map(days.map((day) => [day.date, day]));
}

export interface DepartureOptions {
  /** The shift catalogue, so `kind` can be resolved. A second tenant supplies its own. */
  readonly patterns: readonly ShiftPattern[];
}

/**
 * Compares a candidate month against the history that precedes it.
 *
 * **Both distributions are restricted to the doctors present in the candidate, then renormalised.**
 * Without that, a month after a departure would score as wildly unusual purely because someone left,
 * which is true and useless — the admin knows they left. What they want to know is whether the work
 * was redistributed the way it normally is.
 */
export function departureProfile(
  candidate: RosterPeriod,
  history: RosterPeriod,
  options: DepartureOptions,
): DepartureProfile {
  const shifts = indexShifts(options.patterns);
  const candidateDoctors = new Set(candidate.assignments.map((entry) => entry.doctor));
  const historyDoctors = new Set(history.assignments.map((entry) => entry.doctor));

  const inScope = (assignment: Assignment): boolean => candidateDoctors.has(assignment.doctor);
  const historyInScope = history.assignments.filter(inScope);

  const candidateDays = dayIndex(candidate.days);
  const historyDays = dayIndex(history.days);

  const isNight = (assignment: Assignment): boolean =>
    shifts.get(assignment.shiftId)?.kind === 'night';
  const isWeekend = (assignment: Assignment, days: Map<string, RosterDay>): boolean => {
    const dayClass = days.get(assignment.date)?.dayClass;
    return dayClass === 'saturday' || dayClass === 'sunday';
  };

  const axis = (
    key: DepartureAxisKey,
    label: string,
    candidateSet: readonly Assignment[],
    historySet: readonly Assignment[],
  ): DepartureAxis => ({
    key,
    label,
    distance: totalVariationDistance(countBy(candidateSet), countBy(historySet)),
    slots: candidateSet.length,
    reliable: candidateSet.length >= MIN_SLOTS_FOR_AXIS,
  });

  const candidateNights = candidate.assignments.filter(isNight);
  const candidateWeekends = candidate.assignments.filter((entry) =>
    isWeekend(entry, candidateDays),
  );

  const anchors = anchorHolders(historyInScope);
  const { misses, checked } = anchorAdherence(candidate.assignments, anchors);

  return {
    axes: [
      axis(
        'share-of-shifts',
        'Who does how much of the month',
        candidate.assignments,
        historyInScope,
      ),
      axis('nights', 'Who works the nights', candidateNights, historyInScope.filter(isNight)),
      axis(
        'weekends',
        'Who works the weekends',
        candidateWeekends,
        historyInScope.filter((entry) => isWeekend(entry, historyDays)),
      ),
      {
        key: 'anchor-slots',
        label: 'Whether the regular weekday slots went to their usual doctor',
        distance: checked === 0 ? 0 : misses.length / checked,
        slots: checked,
        reliable: checked >= MIN_SLOTS_FOR_AXIS,
      },
    ],
    doctorsWithoutHistory: [...candidateDoctors].filter((code) => !historyDoctors.has(code)).sort(),
    anchorMisses: misses,
  };
}

/** Where one axis's distances sat across a run of real months. */
export interface DepartureBand {
  readonly axis: DepartureAxisKey;
  readonly min: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly max: number;
  /** Months the band was computed from. Below about a dozen, treat the quartiles loosely. */
  readonly months: number;
}

/** One month's distances, keyed by axis. */
export interface MonthDeparture {
  readonly label: string;
  readonly distances: ReadonlyMap<DepartureAxisKey, number>;
  /** False while there is too little history behind it for the numbers to mean anything. */
  readonly counted: boolean;
}

/**
 * Months of history a comparison needs before its distance says anything about the roster.
 *
 * The first months are compared against almost nothing, so they score high for a reason that has
 * nothing to do with how the month was built. They are still reported — silently dropping rows is
 * how a reader concludes the data starts later than it does — but excluded from the band.
 */
export const MIN_HISTORY_MONTHS = 6;

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const position = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(position)];
  const upper = sorted[Math.ceil(position)];
  if (lower === undefined || upper === undefined) {
    return Number.NaN;
  }
  return lower + (upper - lower) * (position - Math.floor(position));
}

/** Everything before `index`, flattened into one period. */
export function historyBefore(months: readonly RosterPeriod[], index: number): RosterPeriod {
  const taken = months.slice(0, index);
  return {
    label: `history<${String(index)}`,
    days: taken.flatMap((month) => month.days),
    assignments: taken.flatMap((month) => month.assignments),
  };
}

/**
 * Scores every month against the history preceding it, and reduces that to a band per axis.
 *
 * **This is what makes a departure distance readable.** 0.18 means nothing until you know a real
 * month of this practice scores 0.12 to 0.23 — so the band is measured from the practice's own
 * months rather than chosen.
 */
export function referenceBand(
  months: readonly RosterPeriod[],
  options: DepartureOptions,
): { readonly bands: readonly DepartureBand[]; readonly perMonth: readonly MonthDeparture[] } {
  const perMonth: MonthDeparture[] = [];
  for (let index = 1; index < months.length; index += 1) {
    const month = months[index];
    if (month === undefined) {
      continue;
    }
    const profile = departureProfile(month, historyBefore(months, index), options);
    perMonth.push({
      label: month.label,
      distances: new Map(profile.axes.map((axis) => [axis.key, axis.distance])),
      counted: index >= MIN_HISTORY_MONTHS,
    });
  }

  const counted = perMonth.filter((month) => month.counted);
  const bands = DEPARTURE_AXES.map((axis): DepartureBand => {
    const values = counted
      .map((month) => month.distances.get(axis) ?? Number.NaN)
      .filter((value) => !Number.isNaN(value))
      .sort((left, right) => left - right);
    return {
      axis,
      min: values[0] ?? Number.NaN,
      p25: quantile(values, 0.25),
      median: quantile(values, 0.5),
      p75: quantile(values, 0.75),
      max: values[values.length - 1] ?? Number.NaN,
      months: values.length,
    };
  });

  return { bands, perMonth };
}

/** Where one distance sits against a band, in words a non-technical admin can act on. */
export function placeInBand(distance: number, band: DepartureBand): string {
  if (Number.isNaN(band.median)) {
    return 'no band to compare against';
  }
  if (distance > band.max) {
    return 'further from your usual pattern than any month on record';
  }
  if (distance < band.min) {
    return 'closer to your usual pattern than any month on record';
  }
  if (distance >= band.p25 && distance <= band.p75) {
    return 'about as different as an ordinary month';
  }
  return distance > band.p75
    ? 'more different than most months'
    : 'less different than most months';
}

function anchorAdherence(
  assignments: readonly Assignment[],
  anchors: ReadonlyMap<string, DoctorCode>,
): { misses: AnchorMiss[]; checked: number } {
  const misses: AnchorMiss[] = [];
  let checked = 0;
  for (const assignment of assignments) {
    const key = slotKey(weekdayOf(assignment.date), assignment.shiftId);
    const usualHolder = anchors.get(key);
    if (usualHolder === undefined) {
      continue;
    }
    checked += 1;
    if (assignment.doctor !== usualHolder) {
      misses.push({
        date: assignment.date,
        shiftId: assignment.shiftId,
        usualHolder,
        instead: assignment.doctor,
      });
    }
  }
  return { misses, checked };
}
