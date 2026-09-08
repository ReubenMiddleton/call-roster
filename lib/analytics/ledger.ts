/**
 * The burden ledger: what each doctor actually carried, why they carried it, and what a fair
 * share would have been.
 *
 * This is the module the whole project is for. Everything else the product does is a better
 * version of something the practice already does on paper; a running cross-month ledger is the
 * one thing a paper diary structurally cannot produce.
 */

import { resolveBurden } from './burden.ts';
import type { BurdenSchedule } from './burden-types.ts';
import { type EntitlementBasis, sum } from './equity.ts';
import { dayOfWeek, inclusiveDayCount, indexShifts } from './shifts.ts';
import type {
  DayClass,
  DoctorCode,
  IsoDate,
  Provenance,
  RosterDay,
  RosterPeriod,
  ShiftKind,
  ShiftPattern,
} from './types.ts';

/**
 * Provenances whose burden the fairness objective equalises.
 *
 * `requested` is excluded, and that exclusion is the single most consequential line in this
 * module. A doctor who asks for extra shifts — for the income, or to cover for a colleague — must
 * not have next month's work withheld as a consequence. Crediting requested burden to the
 * equalisation term does exactly that, and it would read to the doctor as being punished for
 * volunteering.
 *
 * `absorbed` **is** included, deliberately, on the practice owner's explicit instruction: burden
 * taken on because nobody else was available is a recurring operational failure, and a system
 * that hides it destroys the evidence needed to argue for fixing it. See
 * `docs/domain/fairness.md`.
 *
 * `unknown` is included because every historical assignment carries it and excluding it would
 * empty the ledger. It is reported separately so no one can mistake fifteen months of unrecorded
 * provenance for fifteen months of scheduler-directed work.
 */
export const EQUALISABLE_PROVENANCES: readonly Provenance[] = ['directed', 'absorbed', 'unknown'];

function emptyProvenanceTally(): Record<Provenance, number> {
  return { directed: 0, requested: 0, absorbed: 0, unknown: 0 };
}

function emptyDayClassTally(): Record<DayClass, number> {
  return { weekday: 0, saturday: 0, sunday: 0, 'public-holiday': 0 };
}

function emptyShiftKindTally(): Record<ShiftKind, number> {
  return { morning: 0, afternoon: 0, evening: 0, night: 0, 'long-day': 0 };
}

export interface DoctorLedgerEntry {
  readonly doctor: DoctorCode;
  readonly shifts: number;
  /** Total burden carried, every provenance included. */
  readonly burden: number;
  /** Burden the fairness objective should equalise — total less `requested`. */
  readonly equalisableBurden: number;
  readonly burdenByProvenance: Record<Provenance, number>;
  readonly shiftsByProvenance: Record<Provenance, number>;
  /** Shift **counts**, not burden — these are the indicators the objective does not optimise. */
  readonly shiftsByDayClass: Record<DayClass, number>;
  /**
   * Shifts falling on a Friday, counted separately from `shiftsByDayClass`.
   *
   * A Friday classifies as `weekday` for burden purposes, but the owner confirmed on 31 August
   * 2026 that the practice counts Friday as part of the weekend. Until the boundary *within*
   * Friday is settled, this is counted and not folded into anything — see the Weekend entry in
   * `docs/product/glossary.md`. Deliberately not named after "weekend".
   */
  readonly shiftsOnFriday: number;
  readonly shiftsByShiftKind: Record<ShiftKind, number>;
  /** First and last date this doctor appears on. `[INFERRED]` membership window. */
  readonly firstSeen: IsoDate;
  readonly lastSeen: IsoDate;
  /** Days from `firstSeen` to `lastSeen` inclusive. */
  readonly activeDays: number;
}

export interface Ledger {
  readonly label: string;
  readonly scheduleVersion: string;
  readonly scheduleConfidence: BurdenSchedule['confidence'];
  readonly entries: readonly DoctorLedgerEntry[];
  readonly totalBurden: number;
  readonly totalShifts: number;
  /** Slots in the period that no doctor was assigned to. Should be zero; H-01 says so. */
  readonly uncoveredSlots: number;
}

/**
 * How much history the fairness objective carries into a solve. ✅ `[CONFIRMED 2026-09-04]`
 *
 * **Not a technical constant — a policy, and it is the principal's.** Relayed on 2 September 2026
 * and confirmed by him directly on 4 September:
 *
 * > *"My dad thinks that a 90 day period or 3 months is a good time period to analyse to generate
 * > the next month's roster with."*
 *
 * ⚠️ **And he does not regard the current spread as an imbalance at all** — *"D01–D04 are all anchor
 * doctors and therefore generally work more than the other doctors during the week."* That is worth
 * more than the number. The four anchors sit at 1.55, 1.45, 1.21 and 1.15, and **that is the roster
 * he intends**, not a fault to be corrected. A solver that drives those toward 1.00 would be
 * undoing a deliberate arrangement. What S-01 is for is the *unintended* drift on top of it.
 *
 * ## Why it is also the right engineering default
 *
 * Measured, before the steer arrived. With all 33 months in the ledger, one month is ~3% of it, so
 * moving a single shift changes a doctor's cumulative ratio by about **a tenth of a percentage
 * point**. S-01's objective is then nearly flat, and the solver chooses arbitrarily among thousands
 * of near-equal rosters — sweeping the weights moved the result *non-monotonically*, which is the
 * signature of exactly that. A bounded window gives the objective real traction: over three months
 * one month is a quarter of the ledger.
 *
 * The deeper point, and the reason this is a policy rather than a tuning knob: **an unbounded ledger
 * asks one month to repay years of accumulated imbalance**, which can only be done by giving the
 * over-carried doctors almost no work. See `docs/domain/fairness.md`.
 *
 * Use {@link ledgerCutoff} rather than reading this directly, so the window is applied one way.
 */
export const LEDGER_WINDOW_MONTHS = 3;

/**
 * How much history **S-08** carries — the public-holiday ledger. `[CONFIRMED as a goal]`
 *
 * **Twelve, not three, and the difference is the whole point.** The principal volunteered this on
 * 4 September 2026 as the thing that matters most to him:
 *
 * > *"The fairness scale is very important, and the fact that all the public holidays throughout
 * > the year are shared by the doctors so that the same small handful of doctors don't cover the
 * > public holidays every year."*
 *
 * **"Throughout the year"** is the operative phrase. South Africa has twelve statutory holidays, so
 * this practice sees roughly **44 holiday slots a year**. Over {@link LEDGER_WINDOW_MONTHS} a solve
 * would see about eleven of them, spread across thirteen doctors — too few to say anything about
 * whether holidays are being shared. Over twelve months there are enough to be fair with.
 *
 * ⚠️ **He is describing something that already works, not a complaint.** Measured over 2024–2025,
 * holiday work runs *opposite* to ordinary work: the four anchors take 12–18% of all shifts but only
 * 6–11% of holidays, while the pool doctors take 2–5% of shifts and 5–9% of holidays. The top four
 * rotates year to year. **S-08 exists to stop the solver breaking that**, not to correct it.
 *
 * And the solver does break it. Asked for December 2026 with S-08 absent, it gave **three of nine
 * holiday slots to D01** — who historically takes a tenth of them. The mechanism is H-10: a pool
 * GP's own practice is closed on a public holiday, so on a holiday *everyone* is available and
 * nothing in the objective prefers anyone. S-01 sees holiday burden as ordinary burden.
 */
export const HOLIDAY_LEDGER_WINDOW_MONTHS = 12;

/**
 * The earliest date the fairness ledger counts, for a solve of `month` (`YYYY-MM`).
 *
 * Encapsulated because two callers need it and must agree: the request builder, which decides what
 * the solver is *given*, and `measure-solver-departure`, which decides what the solver is *judged
 * on*. Marking it against a different window from the one it optimised would be marking it against
 * an exam it did not sit.
 */
export function ledgerCutoff(month: string, windowMonths = LEDGER_WINDOW_MONTHS): IsoDate {
  const parts = month.split('-');
  const [year, monthNumber] = parts;
  if (year === undefined || monthNumber === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  const at = new Date(Date.UTC(Number(year), Number(monthNumber) - 1 - windowMonths, 1));
  const iso = at.toISOString().slice(0, 10);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  return iso;
}

/**
 * The earliest date **S-08's** holiday ledger counts, for a solve of `month`.
 *
 * A separate function rather than a parameter at the call site, so the two windows cannot be
 * swapped by accident: they are different spans answering different questions, and a holiday
 * ledger scoped to three months would be measuring almost nothing.
 */
export function holidayLedgerCutoff(month: string): IsoDate {
  return ledgerCutoff(month, HOLIDAY_LEDGER_WINDOW_MONTHS);
}

/**
 * Accumulates a period of roster history into a ledger.
 *
 * Assignments naming a shift that is not in the supplied catalogue throw rather than being
 * skipped. A silently dropped assignment understates someone's burden, which is the one class of
 * bug a fairness ledger must never have.
 */
export function buildLedger(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
  schedule: BurdenSchedule,
): Ledger {
  const shiftIndex = indexShifts(patterns);
  const dayIndex = new Map<IsoDate, RosterDay>(period.days.map((day) => [day.date, day]));

  interface Accumulator {
    shifts: number;
    burden: number;
    burdenByProvenance: Record<Provenance, number>;
    shiftsByProvenance: Record<Provenance, number>;
    shiftsByDayClass: Record<DayClass, number>;
    shiftsByShiftKind: Record<ShiftKind, number>;
    shiftsOnFriday: number;
    firstSeen: IsoDate;
    lastSeen: IsoDate;
  }

  const accumulators = new Map<DoctorCode, Accumulator>();

  for (const assignment of period.assignments) {
    const day = dayIndex.get(assignment.date);
    if (day === undefined) {
      throw new Error(
        `assignment on ${assignment.date} (${assignment.shiftId}) has no matching day in period "${period.label}"`,
      );
    }
    const shift = shiftIndex.get(assignment.shiftId);
    if (shift === undefined) {
      throw new Error(
        `assignment on ${assignment.date} names unknown shift "${assignment.shiftId}"; add it to the pattern catalogue`,
      );
    }

    const { weight } = resolveBurden(day, shift, schedule);

    let accumulator = accumulators.get(assignment.doctor);
    if (accumulator === undefined) {
      accumulator = {
        shifts: 0,
        burden: 0,
        burdenByProvenance: emptyProvenanceTally(),
        shiftsByProvenance: emptyProvenanceTally(),
        shiftsByDayClass: emptyDayClassTally(),
        shiftsByShiftKind: emptyShiftKindTally(),
        shiftsOnFriday: 0,
        firstSeen: assignment.date,
        lastSeen: assignment.date,
      };
      accumulators.set(assignment.doctor, accumulator);
    }

    accumulator.shifts += 1;
    accumulator.burden += weight;
    accumulator.burdenByProvenance[assignment.provenance] += weight;
    accumulator.shiftsByProvenance[assignment.provenance] += 1;
    accumulator.shiftsByDayClass[day.dayClass] += 1;
    accumulator.shiftsByShiftKind[shift.kind] += 1;
    if (dayOfWeek(assignment.date) === 5) {
      accumulator.shiftsOnFriday += 1;
    }
    if (assignment.date < accumulator.firstSeen) {
      accumulator.firstSeen = assignment.date;
    }
    if (assignment.date > accumulator.lastSeen) {
      accumulator.lastSeen = assignment.date;
    }
  }

  const entries: DoctorLedgerEntry[] = [];
  for (const [doctor, accumulator] of accumulators) {
    const equalisableBurden = sum(
      EQUALISABLE_PROVENANCES.map((provenance) => accumulator.burdenByProvenance[provenance]),
    );
    entries.push({
      doctor,
      shifts: accumulator.shifts,
      burden: accumulator.burden,
      equalisableBurden,
      burdenByProvenance: accumulator.burdenByProvenance,
      shiftsByProvenance: accumulator.shiftsByProvenance,
      shiftsByDayClass: accumulator.shiftsByDayClass,
      shiftsByShiftKind: accumulator.shiftsByShiftKind,
      shiftsOnFriday: accumulator.shiftsOnFriday,
      firstSeen: accumulator.firstSeen,
      lastSeen: accumulator.lastSeen,
      activeDays: inclusiveDayCount(accumulator.firstSeen, accumulator.lastSeen),
    });
  }
  entries.sort((a, b) => b.burden - a.burden || a.doctor.localeCompare(b.doctor));

  const slotsInPeriod = sum(
    period.days.map((day) => {
      const pattern = patterns.find((candidate) => candidate.id === day.patternId);
      return pattern === undefined ? 0 : pattern.shifts.length;
    }),
  );

  return {
    label: period.label,
    scheduleVersion: schedule.version,
    scheduleConfidence: schedule.confidence,
    entries,
    totalBurden: sum(entries.map((entry) => entry.burden)),
    totalShifts: period.assignments.length,
    uncoveredSlots: Math.max(0, slotsInPeriod - period.assignments.length),
  };
}

/**
 * The set of `dayClass|shiftKind` cells a doctor has ever been observed working.
 *
 * This is the **revealed availability** proxy, and its limits need stating plainly because it is
 * the load-bearing assumption in the whole normalisation:
 *
 * - **It can only understate.** A doctor perfectly willing to work Tuesday nights who was never
 *   given one looks unavailable for Tuesday nights, so their denominator is too small and they
 *   look more overloaded than they are.
 * - **It over-generalises from single instances.** One Sunday night ever worked marks a doctor
 *   available for *every* Sunday night in the period.
 * - **It cannot see a declined offer**, a holiday, or a month at another practice.
 *
 * It is nonetheless the only availability signal fifteen months of roster sheets contain, and it
 * is strictly better than pretending everyone was available for everything. Every figure derived
 * from it is `[INFERRED]` and must be labelled so. Once the product captures real availability,
 * this function is replaced rather than refined — the interface is the seam.
 */
export function revealedCells(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
): ReadonlyMap<DoctorCode, ReadonlySet<string>> {
  const shiftIndex = indexShifts(patterns);
  const dayIndex = new Map<IsoDate, RosterDay>(period.days.map((day) => [day.date, day]));
  const cells = new Map<DoctorCode, Set<string>>();

  for (const assignment of period.assignments) {
    const day = dayIndex.get(assignment.date);
    const shift = shiftIndex.get(assignment.shiftId);
    if (day === undefined || shift === undefined) {
      continue;
    }
    let set = cells.get(assignment.doctor);
    if (set === undefined) {
      set = new Set<string>();
      cells.set(assignment.doctor, set);
    }
    set.add(cellKey(day.dayClass, shift.kind));
  }

  return cells;
}

/** The opportunity-set key. Exported so a test can assert on it without duplicating the format. */
export function cellKey(dayClass: DayClass, shiftKind: ShiftKind): string {
  return `${dayClass}|${shiftKind}`;
}

export interface EntitlementOptions {
  readonly basis: EntitlementBasis;
  /** Required when `basis` is `explicit`: the caller's own weights, e.g. contracted FTE. */
  readonly explicitWeights?: ReadonlyMap<DoctorCode, number>;
  /**
   * Opportunity cells to use with `revealed-opportunity`, instead of reading them off `period`.
   *
   * **The seam that makes an honest out-of-sample answer possible.** Left undefined, the cells come
   * from the same period being scored, so the denominator is derived from the very assignments in
   * the numerator: put a doctor in a cell they have never worked and their own fair share grows to
   * accommodate it. That is fine for describing history — the period *is* the evidence — and wrong
   * for two other jobs:
   *
   * - **Scoring candidate rosters.** Two candidates get marked on two different scales, and the
   *   one that sticks to habit wins by moving its own denominator less. This caused a published
   *   result to be wrong on 2 September 2026; see `docs/DECISIONS.md`.
   * - **Testing whether the basis generalises.** Fit the cells on earlier months, apply them to a
   *   later one, and the gap between that and the in-sample figure *is* the overfitting.
   *
   * It is also the shape real declared availability will arrive in, so the two are one interface.
   */
  readonly cells?: ReadonlyMap<DoctorCode, ReadonlySet<string>>;
}

/**
 * Derives each doctor's entitlement weight — the denominator that makes load ratios comparable.
 *
 * See `EntitlementBasis` in `equity.ts` for why the choice matters and why
 * `revealed-opportunity` is the default for historical data.
 */
export function entitlementWeights(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
  schedule: BurdenSchedule,
  ledger: Ledger,
  options: EntitlementOptions,
): ReadonlyMap<DoctorCode, number> {
  const weights = new Map<DoctorCode, number>();

  if (options.basis === 'explicit') {
    if (options.explicitWeights === undefined) {
      throw new Error('basis "explicit" requires explicitWeights');
    }
    for (const entry of ledger.entries) {
      weights.set(entry.doctor, options.explicitWeights.get(entry.doctor) ?? 0);
    }
    return weights;
  }

  if (options.basis === 'equal') {
    for (const entry of ledger.entries) {
      weights.set(entry.doctor, 1);
    }
    return weights;
  }

  if (options.basis === 'active-days') {
    for (const entry of ledger.entries) {
      weights.set(entry.doctor, entry.activeDays);
    }
    return weights;
  }

  // revealed-opportunity
  const cells = options.cells ?? revealedCells(period, patterns);
  const shiftIndex = indexShifts(patterns);
  const patternIndex = new Map<string, ShiftPattern>(
    patterns.map((pattern) => [pattern.id, pattern]),
  );

  for (const entry of ledger.entries) {
    const doctorCells = cells.get(entry.doctor);
    if (doctorCells === undefined) {
      weights.set(entry.doctor, 0);
      continue;
    }
    let opportunityBurden = 0;
    for (const day of period.days) {
      // Scoped to the doctor's inferred membership window: a doctor who left in March was not
      // "available" for August and must not be penalised for it.
      if (day.date < entry.firstSeen || day.date > entry.lastSeen) {
        continue;
      }
      const pattern = patternIndex.get(day.patternId);
      if (pattern === undefined) {
        continue;
      }
      for (const patternShift of pattern.shifts) {
        const shift = shiftIndex.get(patternShift.id);
        if (shift === undefined) {
          continue;
        }
        if (!doctorCells.has(cellKey(day.dayClass, shift.kind))) {
          continue;
        }
        opportunityBurden += resolveBurden(day, shift, schedule).weight;
      }
    }
    weights.set(entry.doctor, opportunityBurden);
  }

  return weights;
}

/** Convenience: the equalisable-burden vector, in ledger order. For `compareLeximax`. */
export function equalisableBurdenVector(ledger: Ledger): readonly number[] {
  return ledger.entries.map((entry) => entry.equalisableBurden);
}
