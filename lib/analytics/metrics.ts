/**
 * The reported metric catalogue — what a dashboard, an export footer or a doctor's own page
 * actually shows.
 *
 * Two rules shape this module.
 *
 * **Every report carries its own caveats.** `PracticeMetrics.caveats` is not decoration: it is how
 * an `[ASSUMED]` burden schedule and an `[INFERRED]` availability proxy stay visible after the
 * numbers have been through three layers of UI. A fairness figure that has lost its provenance is
 * worse than no figure, because it will be quoted in a conversation between thirteen colleagues.
 *
 * **Report more than the objective optimises.** Night counts, weekend counts and holiday counts
 * are shift *counts*, not burden, and the solver does not minimise them. If the only numbers on
 * screen are the ones being minimised, the product is grading its own homework.
 */

import type { BurdenSchedule } from './burden-types.ts';
import {
  coefficientOfVariation,
  computeLoadRatios,
  gini,
  jainIndex,
  leximaxVector,
  type LoadRatio,
  meanAbsoluteDeviation,
  sum,
} from './equity.ts';
import { buildLedger, entitlementWeights, type EntitlementOptions, type Ledger } from './ledger.ts';
import { inclusiveDayCount } from './shifts.ts';
import type { DoctorCode, IsoDate, Provenance, RosterPeriod, ShiftPattern } from './types.ts';

/**
 * Below these, a load ratio is reported but must not be treated as a verdict.
 *
 * Found by running the report over the real fifteen months: a departed doctor with sixteen shifts
 * scored 2.16, more than any anchor, purely because a revealed-opportunity denominator estimated
 * from sixteen observations is tiny and unstable. The ratio is not wrong so much as unsupported —
 * it says "worked more than the little we saw them available for", which is not the same claim as
 * "carrying more than their share".
 *
 * The window threshold matters as much as the count: thirty shifts inside three weeks reveals far
 * less about availability than thirty spread over a year.
 */
export const MIN_SHIFTS_FOR_RATIO = 20;
export const MIN_ACTIVE_DAYS_FOR_RATIO = 60;

/**
 * A doctor present for less than this fraction of the reporting period is low-sample too.
 *
 * The absolute thresholds above are not enough, and the real data showed why: a doctor who joined
 * ten weeks before the period ended cleared both of them (29 shifts, 71 days) and was reported as
 * carrying 30% more than his share — on the strength of ten weeks. His own ratio is correctly
 * window-scoped; what is unsupported is the *inference of his availability* from so short a span.
 *
 * Presence is relative to the period, so this scales: 50% of one month and 50% of three years are
 * both "there for about half of it".
 */
export const MIN_PRESENCE_SHARE_FOR_RATIO = 0.5;

/**
 * Days without a shift, at the end of a period, after which membership is inferred to have ended.
 *
 * `[INFERRED]`, and it has to be: the roster records who worked, never who left. Ninety days is
 * long enough that a doctor working two shifts a month will not trip it, and it reproduces the two
 * departures already known from `private/doctor-codes.md` — which is the only validation available.
 *
 * The practice owner's requirement is the reason this exists: *"new doctors are constantly joining
 * and others are leaving on a year to year basis, so the system should handle this elegantly
 * without having doctors that have left skew the analytics or fairness scale."*
 */
export const DEPARTURE_GAP_DAYS = 90;

export interface DoctorMetrics {
  readonly doctor: DoctorCode;
  readonly shifts: number;
  readonly burden: number;
  readonly equalisableBurden: number;
  /** This doctor's share of all burden in the period, 0–1. Descriptive; needs no denominator. */
  readonly realisedShare: number;
  /** Fair share of burden given the entitlement basis. */
  readonly expectedBurden: number;
  /** `burden / expectedBurden`. 1.0 is exactly fair. `null` when not comparable. */
  readonly loadRatio: number | null;
  /**
   * Whether this doctor was observed enough for their load ratio to mean anything.
   *
   * `low-sample` ratios are shown — hiding a doctor from their own ledger is worse — but they are
   * excluded from the practice-wide fairness figure and should be rendered as provisional.
   */
  readonly ratioConfidence: 'ok' | 'low-sample';
  /**
   * Whether this doctor still appears to be part of the practice at the end of the period.
   *
   * `[INFERRED]` from a trailing gap, never recorded. A departed doctor's own historical figures
   * stay correct and stay visible — the ledger must be able to answer *"what did they carry while
   * they were here"* — but they are excluded from the **current** practice-wide fairness figure,
   * which is a statement about the people being rostered now.
   */
  readonly membership: 'active' | 'inferred-departed';
  /**
   * Fraction of the reporting period this doctor was active for, 0–1.
   *
   * The joiner-and-leaver correction. Judging someone present for 14% of the window against people
   * present for all of it is not a comparison, however correctly each ratio is scoped.
   */
  readonly presenceShare: number;
  /** Days between this doctor's last shift and the end of the period. */
  readonly daysSinceLastShift: number;
  readonly nights: number;
  /** Nights as a fraction of this doctor's own shifts. Catches D03's 3-in-201. */
  readonly nightShare: number;
  readonly saturdays: number;
  readonly sundays: number;
  /**
   * Fridays worked. Reported separately because Friday is confirmed weekend work but is priced
   * as a weekday, so this is the column that shows who is absorbing the under-priced shifts.
   */
  readonly fridays: number;
  readonly publicHolidays: number;
  readonly requestedShifts: number;
  readonly absorbedShifts: number;
  readonly activeDays: number;
  readonly burdenPerActiveDay: number;
  readonly firstSeen: IsoDate;
  readonly lastSeen: IsoDate;
}

export interface PracticeMetrics {
  readonly label: string;
  readonly doctorCount: number;
  readonly totalShifts: number;
  readonly totalBurden: number;
  /** Should always be 0. Non-zero means the period has a coverage gap — H-01 violated. */
  readonly uncoveredSlots: number;

  /** Inequality of equalisable burden. Report-only measures; see `equity.ts`. */
  readonly giniBurden: number;
  readonly jainBurden: number;
  readonly coefficientOfVariationBurden: number;
  readonly meanAbsoluteDeviationBurden: number;

  /**
   * Inequality of **load ratio** rather than raw burden. The headline fairness number, because it
   * is the one that does not punish a doctor for being available only at weekends.
   */
  readonly giniLoadRatio: number;

  /** Doctors still active at the end of the period. */
  readonly activeDoctorCount: number;
  /** Doctors whose membership is inferred to have ended before the period closed. */
  readonly departedDoctorCount: number;

  /** Burden vector, worst-off first. The monotonic view, and what the solver should minimise. */
  readonly leximaxBurden: readonly number[];

  /** Share of all burden carried by the four heaviest doctors, 0–1. */
  readonly topFourConcentration: number;

  readonly entitlementBasis: EntitlementOptions['basis'];
  readonly burdenScheduleVersion: string;
  readonly burdenScheduleConfidence: BurdenSchedule['confidence'];
  readonly shiftsByProvenance: Record<Provenance, number>;

  /** Health warnings that must travel with the numbers. Render them; do not filter them out. */
  readonly caveats: readonly string[];
}

export interface PeriodReport {
  readonly practice: PracticeMetrics;
  readonly doctors: readonly DoctorMetrics[];
  readonly ledger: Ledger;
}

/**
 * Computes the full report for one period.
 *
 * `entitlement` defaults to `revealed-opportunity`, which is the only basis that is both
 * computable from roster history and non-punitive toward doctors with restricted availability.
 */
export function buildPeriodReport(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
  schedule: BurdenSchedule,
  entitlement: EntitlementOptions = { basis: 'revealed-opportunity' },
): PeriodReport {
  const ledger = buildLedger(period, patterns, schedule);
  const weights = entitlementWeights(period, patterns, schedule, ledger, entitlement);

  const carried = new Map<DoctorCode, number>(
    ledger.entries.map((entry) => [entry.doctor, entry.equalisableBurden]),
  );
  const ratios = new Map<DoctorCode, LoadRatio>(
    computeLoadRatios(carried, weights).map((ratio) => [ratio.doctor, ratio]),
  );

  // Period bounds, for the joiner-and-leaver corrections. `days` is sorted by `loadSeedPeriod`
  // and by every other producer, but sort defensively rather than trust it — reading the wrong
  // end of the period would silently mark the whole practice departed.
  const dates = period.days.map((day) => day.date).sort();
  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];
  const periodDays =
    periodStart === undefined || periodEnd === undefined
      ? 0
      : inclusiveDayCount(periodStart, periodEnd);

  const doctors: DoctorMetrics[] = ledger.entries.map((entry) => {
    const ratio = ratios.get(entry.doctor);
    const presenceShare = periodDays === 0 ? 0 : entry.activeDays / periodDays;
    const daysSinceLastShift =
      periodEnd === undefined ? 0 : inclusiveDayCount(entry.lastSeen, periodEnd) - 1;
    return {
      doctor: entry.doctor,
      shifts: entry.shifts,
      burden: entry.burden,
      equalisableBurden: entry.equalisableBurden,
      realisedShare: ledger.totalBurden === 0 ? 0 : entry.burden / ledger.totalBurden,
      expectedBurden: ratio?.expected ?? 0,
      loadRatio: ratio?.ratio ?? null,
      ratioConfidence:
        entry.shifts >= MIN_SHIFTS_FOR_RATIO &&
        entry.activeDays >= MIN_ACTIVE_DAYS_FOR_RATIO &&
        presenceShare >= MIN_PRESENCE_SHARE_FOR_RATIO
          ? 'ok'
          : 'low-sample',
      membership: daysSinceLastShift > DEPARTURE_GAP_DAYS ? 'inferred-departed' : 'active',
      presenceShare,
      daysSinceLastShift,
      nights: entry.shiftsByShiftKind.night,
      nightShare: entry.shifts === 0 ? 0 : entry.shiftsByShiftKind.night / entry.shifts,
      saturdays: entry.shiftsByDayClass.saturday,
      sundays: entry.shiftsByDayClass.sunday,
      fridays: entry.shiftsOnFriday,
      publicHolidays: entry.shiftsByDayClass['public-holiday'],
      requestedShifts: entry.shiftsByProvenance.requested,
      absorbedShifts: entry.shiftsByProvenance.absorbed,
      activeDays: entry.activeDays,
      burdenPerActiveDay: entry.activeDays === 0 ? 0 : entry.burden / entry.activeDays,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
    };
  });

  const equalisable = ledger.entries.map((entry) => entry.equalisableBurden);

  // The headline fairness figure excludes two groups, for two different reasons.
  //
  // **Low-sample** doctors, because an unstable denominator must not drive the number the practice
  // is judged by. **Departed** doctors, because the headline is a claim about how fairly the people
  // being rostered *now* are treated — a colleague who left in January is not part of that, and
  // their ratio would sit in the average forever.
  //
  // Neither group is hidden. Both keep their own figures in the per-doctor table, where they are
  // correct and where the ledger has to be able to answer "what did they carry while they were
  // here".
  const comparableRatios = doctors
    .filter((doctor) => doctor.ratioConfidence === 'ok' && doctor.membership === 'active')
    .map((doctor) => doctor.loadRatio)
    .filter((value): value is number => value !== null);
  const lowSample = doctors.filter((doctor) => doctor.ratioConfidence === 'low-sample');
  const departed = doctors.filter((doctor) => doctor.membership === 'inferred-departed');

  const heaviest = [...equalisable].sort((a, b) => b - a).slice(0, 4);
  const totalEqualisable = sum(equalisable);

  const shiftsByProvenance: Record<Provenance, number> = {
    directed: 0,
    requested: 0,
    absorbed: 0,
    unknown: 0,
  };
  for (const entry of ledger.entries) {
    for (const provenance of ['directed', 'requested', 'absorbed', 'unknown'] as const) {
      shiftsByProvenance[provenance] += entry.shiftsByProvenance[provenance];
    }
  }

  return {
    ledger,
    doctors,
    practice: {
      label: period.label,
      doctorCount: ledger.entries.length,
      totalShifts: ledger.totalShifts,
      totalBurden: ledger.totalBurden,
      uncoveredSlots: ledger.uncoveredSlots,
      giniBurden: gini(equalisable),
      jainBurden: jainIndex(equalisable),
      coefficientOfVariationBurden: coefficientOfVariation(equalisable),
      meanAbsoluteDeviationBurden: meanAbsoluteDeviation(equalisable),
      giniLoadRatio: gini(comparableRatios),
      activeDoctorCount: doctors.length - departed.length,
      departedDoctorCount: departed.length,
      leximaxBurden: leximaxVector(equalisable),
      topFourConcentration: totalEqualisable === 0 ? 0 : sum(heaviest) / totalEqualisable,
      entitlementBasis: entitlement.basis,
      burdenScheduleVersion: schedule.version,
      burdenScheduleConfidence: schedule.confidence,
      shiftsByProvenance,
      caveats: buildCaveats(schedule, entitlement, shiftsByProvenance, ledger, lowSample, departed),
    },
  };
}

function buildCaveats(
  schedule: BurdenSchedule,
  entitlement: EntitlementOptions,
  shiftsByProvenance: Record<Provenance, number>,
  ledger: Ledger,
  lowSample: readonly DoctorMetrics[],
  departed: readonly DoctorMetrics[],
): readonly string[] {
  const caveats: string[] = [];

  if (departed.length > 0) {
    caveats.push(
      `${String(departed.length)} doctor(s) — ${departed.map((doctor) => doctor.doctor).join(', ')} — worked no shift in the last ${String(DEPARTURE_GAP_DAYS)} days of this period, so their membership is inferred to have ended. Their own figures below are correct and cover only the time they were here; they are excluded from the practice-wide figure, which describes the doctors being rostered now. [INFERRED] — departures are never recorded on a roster.`,
    );
  }

  if (lowSample.length > 0) {
    caveats.push(
      `${String(lowSample.length)} doctor(s) — ${lowSample.map((doctor) => doctor.doctor).join(', ')} — were observed too little for a load ratio to mean anything: under ${String(MIN_SHIFTS_FOR_RATIO)} shifts, under ${String(MIN_ACTIVE_DAYS_FOR_RATIO)} days, or present for under ${String(Math.round(MIN_PRESENCE_SHARE_FOR_RATIO * 100))}% of the period. Their ratios are shown but excluded from the practice-wide figure. A recent joiner will appear here until they have been through enough of a period to compare.`,
    );
  }

  if (schedule.confidence !== 'CONFIRMED') {
    caveats.push(
      `Burden weights are [${schedule.confidence}] (schedule "${schedule.version}"). Every burden and load-ratio figure below is provisional until the practice agrees the weights.`,
    );
  }

  if (entitlement.basis === 'revealed-opportunity') {
    caveats.push(
      'Fair shares are derived from revealed availability — what each doctor was actually observed working — because declared availability was never recorded. This can only understate availability, so a doctor who was willing to work shifts they were never offered will look more overloaded than they are. [INFERRED]',
    );
  }

  if (entitlement.basis === 'equal') {
    caveats.push(
      'Fair shares assume every doctor is equally available. That is false for this practice, which has anchors on standing weekday slots and pool doctors who work weekends around a job elsewhere. Comparisons across those two groups are not meaningful on this basis.',
    );
  }

  const totalShifts = sum(Object.values(shiftsByProvenance));
  if (totalShifts > 0 && shiftsByProvenance.unknown / totalShifts > 0.5) {
    const percent = Math.round((shiftsByProvenance.unknown / totalShifts) * 100);
    caveats.push(
      `${String(percent)}% of shifts have no recorded provenance, so it is not known which were assigned by the scheduler, requested by the doctor, or absorbed because nobody else was available. Requested shifts should not count toward equalisation and here they cannot be separated out.`,
    );
  }

  if (ledger.uncoveredSlots > 0) {
    caveats.push(
      `${String(ledger.uncoveredSlots)} shift slot(s) in this period have no doctor assigned. Burden totals are therefore incomplete, and H-01 is violated.`,
    );
  }

  return caveats;
}
