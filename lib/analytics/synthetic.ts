/**
 * Synthetic roster periods, built rather than transcribed.
 *
 * Two jobs, both of which matter:
 *
 * 1. **Tests.** The normalisation claims in `equity.ts` are only claims until something proves
 *    them arithmetically, and proving them needs a period whose right answer is known in advance.
 *    Real history cannot do that — nobody knows what the fair distribution of December 2025 was.
 * 2. **Demos and screenshots.** The repository is public and the real data is not. A synthetic
 *    tenant is the only safe way to show the product working. See the data boundary in AGENTS.md.
 *
 * Every doctor code here is synthetic and every pattern is the pilot practice's. Nothing in this
 * file describes a real person.
 */

import { classifyDay } from './shifts.ts';
import type {
  Assignment,
  DoctorCode,
  IsoDate,
  Provenance,
  RosterDay,
  RosterPeriod,
} from './types.ts';

/** Consecutive ISO dates, `count` of them, starting at `start`. */
export function dateRange(start: IsoDate, count: number): readonly IsoDate[] {
  const parts = start.split('-');
  const [year, month, day] = parts;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`not an ISO date: "${start}"`);
  }
  const origin = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const dates: IsoDate[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const value = new Date(origin + offset * 86_400_000).toISOString();
    dates.push(value.slice(0, 10));
  }
  return dates;
}

/**
 * How one doctor is available, as the synthetic builder understands it: a rule saying which
 * `dayClass` and which shift ids they will take.
 */
export interface SyntheticDoctor {
  readonly doctor: DoctorCode;
  /** Day classes this doctor works. */
  readonly dayClasses: readonly RosterDay['dayClass'][];
  /** Shift ids this doctor works. */
  readonly shiftIds: readonly string[];
  /** Provenance to stamp on their assignments. Defaults to `directed`. */
  readonly provenance?: Provenance;
}

/**
 * Builds a period in which every doctor works **every slot they are available for**, and no slot
 * is claimed twice.
 *
 * The invariant this gives the tests: since nobody could have worked more and nobody could have
 * worked less, the only defensible verdict is that the distribution is perfectly fair. Any
 * fairness measure that disagrees is measuring the wrong thing — which is exactly how the
 * normalisation tests are written.
 *
 * Throws if two doctors' rules overlap on the same slot, because a builder that silently dropped
 * one of them would quietly weaken every test built on it.
 */
export function buildSaturatedPeriod(
  label: string,
  dates: readonly IsoDate[],
  patternId: string,
  slotsPerDay: readonly string[],
  doctors: readonly SyntheticDoctor[],
  publicHolidays: ReadonlySet<IsoDate> = new Set(),
): RosterPeriod {
  const days: RosterDay[] = dates.map((date) => ({
    date,
    patternId,
    dayClass: classifyDay(date, publicHolidays.has(date)),
  }));

  const assignments: Assignment[] = [];
  const claimed = new Set<string>();

  for (const day of days) {
    for (const shiftId of slotsPerDay) {
      const eligible = doctors.filter(
        (candidate) =>
          candidate.dayClasses.includes(day.dayClass) && candidate.shiftIds.includes(shiftId),
      );
      if (eligible.length > 1) {
        throw new Error(
          `synthetic period "${label}": ${eligible.map((d) => d.doctor).join(', ')} all claim ${day.date}/${shiftId}`,
        );
      }
      const owner = eligible[0];
      if (owner === undefined) {
        continue;
      }
      const key = `${day.date}|${shiftId}`;
      if (claimed.has(key)) {
        throw new Error(`synthetic period "${label}": ${key} claimed twice`);
      }
      claimed.add(key);
      assignments.push({
        date: day.date,
        shiftId,
        doctor: owner.doctor,
        provenance: owner.provenance ?? 'directed',
      });
    }
  }

  return { label, days, assignments };
}

/**
 * The scenario that motivates the whole normalisation design: five doctors with mutually
 * exclusive availability, each working everything they can.
 *
 * - `S01` weekday mornings only
 * - `S02` weekday afternoons only
 * - `S03` weekday nights only
 * - `S04` Saturdays only, all three shifts
 * - `S05` Sundays only, all three shifts
 *
 * **Twelve complete weeks** from Monday 6 January 2025 — 60 weekdays, 12 Saturdays, 12 Sundays.
 * Nobody could have worked more or less than they did, so the correct fairness verdict is that all
 * five are exactly fair, and a naive measure says `S05` is overloaded because Sundays are
 * expensive.
 *
 * The length is not arbitrary. At four weeks every doctor here trips the low-sample guard in
 * `metrics.ts` — correctly, because four weeks is thin evidence about anyone's availability — and
 * the practice-wide figure has nothing left to average. Twelve weeks clears both thresholds while
 * keeping the arithmetic checkable by hand.
 */
export function heterogeneousAvailabilityPeriod(): RosterPeriod {
  return buildSaturatedPeriod(
    'heterogeneous-availability',
    dateRange('2025-01-06', 84),
    'A',
    ['std-morning', 'std-afternoon', 'std-night'],
    [
      { doctor: 'S01', dayClasses: ['weekday'], shiftIds: ['std-morning'] },
      { doctor: 'S02', dayClasses: ['weekday'], shiftIds: ['std-afternoon'] },
      { doctor: 'S03', dayClasses: ['weekday'], shiftIds: ['std-night'] },
      {
        doctor: 'S04',
        dayClasses: ['saturday'],
        shiftIds: ['std-morning', 'std-afternoon', 'std-night'],
      },
      {
        doctor: 'S05',
        dayClasses: ['sunday'],
        shiftIds: ['std-morning', 'std-afternoon', 'std-night'],
      },
    ],
  );
}
