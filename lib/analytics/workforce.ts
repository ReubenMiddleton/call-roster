/**
 * Workforce composition over time, and when it changed enough to invalidate a constraint verdict.
 *
 * ## Why this exists
 *
 * Two constraints in this practice turned out to be **artefacts of headcount**, not statements about
 * anyone's habits:
 *
 * - **H-02** ("at most one shift per doctor per day") was false for eight months and became true in
 *   August 2024 — the month D04 took the Tuesday-night slot that D03 had been covering with a double
 *   shift. D04 does not appear anywhere before 21 March 2024.
 * - **H-07** ("D01 never works a Friday") went from 8.1% broken to 1.9% broken across early 2025,
 *   over the same period the roster grew from eleven doctors to thirteen.
 *
 * In both cases a verdict computed on one workforce would have been wrong about another. The
 * catalogue currently gets re-verified when somebody *states* a new rule; nothing re-verifies it when
 * the *roster* changes, which is what actually moved these two.
 *
 * This module supplies the missing signal. It does not decide anything — it says *"composition
 * changed here, and any verdict spanning that boundary is mixing two practices."*
 *
 * ## What counts as a change
 *
 * A joiner or a leaver. Both are `[INFERRED]`, because a roster records who worked and never who
 * arrived or left — see `DEPARTURE_GAP_DAYS` in `metrics.ts` for the 90-day threshold the principal
 * independently confirmed.
 */

import { inclusiveDayCount } from './shifts.ts';
import type { DoctorCode, IsoDate, RosterPeriod } from './types.ts';

/**
 * Days without a shift, mid-history, after which a doctor is treated as having left.
 *
 * Same 90 days as `DEPARTURE_GAP_DAYS`, and confirmed by the principal: *"90 days is a good way to
 * check — that is the number he has in his head as well."* Duplicated as a named constant rather than
 * imported so that this module has no dependency on the metrics layer; they are the same number for
 * the same reason, not by coincidence.
 */
export const ABSENCE_IS_DEPARTURE_DAYS = 90;

export interface WorkforceChange {
  /** The month the change is attributed to, `YYYY-MM`. */
  readonly month: string;
  readonly kind: 'joined' | 'left';
  readonly doctor: DoctorCode;
  /** First shift for a joiner, last shift for a leaver. */
  readonly date: IsoDate;
}

export interface WorkforceSpan {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly months: number;
  /** Doctors present throughout the span. */
  readonly roster: readonly DoctorCode[];
}

export interface WorkforceTimeline {
  readonly changes: readonly WorkforceChange[];
  /**
   * Periods of stable composition, split at every change.
   *
   * **A constraint verdict is only safely comparable within one span.** A verdict computed across a
   * boundary is describing two different practices at once.
   */
  readonly spans: readonly WorkforceSpan[];
  /** Distinct doctors working, per month. */
  readonly headcountByMonth: readonly { readonly month: string; readonly headcount: number }[];
}

function monthOf(date: IsoDate): string {
  return date.slice(0, 7);
}

/**
 * Builds the timeline from roster history.
 *
 * A doctor's first shift is a join; a gap of more than `ABSENCE_IS_DEPARTURE_DAYS` followed by a
 * later shift is a leave **and** a re-join, which is the honest reading — the alternative is deciding
 * from a roster that someone was on unpaid leave, which a roster cannot tell you.
 */
export function buildWorkforceTimeline(period: RosterPeriod): WorkforceTimeline {
  const datesByDoctor = new Map<DoctorCode, IsoDate[]>();
  for (const assignment of period.assignments) {
    const existing = datesByDoctor.get(assignment.doctor);
    if (existing === undefined) {
      datesByDoctor.set(assignment.doctor, [assignment.date]);
    } else {
      existing.push(assignment.date);
    }
  }

  const changes: WorkforceChange[] = [];
  for (const [doctor, dates] of datesByDoctor) {
    const sorted = [...new Set(dates)].sort();
    const first = sorted[0];
    if (first === undefined) {
      continue;
    }
    changes.push({ month: monthOf(first), kind: 'joined', doctor, date: first });

    // Walk the gaps. A long one is a departure followed by a return.
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      if (inclusiveDayCount(previous, current) - 1 > ABSENCE_IS_DEPARTURE_DAYS) {
        changes.push({ month: monthOf(previous), kind: 'left', doctor, date: previous });
        changes.push({ month: monthOf(current), kind: 'joined', doctor, date: current });
      }
    }

    const last = sorted[sorted.length - 1];
    const periodEnd =
      period.days.length === 0
        ? undefined
        : [...period.days].sort((a, b) => a.date.localeCompare(b.date))[period.days.length - 1]
            ?.date;
    if (last !== undefined && periodEnd !== undefined) {
      if (inclusiveDayCount(last, periodEnd) - 1 > ABSENCE_IS_DEPARTURE_DAYS) {
        changes.push({ month: monthOf(last), kind: 'left', doctor, date: last });
      }
    }
  }

  changes.sort((a, b) => a.date.localeCompare(b.date) || a.doctor.localeCompare(b.doctor));

  // Headcount per month, and the spans between changes.
  const monthsSeen = [...new Set(period.assignments.map((a) => monthOf(a.date)))].sort();
  const headcountByMonth = monthsSeen.map((month) => ({
    month,
    headcount: new Set(
      period.assignments.filter((a) => monthOf(a.date) === month).map((a) => a.doctor),
    ).size,
  }));

  const changeMonths = new Set(changes.map((change) => change.month));
  const spans: WorkforceSpan[] = [];
  let spanStart = monthsSeen[0];
  for (const [index, month] of monthsSeen.entries()) {
    const isLast = index === monthsSeen.length - 1;
    const nextMonth = monthsSeen[index + 1];
    const boundary = isLast || (nextMonth !== undefined && changeMonths.has(nextMonth));
    if (boundary && spanStart !== undefined) {
      const inSpan = monthsSeen.slice(monthsSeen.indexOf(spanStart), index + 1);
      const roster = new Set<DoctorCode>();
      for (const assignment of period.assignments) {
        if (inSpan.includes(monthOf(assignment.date))) {
          roster.add(assignment.doctor);
        }
      }
      spans.push({
        fromMonth: spanStart,
        toMonth: month,
        months: inSpan.length,
        roster: [...roster].sort(),
      });
      spanStart = nextMonth;
    }
  }

  return { changes, spans, headcountByMonth };
}

/**
 * Whether a verdict computed over `fromMonth`–`toMonth` spans a composition change.
 *
 * The question a re-verification trigger needs answered: *"is this verdict describing one practice or
 * several?"*
 */
export function spansWorkforceChange(
  timeline: WorkforceTimeline,
  fromMonth: string,
  toMonth: string,
): readonly WorkforceChange[] {
  // A change in the very first month of a window is not a change *within* it - the window simply
  // starts at a new roster.
  return timeline.changes.filter((change) => change.month > fromMonth && change.month <= toMonth);
}
