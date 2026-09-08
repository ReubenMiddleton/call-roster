/**
 * Envy: the fairness check that needs no denominator.
 *
 * ## Why this exists beside the load ratio
 *
 * ADR-0012's load ratio divides what a doctor carried by what they *should* have carried, and the
 * denominator — `revealed-opportunity` — is fitted to this practice's own history. That is the
 * right choice, and it is also the project's single unfalsifiable number: history is what produced
 * it, so no amount of history can check it. Measured on 3 September 2026, the `revealed-opportunity`
 * ranking of who is overloaded correlates with an equal split at only ρ ≈ 0.6. **The choice of
 * denominator is most of the fairness verdict**, and nothing in the repository could tell you if it
 * were wrong.
 *
 * Envy is the cross-check, and its appeal is that it has no denominator to get wrong. It compares
 * doctors to each other directly:
 *
 * > **D07 envies D03 if D07 carried more burden than D03, and D07 could have worked D03's shifts.**
 *
 * No entitlement, no fair share, no fitted weights — two burdens and a feasibility test.
 *
 * ## EF1, and why the relaxation is not a fudge
 *
 * Exact envy-freeness is unachievable with indivisible shifts: someone has to take the last Sunday
 * night, and whoever does carries more than the person who did not. The standard relaxation in the
 * fair-division literature is **envy-freeness up to one item** — for chores, envy is forgiven if
 * removing a single shift from the *envious* doctor's own bundle eliminates it. An EF1 allocation
 * of indivisible chores always exists and round-robin finds one in polynomial time, so it is a bar
 * that can actually be met rather than an ideal to fall short of.
 *
 * Read aloud it is the sentence a rostering doctor would recognise: *"nobody is carrying more than
 * a colleague who could have taken it off them — bar a single shift."*
 *
 * ## The feasibility restriction, which is the whole adaptation
 *
 * Textbook EF1 compares every pair. Here that would be useless: a weekends-only doctor works
 * nothing but expensive shifts, so they envy almost everyone, and the measure would report the
 * practice as grossly unfair for a reason nobody can act on. So envy is counted **only between
 * doctors for whom a swap was actually possible** — D07 envies D03 only if every kind of cell D03
 * worked is one D07 has been seen working.
 *
 * ⚠️ **That restriction reads the same revealed cells the load ratio does**, so this is a partial
 * independence, not a clean one. It is nonetheless a real one: the cells here are a *filter on
 * which comparisons are meaningful*, never a *divisor*, so the self-referential failure that made a
 * published result wrong on 2 September 2026 — a candidate roster moving its own denominator —
 * cannot occur. Adding a doctor to a cell they have never worked widens who they may envy; it
 * cannot flatter their own number.
 *
 * ## ⚠️ A diagnosis, not a prescription — read this before quoting a violation
 *
 * The containment runs **envied ⊆ envious**, because envy means *"I would rather have your
 * position"*, and that is only coherent if the envious doctor could have held it. That is the
 * fair-division definition and it is the right one.
 *
 * It is **not** the condition for fixing the gap. Moving work from the over-loaded doctor to the
 * under-loaded one needs the *opposite* containment — the under-loaded doctor being able to work
 * the over-loaded one's shifts. At this practice the two rarely coincide: the anchors' opportunity
 * sets contain the pool doctors', so the anchors envy the pool doctors, and almost none of the gap
 * is movable, because a doctor available four days a month cannot absorb eight Sundays.
 *
 * So a violation of 27 burden units means **"the anchors would rather have had the pool doctors'
 * months, by 27 units"** — a true and useful statement about how the load sits. It does **not**
 * mean 27 units could have been reassigned. Quoting it as though it did would misrepresent an
 * availability problem as a scheduling failure, and the principal would rightly stop trusting the
 * number.
 *
 * **Report only, for now.** This is an indicator beside the load ratio, not a second objective —
 * see `docs/architecture/decisions/0015-envy-as-a-fairness-cross-check.md` for why a second
 * objective term was rejected.
 */

import { resolveBurden } from './burden.ts';
import type { BurdenSchedule } from './burden-types.ts';
import { buildLedger, cellKey, EQUALISABLE_PROVENANCES, revealedCells } from './ledger.ts';
import { indexShifts } from './shifts.ts';
import type { DoctorCode, IsoDate, RosterDay, RosterPeriod, ShiftPattern } from './types.ts';

/** One doctor's position, reduced to the three things envy needs. */
export interface EnvyInput {
  readonly doctor: DoctorCode;
  /** Burden carried. Use the equalisable burden — `requested` work is not grounds for envy. */
  readonly burden: number;
  /**
   * The burden of this doctor's single heaviest shift.
   *
   * The "up to one item" in EF1. Zero for a doctor who worked nothing, which is correct: they
   * cannot forgive envy by giving up a shift they do not have.
   */
  readonly heaviestShift: number;
  /** The `dayClass|shiftKind` cells this doctor has been seen working. */
  readonly cells: ReadonlySet<string>;
}

export interface EnvyPair {
  readonly envious: DoctorCode;
  readonly envied: DoctorCode;
  /** How much more burden the envious doctor carried. Always positive. */
  readonly margin: number;
  /**
   * The margin after removing the envious doctor's heaviest single shift.
   *
   * Zero or less means EF1 forgives this pair: one shift explains the whole gap.
   */
  readonly marginAfterOneShift: number;
}

export interface EnvyReport {
  /** Every envious pair, worst margin first. */
  readonly pairs: readonly EnvyPair[];
  /** The subset EF1 does **not** forgive — more than one shift's worth of unearned burden. */
  readonly violations: readonly EnvyPair[];
  /** True when no pair survives the one-shift forgiveness. The bar worth reporting. */
  readonly isEf1: boolean;
  /** The largest margin among the violations, in burden units. Zero when EF1 holds. */
  readonly worstViolation: number;
  /**
   * Ordered pairs where a swap was feasible at all — the denominator of "how much of the practice
   * this check can actually see".
   *
   * ⚠️ **Read this before the verdict.** A practice whose doctors have disjoint availability has
   * few comparable pairs, and "EF1 holds" then means "almost nothing was comparable", not "this is
   * fair". The report is only as strong as this number.
   */
  readonly comparablePairs: number;
}

export interface EnvyInputOptions {
  /**
   * Opportunity cells, if they should come from somewhere other than this period.
   *
   * Same seam as `EntitlementOptions.cells`: pass cells fitted on history to judge a candidate
   * roster, so the comparison set is fixed before the roster it is judging exists.
   */
  readonly cells?: ReadonlyMap<DoctorCode, ReadonlySet<string>>;
}

/**
 * Reduces a roster period to the per-doctor positions {@link envyReport} needs.
 *
 * Burden is the **equalisable** burden, so `requested` work is excluded on both sides: a doctor
 * who asked for extra shifts is not thereby a victim, and a colleague who did not ask is not
 * thereby a beneficiary. The heaviest-shift term is filtered the same way, so the one shift EF1
 * forgives is one that actually counted.
 */
export function envyInputs(
  period: RosterPeriod,
  patterns: readonly ShiftPattern[],
  schedule: BurdenSchedule,
  options: EnvyInputOptions = {},
): readonly EnvyInput[] {
  const ledger = buildLedger(period, patterns, schedule);
  const cells = options.cells ?? revealedCells(period, patterns);
  const shiftIndex = indexShifts(patterns);
  const dayIndex = new Map<IsoDate, RosterDay>(period.days.map((day) => [day.date, day]));
  const equalisable = new Set<string>(EQUALISABLE_PROVENANCES);

  const heaviest = new Map<DoctorCode, number>();
  for (const assignment of period.assignments) {
    if (!equalisable.has(assignment.provenance)) {
      continue;
    }
    const day = dayIndex.get(assignment.date);
    const shift = shiftIndex.get(assignment.shiftId);
    if (day === undefined || shift === undefined) {
      continue;
    }
    const { weight } = resolveBurden(day, shift, schedule);
    const previous = heaviest.get(assignment.doctor) ?? 0;
    if (weight > previous) {
      heaviest.set(assignment.doctor, weight);
    }
  }

  return ledger.entries.map((entry) => ({
    doctor: entry.doctor,
    burden: entry.equalisableBurden,
    heaviestShift: heaviest.get(entry.doctor) ?? 0,
    cells: cells.get(entry.doctor) ?? new Set<string>(),
  }));
}

/** Re-exported so a caller building `EnvyInput` by hand uses the one cell format. */
export { cellKey };

/**
 * Whether `envious` could have worked everything `envied` did.
 *
 * Bundle containment rather than per-shift, because EF1 is a statement about whole bundles: the
 * question is whether one doctor could have taken the other's month, not whether they could have
 * taken some of it.
 */
function couldHaveWorked(envious: EnvyInput, envied: EnvyInput): boolean {
  for (const cell of envied.cells) {
    if (!envious.cells.has(cell)) {
      return false;
    }
  }
  return true;
}

/**
 * Computes envy over feasible swaps, and whether the allocation is EF1.
 *
 * Pairs are ordered: `a` envying `b` is a different fact from `b` envying `a`, and only one of the
 * two can hold, since envy requires strictly more burden.
 */
export function envyReport(inputs: readonly EnvyInput[]): EnvyReport {
  const pairs: EnvyPair[] = [];
  let comparablePairs = 0;

  for (const envious of inputs) {
    for (const envied of inputs) {
      if (envious.doctor === envied.doctor) {
        continue;
      }
      if (!couldHaveWorked(envious, envied)) {
        continue;
      }
      comparablePairs += 1;
      const margin = envious.burden - envied.burden;
      if (margin <= 0) {
        continue;
      }
      pairs.push({
        envious: envious.doctor,
        envied: envied.doctor,
        margin,
        marginAfterOneShift: margin - envious.heaviestShift,
      });
    }
  }

  pairs.sort(
    (a, b) =>
      b.margin - a.margin || a.envious.localeCompare(b.envious) || a.envied.localeCompare(b.envied),
  );
  const violations = pairs.filter((pair) => pair.marginAfterOneShift > 0);

  return {
    pairs,
    violations,
    isEf1: violations.length === 0,
    worstViolation: violations[0]?.margin ?? 0,
    comparablePairs,
  };
}
