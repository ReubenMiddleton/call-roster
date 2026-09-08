/**
 * Derives the practice's recurring weekday slots from what people were actually observed working.
 *
 * `docs/domain/shift-patterns.md` has a table of who holds which weekday slot. This computes the
 * same thing from the assignments, for the reason `inferAvailability` exists next door: **a derived
 * table survives a handover and a hand-maintained one does not.** D05 took the Monday and Tuesday
 * 15:00–23:00 slots from D04 and D03 in June 2026, and nothing about either doctor's status changed.
 *
 * ## Why this module was extracted, on 2 September 2026
 *
 * `scripts/build-solve-request.ts` was sending **`recurringSlots: []`**. S-05 — *prefer the anchor
 * doctor in their own recurring slot* — is implemented in the solver and iterates
 * `instance.recurring_slots`, so with an empty array it registered **no penalties at all**. Nothing
 * in the objective pulled toward the way the practice actually works.
 *
 * The effect was invisible from inside the solver, which reported `OPTIMAL` with objective 0 and
 * zero violations, and glaring from outside it: `npm run seed:solver-departure` scored the solved
 * month **further from the practice's habits on every axis than any real month in three years**,
 * missing 25 anchor slots against the principal's 4. *An empty objective makes every feasible roster
 * optimal*, and "OPTIMAL, objective 0" was reporting an under-constrained model as a solved one.
 *
 * ## The trailing window
 *
 * Anchors change hands, so deriving them from *all* history returns the pre-handover holder forever.
 * {@link inferRecurringSlots} therefore looks at a trailing window ending at the target month.
 *
 * ⚠️ **This is a simplification, and a knowingly incomplete one.** The contract's
 * `RecurringSlotInput` carries `validFrom` / `validUntil`, which is the correct model — a slot that
 * changed hands is two intervals, not one current holder, and that is exactly what
 * [ADR-0008](../../docs/architecture/decisions/0008-temporal-validity-intervals.md) is about.
 * Deriving the change points is a separate piece of work; until then a window gives the solver the
 * *current* arrangement, which is what next month needs.
 */

import type { Assignment, DoctorCode, IsoDate, RosterPeriod, ShiftId } from './types.ts';

/**
 * How dominant a doctor must be in a weekday slot before it counts as *theirs*.
 *
 * Two thirds, deliberately above a simple majority: `shift-patterns.md` describes real anchors as
 * the same three doctors every week for sixteen months, so a genuine one is far above this. A slot
 * held 51/49 is a rotation, and treating it as an anchor would push the solver to reproduce a
 * coin-flip.
 */
export const ANCHOR_DOMINANCE = 2 / 3;

/** Months of trailing history used to decide who currently holds a slot. */
export const ANCHOR_WINDOW_MONTHS = 6;

/** UTC weekday, 0 = Sunday. Local to this side; a weekday never crosses the solver boundary. */
function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** `weekday|shiftId`, the key both consumers of this module use. */
export function slotKey(weekday: number, shiftId: ShiftId): string {
  return `${String(weekday)}|${shiftId}`;
}

/**
 * The dominant holder of each `weekday|shiftId`, where one exists.
 *
 * A slot with no doctor above {@link ANCHOR_DOMINANCE} is absent from the result rather than being
 * given its most frequent occupant — reporting a rotation as an anchor is worse than reporting no
 * anchor, because every ordinary turn then looks like a departure.
 */
export function anchorHolders(assignments: readonly Assignment[]): ReadonlyMap<string, DoctorCode> {
  const perSlot = new Map<string, Map<DoctorCode, number>>();
  for (const assignment of assignments) {
    const key = slotKey(weekdayOf(assignment.date), assignment.shiftId);
    const counts = perSlot.get(key) ?? new Map<DoctorCode, number>();
    counts.set(assignment.doctor, (counts.get(assignment.doctor) ?? 0) + 1);
    perSlot.set(key, counts);
  }

  const holders = new Map<string, DoctorCode>();
  for (const [key, counts] of perSlot) {
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    for (const [doctor, count] of counts) {
      if (count / total >= ANCHOR_DOMINANCE) {
        holders.set(key, doctor);
        break;
      }
    }
  }
  return holders;
}

/**
 * Months a slot must have been held consistently before a handover is believed.
 *
 * Two, not one: one month of a new name is a stand-in, a holiday or a transcription slip, and
 * acting on it would throw away a year of a real holder's history. Two consecutive months is the
 * cheapest thing that is not noise.
 */
export const HANDOVER_CONFIRM_MONTHS = 2;

/**
 * The date a slot's *current* arrangement began, or `undefined` if it never changed hands.
 *
 * ⚠️ **This exists because the window straddling a handover produced a measurably wrong roster.**
 * Blind-generating September 2026 gave D03 three Tuesday afternoons; the practice gave him none and
 * gave all four to D05, who had taken the slot outright in July. The six-month window held four
 * pre-handover months against two post-, so it reported **D03 at 58% of a slot he had not worked in
 * three months** — below {@link ANCHOR_DOMINANCE}, so it did not even register as an anchor
 * changing hands. It became a *rotation between the old holder and the new one*, which is the one
 * thing it certainly was not.
 *
 * The method is deliberately blunt: take each month's outright majority holder, then walk back from
 * the most recent while the holder is unchanged. A genuine rotation has no stable monthly majority,
 * so the walk stops immediately and the full window is used — which is the correct answer for it.
 *
 * This is the cheap half of what `validFrom`/`validUntil` on the contract already model properly,
 * and of [ADR-0008](../../docs/architecture/decisions/0008-temporal-validity-intervals.md). A slot
 * that changed hands is two intervals; this finds the boundary of the current one.
 */
function currentArrangementStart(
  assignments: readonly Assignment[],
  key: string,
): IsoDate | undefined {
  const perMonth = new Map<string, Map<DoctorCode, number>>();
  for (const assignment of assignments) {
    if (slotKey(weekdayOf(assignment.date), assignment.shiftId) !== key) {
      continue;
    }
    const month = assignment.date.slice(0, 7);
    const counts = perMonth.get(month) ?? new Map<DoctorCode, number>();
    counts.set(assignment.doctor, (counts.get(assignment.doctor) ?? 0) + 1);
    perMonth.set(month, counts);
  }

  // Each month's outright majority holder, newest first. `undefined` where the month is itself a
  // rotation — which stops the walk, because an arrangement nobody held is not one to preserve.
  const months = [...perMonth.keys()].sort().reverse();
  const holderOf = (month: string): DoctorCode | undefined => {
    const counts = perMonth.get(month);
    if (counts === undefined) return undefined;
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    for (const [doctor, count] of counts) {
      if (count * 2 > total) return doctor;
    }
    return undefined;
  };

  const newest = months[0];
  if (newest === undefined) return undefined;
  const current = holderOf(newest);
  if (current === undefined) return undefined;

  let held = 0;
  let earliest = newest;
  for (const month of months) {
    if (holderOf(month) !== current) break;
    held += 1;
    earliest = month;
  }

  // Unchanged across the whole window, or too short to believe: use everything.
  if (held === months.length || held < HANDOVER_CONFIRM_MONTHS) return undefined;
  return `${earliest}-01`;
}

/**
 * Narrows each slot's observations to the current arrangement, where one began mid-window.
 *
 * Shared by {@link inferRecurringSlots} and {@link inferSlotShares} so the two cannot disagree
 * about who currently works a slot — they partition the slots between them, and a partition drawn
 * from two different spans is not a partition.
 */
function withinCurrentArrangement(assignments: readonly Assignment[]): readonly Assignment[] {
  const starts = new Map<string, IsoDate | undefined>();
  for (const assignment of assignments) {
    const key = slotKey(weekdayOf(assignment.date), assignment.shiftId);
    if (!starts.has(key)) {
      starts.set(key, currentArrangementStart(assignments, key));
    }
  }
  return assignments.filter((assignment) => {
    const start = starts.get(slotKey(weekdayOf(assignment.date), assignment.shiftId));
    return start === undefined || assignment.date >= start;
  });
}

/** One derived recurring slot, in the shape `buildSolveRequest` takes. */
export interface DerivedRecurringSlot {
  readonly doctor: DoctorCode;
  /** 0 = Sunday, this side's convention. Converted to a name at the wire. */
  readonly weekday: number;
  readonly shiftId: ShiftId;
  /** How many times the holder took the slot inside the window, and out of how many. */
  readonly held: number;
  readonly observed: number;
}

export interface InferRecurringSlotsOptions {
  /** Only assignments on or after this date are considered. */
  readonly from?: IsoDate;
  /** Only assignments strictly before this date are considered. */
  readonly before?: IsoDate;
  /** A slot seen fewer times than this in the window is too thin to call. */
  readonly minObservations?: number;
}

/**
 * Recurring slots as the request builder should send them.
 *
 * `minObservations` defaults to 4 — roughly one occurrence a week over a month. Below that a "slot"
 * is a coincidence, and sending it would have the solver defend a pattern that does not exist.
 */
export function inferRecurringSlots(
  period: RosterPeriod,
  options: InferRecurringSlotsOptions = {},
): readonly DerivedRecurringSlot[] {
  const minObservations = options.minObservations ?? 4;
  const inWindow = withinCurrentArrangement(
    period.assignments.filter(
      (assignment) =>
        (options.from === undefined || assignment.date >= options.from) &&
        (options.before === undefined || assignment.date < options.before),
    ),
  );

  const perSlot = new Map<string, Map<DoctorCode, number>>();
  for (const assignment of inWindow) {
    const key = slotKey(weekdayOf(assignment.date), assignment.shiftId);
    const counts = perSlot.get(key) ?? new Map<DoctorCode, number>();
    counts.set(assignment.doctor, (counts.get(assignment.doctor) ?? 0) + 1);
    perSlot.set(key, counts);
  }

  const slots: DerivedRecurringSlot[] = [];
  for (const [key, counts] of perSlot) {
    const observed = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (observed < minObservations) {
      continue;
    }
    const [weekdayText, shiftId] = key.split('|');
    if (weekdayText === undefined || shiftId === undefined) {
      continue;
    }
    for (const [doctor, held] of counts) {
      if (held / observed >= ANCHOR_DOMINANCE) {
        slots.push({ doctor, weekday: Number(weekdayText), shiftId, held, observed });
        break;
      }
    }
  }

  return slots.sort(
    (left, right) => left.weekday - right.weekday || left.shiftId.localeCompare(right.shiftId),
  );
}

/** One doctor's historical share of one rotated slot, in the shape `buildSolveRequest` takes. */
export interface DerivedSlotShare {
  readonly doctor: DoctorCode;
  /** 0 = Sunday, this side's convention. Converted to a name at the wire. */
  readonly weekday: number;
  readonly shiftId: ShiftId;
  /** Fraction of the slot's occurrences this doctor held, in `(0, 1)`. */
  readonly share: number;
  readonly held: number;
  readonly observed: number;
}

/**
 * Historical shares for the slots {@link inferRecurringSlots} discards — S-09.
 *
 * ⚠️ **This deliberately excludes every slot with a dominant holder.** Those get S-05, and two
 * objective terms pulling on one slot would double-price it. The two functions partition the slots
 * between them; see `docs/domain/constraints.md#s-09`.
 *
 * Over the six months to September 2026 this covers 18 of 25 slots and 68% of all assignments —
 * the part of the roster S-05 has no opinion about, and where the principal's own Saturday morning
 * lives at a 38% share.
 */
export function inferSlotShares(
  period: RosterPeriod,
  options: InferRecurringSlotsOptions = {},
): readonly DerivedSlotShare[] {
  const minObservations = options.minObservations ?? 4;
  const inWindow = withinCurrentArrangement(
    period.assignments.filter(
      (assignment) =>
        (options.from === undefined || assignment.date >= options.from) &&
        (options.before === undefined || assignment.date < options.before),
    ),
  );

  const perSlot = new Map<string, Map<DoctorCode, number>>();
  for (const assignment of inWindow) {
    const key = slotKey(weekdayOf(assignment.date), assignment.shiftId);
    const counts = perSlot.get(key) ?? new Map<DoctorCode, number>();
    counts.set(assignment.doctor, (counts.get(assignment.doctor) ?? 0) + 1);
    perSlot.set(key, counts);
  }

  const shares: DerivedSlotShare[] = [];
  for (const [key, counts] of perSlot) {
    const observed = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (observed < minObservations) {
      continue;
    }
    if ([...counts.values()].some((held) => held / observed >= ANCHOR_DOMINANCE)) {
      continue;
    }
    const [weekdayText, shiftId] = key.split('|');
    if (weekdayText === undefined || shiftId === undefined) {
      continue;
    }
    for (const [doctor, held] of counts) {
      shares.push({
        doctor,
        weekday: Number(weekdayText),
        shiftId,
        share: held / observed,
        held,
        observed,
      });
    }
  }

  return shares.sort(
    (left, right) =>
      left.weekday - right.weekday ||
      left.shiftId.localeCompare(right.shiftId) ||
      left.doctor.localeCompare(right.doctor),
  );
}

/** The first day of the month `months` before `month`, as `YYYY-MM-01`. */
export function windowStart(month: string, months: number): IsoDate {
  const parts = month.split('-');
  const [year, monthNumber] = parts;
  if (year === undefined || monthNumber === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  const at = new Date(Date.UTC(Number(year), Number(monthNumber) - 1 - months, 1));
  return at.toISOString().slice(0, 10);
}
