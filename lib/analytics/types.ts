/**
 * Shared vocabulary for the analytics and fairness engine.
 *
 * Every term here is defined in `docs/product/glossary.md`. If you need a concept that is not
 * in this file, add it to the glossary first — see AGENTS.md on domain language.
 *
 * **Deliberately tenant-agnostic.** Doctor codes are opaque strings, not a `D01 | D02 | ...`
 * union, and the shift catalogue is a parameter rather than a constant. This practice has
 * thirteen doctors and three patterns; the next one will not. See ADR-0010.
 */

/**
 * A doctor's stable identifier within one tenant.
 *
 * Opaque on purpose. `D01`…`D15` is *this* practice's scheme, enforced by
 * `scripts/validate-seed-data.mjs` at the data boundary, not by the type system — a second
 * tenant will use different codes and must not require a code change.
 *
 * **Never a real name.** See the data boundary section of AGENTS.md.
 */
export type DoctorCode = string;

/** A shift slot identifier within a pattern, e.g. `std-night`, `fri-evening`. */
export type ShiftId = string;

/** A shift pattern identifier, e.g. `A`, `B`, `C`. */
export type PatternId = string;

/** An ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** An ISO year-month, `YYYY-MM`. */
export type IsoMonth = string;

/**
 * What kind of shift this is, for burden purposes.
 *
 * Derived from the shift definition, never inferred from the identifier string — a tenant
 * whose night shift is called `graveyard` must still be classified correctly.
 */
export type ShiftKind = 'morning' | 'afternoon' | 'evening' | 'night' | 'long-day';

/**
 * How the calendar treats the date the shift falls on.
 *
 * `public-holiday` outranks `saturday` and `sunday`: a public holiday falling on a Saturday is
 * classified `public-holiday`. That ordering is a burden decision, not a calendar fact, and it
 * is `[ASSUMED]` — see `docs/domain/fairness.md`.
 */
export type DayClass = 'weekday' | 'saturday' | 'sunday' | 'public-holiday';

/**
 * **Why** a doctor ended up working a shift. The single most important field in the ledger.
 *
 * `[CONFIRMED 2026-08-31]` — the project owner confirmed this vocabulary (question R). Two words
 * were deliberately rejected: *voluntary* reads as **unpaid**, which is wrong because every shift
 * here is paid, and *overtime* implies a contracted baseline that does not exist — no doctor at this
 * practice works there full time.
 *
 * The distinction exists because equalising all burden regardless of provenance produces a
 * perverse result: a doctor who *asks* for extra shifts because they want the income gets less
 * work next month as a direct consequence. That is not fairness. See
 * `docs/domain/fairness.md#provenance`.
 */
export type Provenance =
  /** The scheduler assigned it. The default, and the only kind the objective equalises. */
  | 'directed'
  /** The doctor asked for it — extra income, a favour, a swap they initiated. */
  | 'requested'
  /** Nobody else was available. Recorded in full **and** flagged as a capacity event. */
  | 'absorbed'
  /**
   * Provenance was never captured. **Every historical assignment is this.** Treated as
   * `directed` for arithmetic, but counted separately so a report can never quietly present
   * fifteen months of unknowns as though they were known.
   */
  | 'unknown';

/** The definition of one shift slot. Data, not code — see `shifts.ts`. */
export interface ShiftDefinition {
  readonly id: ShiftId;
  readonly patternId: PatternId;
  /** Hour of day the shift starts, 0–23. */
  readonly startHour: number;
  /** Duration in hours. Shifts may cross midnight; `startHour + hours` may exceed 24. */
  readonly hours: number;
  readonly kind: ShiftKind;
}

/** A shift pattern: the ordered set of slots that covers one day. */
export interface ShiftPattern {
  readonly id: PatternId;
  readonly shifts: readonly ShiftDefinition[];
}

/** One doctor working one slot on one date. */
export interface Assignment {
  readonly date: IsoDate;
  readonly shiftId: ShiftId;
  readonly doctor: DoctorCode;
  readonly provenance: Provenance;
}

/** A date with its pattern and calendar classification. */
export interface RosterDay {
  readonly date: IsoDate;
  readonly patternId: PatternId;
  readonly dayClass: DayClass;
  /**
   * Whether the date is a public holiday — the **calendar fact**, kept separate from `dayClass`.
   *
   * ⚠️ It cannot be recovered from `dayClass`, and that is not an oversight in `classifyDay`:
   * Saturday and Sunday deliberately outrank `public-holiday` there, because the principal said a
   * holiday on a Saturday *"counts once as a Saturday, not a Saturday and a holiday."* Correct for
   * burden — and it means `dayClass` is **lossy about the calendar**. A holiday falling on a
   * Saturday classifies as `saturday` and the holiday disappears.
   *
   * Two different facts, so two fields. `dayClass` answers "how is this weighted"; this answers
   * "was the country on holiday". The solver contract needs the second — H-10 exempts holidays
   * because pool doctors' own practices are closed, and that is true of a Saturday holiday too.
   *
   * Optional because most callers only need `dayClass`. Absent means "not known to be a holiday",
   * never "known not to be" — anything asserting the negative should say so itself.
   */
  readonly isPublicHoliday?: boolean;
  /** Set when the date is a named special date, e.g. `christmas-night`. */
  readonly specialDate?: string;
}

/**
 * A period of roster history, flattened.
 *
 * Not a month: the ledger accumulates across months and a report may cover a year. Callers
 * assemble this from published roster versions (or, today, from the transcribed seed data).
 */
export interface RosterPeriod {
  readonly label: string;
  readonly days: readonly RosterDay[];
  readonly assignments: readonly Assignment[];
}
