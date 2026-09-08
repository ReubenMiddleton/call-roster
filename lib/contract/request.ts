/**
 * Builds a solve request from this side's domain types.
 *
 * The other half of `solver/src/call_roster_solver/contract.py`. Between them the boundary is closed:
 * history goes in one end as `RosterPeriod` and comes out the other as a solved roster, with no
 * hand-written JSON in between.
 *
 * ## What this is not
 *
 * **Not a validator.** The Python parser is the authority on what a valid request is, and duplicating
 * its rules here would give two disagreeing answers. This builder's job is to make it *impossible to
 * express* the things the parser rejects — weekdays as integers, a missing `kind`, an overnight shift
 * that does not say so — by taking typed input and doing the conversion in one place.
 *
 * **Not a schema.** When the first API route exists, a Zod schema becomes the machine source of truth
 * and this builder should be derived from it. Until then `npm run contract:check` compares this
 * output's shape against the contract document and the shared fixture.
 *
 * ## What is deliberately absent
 *
 * **Provenance.** `directed` / `requested` / `absorbed` / `unknown` is recorded when an assignment
 * is *made*, and is an input to fairness reporting, not to the solve. Sending it would invite the
 * model to reason about why a past shift happened, which is the ledger's job.
 *
 * **`fte`.** Removed from the contract in 1.1.0 — no doctor works full time at this practice, so
 * there is no baseline to take a fraction of. See ADR-0012 on why burden ÷ FTE is the trap.
 *
 * @see docs/architecture/solver-contract.md
 * @see fixtures/README.md
 */

import type {
  DoctorCode,
  IsoDate,
  PatternId,
  RosterDay,
  ShiftDefinition,
  ShiftId,
  ShiftPattern,
} from '../analytics/types.ts';
import type { DoctorAvailability } from '../analytics/availability.ts';
import { resolveBurden } from '../analytics/burden.ts';
import type { BurdenSchedule } from '../analytics/burden-types.ts';
import {
  type DeclaredHoliday,
  holidayLookup,
  type PublicHoliday,
  SOURCED_DECLARATIONS,
} from '../calendar/holidays.ts';
import { namesFromWeekdays, nameFromWeekday, type WeekdayName } from './weekday.ts';

/** The contract version this builder emits. Bump alongside the document and the fixture. */
export const CONTRACT_VERSION = '1.7.0';

// ── The wire shapes ────────────────────────────────────────────────────────────────────

export interface WireShift {
  readonly shiftId: ShiftId;
  readonly kind: string;
  /** `HH:00`. The solver models integer hours and rejects a non-zero minute. */
  readonly start: string;
  readonly end: string;
  readonly endsNextDay?: boolean;
  /**
   * The agreed cost of working this slot, resolved from the tenant's own burden schedule.
   *
   * Added in **1.3.0**, and it exists to delete a second implementation rather than align it. The
   * solver previously derived a weight from the flat five-key `burdenWeights` map, which cannot
   * express Christmas night at 8.0 or a Pattern C long day at 1.5 — so it optimised one weighting
   * while the analytics reported another, and **neither side could tell**. Resolved here by
   * `resolveBurden` against the authoritative schedule, so there is nothing left to diverge.
   */
  readonly burdenWeight: number;
}

export interface WireDay {
  readonly date: IsoDate;
  readonly patternId: PatternId;
  readonly isPublicHoliday: boolean;
  readonly shifts: readonly WireShift[];
}

export interface WireDoctor {
  readonly code: DoctorCode;
  readonly availableFrom: IsoDate;
  readonly availableUntil: IsoDate | null;
  readonly staffCategory: string;
  /** H-12, 1.5.0. Their agreed monthly ceiling. Absent means none, which is the common case. */
  readonly maxShiftsPerMonth?: number;
  /** H-11, 1.6.0. Day-class/shift-kind cells this doctor does not work. */
  readonly cannotWork?: readonly { readonly dayClass: string; readonly shiftKind: string }[];
  /** H-11, 1.6.0. At most this many shifts inside one weekend. */
  readonly maxShiftsPerWeekend?: number;
}

export interface WireAvailabilityRule {
  readonly kind: 'NO_WEEKDAY_BEFORE';
  readonly hour: number;
  readonly exceptWeekdays?: readonly WeekdayName[];
}

export interface WireAvailability {
  readonly doctorCode: DoctorCode;
  readonly rules: readonly WireAvailabilityRule[];
  readonly derivedFrom?: { readonly shiftsObserved: number; readonly contradictions: number };
}

export type WirePreferenceType = 'UNAVAILABLE' | 'PREFER_NOT' | 'PREFER' | 'MUST';

export interface WirePreference {
  readonly doctorCode: DoctorCode;
  readonly type: WirePreferenceType;
  readonly tentative: boolean;
  readonly dates: readonly IsoDate[];
  readonly shiftIds: readonly ShiftId[] | null;
  readonly sourceToken: string | null;
}

export interface WireRecurringSlot {
  readonly doctorCode: DoctorCode;
  readonly weekday: WeekdayName;
  readonly shiftId: ShiftId;
  readonly validFrom: IsoDate | null;
  readonly validUntil: IsoDate | null;
}

/**
 * S-09, 1.7.0. One doctor's historical share of a slot **with no dominant holder**.
 *
 * ⚠️ Never sent for a slot that also appears in `recurringSlots` — S-05 and S-09 partition the
 * slots, and pricing one slot twice is not what the weights are calibrated for.
 */
export interface WireSlotShare {
  readonly doctorCode: DoctorCode;
  readonly weekday: WeekdayName;
  readonly shiftId: ShiftId;
  /** In `(0, 1)`. The solver turns it into a `[floor, ceil]` interval over the month's occurrences. */
  readonly share: number;
}

export type WireConstraintMode = 'BLOCK' | 'WARN' | 'OFF';

export interface WireConstraint {
  readonly id: string;
  readonly mode: WireConstraintMode;
  readonly weight: number;
}

export interface WireAssignmentRef {
  readonly date: IsoDate;
  readonly shiftId: ShiftId;
  readonly doctorCode: DoctorCode;
}

export interface SolveRequest {
  readonly contractVersion: string;
  readonly solveRunId: string;
  readonly tenantId: string;
  readonly rosterId: string;
  readonly horizon: { readonly start: IsoDate; readonly end: IsoDate };
  readonly timeBudgetSeconds: number;
  readonly doctors: readonly WireDoctor[];
  readonly days: readonly WireDay[];
  readonly availability: readonly WireAvailability[];
  readonly preferences: readonly WirePreference[];
  readonly recurringSlots: readonly WireRecurringSlot[];
  readonly slotShares: readonly WireSlotShare[];
  readonly burdenLedger: readonly {
    readonly doctorCode: DoctorCode;
    readonly cumulativeBurden: number;
    readonly entitlement: number;
    /** S-08, over a twelve-month span. Omitted together when there is no holiday history. */
    readonly holidayBurden?: number;
    readonly holidayEntitlement?: number;
  }[];
  readonly burdenWeights: Readonly<Record<string, number>>;
  readonly constraints: readonly WireConstraint[];
  readonly lockedAssignments: readonly WireAssignmentRef[];
  readonly previousPublished: readonly WireAssignmentRef[];
  /**
   * H-12, 1.5.0. The floor every doctor should reach this month. Absent means none.
   *
   * ⚠️ **Not optional in spirit.** Without it S-01 starves whoever is over their cumulative
   * fair share and nothing stops it reaching zero — the September 2026 solve gave two of
   * thirteen doctors no shifts at all while another got nineteen, and reported OPTIMAL.
   */
  readonly monthlyMinimumShifts?: number;
}

// ── Input ──────────────────────────────────────────────────────────────────────────────

/**
 * What a doctor brings into this month, for S-01.
 *
 * **Both halves are required, and sending only the first is the bug this type exists to prevent.**
 * A cumulative burden divided by a *single month's* opportunity share is dimensionally wrong: a
 * doctor who joined last month carries almost nothing and would look enormously under-loaded, so the
 * solver hands them the month. That is exactly what happened on 2 September 2026 before `entitlement`
 * was added — see `docs/DECISIONS.md`.
 *
 * `entitlement` is the burden of everything they **could** have worked over the same span the
 * cumulative figure covers — their opportunity set, per
 * [ADR-0012](../../docs/architecture/decisions/0012-fairness-normalised-by-opportunity.md). Never
 * headcount and never FTE: a weekends-only doctor works nothing but expensive shifts, so a per-head
 * divisor reports them as overloaded and the objective takes away the only work they can do.
 */
export interface LedgerCarryIn {
  /** Burden carried before this month. Use `equalisableBurden` — `requested` is excluded. */
  readonly cumulativeBurden: number;
  /** Burden of their opportunity set over the same span. The denominator, not a headcount. */
  readonly entitlement: number;
  /**
   * S-08. Public-holiday burden carried over the **twelve** months before this one.
   *
   * ⚠️ **A different span from `cumulativeBurden`, deliberately.** S-01 runs over three months on
   * the principal's instruction; S-08 runs over twelve because he asked for holidays to be shared
   * *"throughout the year"* and there are only about forty-four holiday slots in one. Three months
   * of holiday history is roughly eleven slots across thirteen doctors, which is not enough to be
   * fair with. See `HOLIDAY_LEDGER_WINDOW_MONTHS`.
   *
   * Optional: absent means a first solve with no holiday history, and S-08 sits out.
   */
  readonly holidayBurden?: number;
  /** S-08's denominator: the burden of the holiday slots they could have worked, same span. */
  readonly holidayEntitlement?: number;
}

/** A doctor's membership interval. Temporal, never a soft delete — see ADR-0008. */
export interface DoctorMembership {
  readonly code: DoctorCode;
  readonly availableFrom: IsoDate;
  readonly availableUntil?: IsoDate;
  readonly staffCategory?: string;
  /** H-12. Their agreed monthly ceiling, if the practice has set one. */
  readonly maxShiftsPerMonth?: number;
  /** H-11. Cells this doctor does not work — `saturday`/`morning`, and so on. */
  readonly cannotWork?: readonly { readonly dayClass: string; readonly shiftKind: string }[];
  /** H-11. At most this many shifts inside one weekend. */
  readonly maxShiftsPerWeekend?: number;
}

export interface RecurringSlotInput {
  readonly doctor: DoctorCode;
  /** 0 = Sunday, this side's convention. Converted to a name on the way out. */
  readonly weekday: number;
  readonly shiftId: ShiftId;
  readonly validFrom?: IsoDate;
  readonly validUntil?: IsoDate;
}

/** S-09. `inferSlotShares` returns exactly this shape. */
export interface SlotShareInput {
  readonly doctor: DoctorCode;
  /** 0 = Sunday, this side's convention. Converted to a name on the way out. */
  readonly weekday: number;
  readonly shiftId: ShiftId;
  readonly share: number;
}

export interface PreferenceInput {
  readonly doctor: DoctorCode;
  readonly type: WirePreferenceType;
  readonly dates: readonly IsoDate[];
  readonly shiftIds?: readonly ShiftId[];
  readonly tentative?: boolean;
  readonly sourceToken?: string;
}

export interface BuildRequestInput {
  readonly solveRunId: string;
  readonly tenantId: string;
  readonly rosterId: string;
  readonly horizon: { readonly start: IsoDate; readonly end: IsoDate };
  readonly timeBudgetSeconds?: number;
  readonly doctors: readonly DoctorMembership[];
  readonly days: readonly RosterDay[];
  readonly patterns: readonly ShiftPattern[];
  /** Keyed by doctor code. `inferAvailability` returns exactly this shape. */
  readonly availability?: ReadonlyMap<DoctorCode, DoctorAvailability>;
  readonly preferences?: readonly PreferenceInput[];
  readonly recurringSlots?: readonly RecurringSlotInput[];
  readonly slotShares?: readonly SlotShareInput[];
  readonly burdenLedger?: ReadonlyMap<DoctorCode, LedgerCarryIn>;
  readonly burdenWeights: Readonly<Record<string, number>>;
  /**
   * The authoritative burden schedule. Every slot's weight is resolved from it on the way out.
   *
   * Required rather than defaulted: a solver optimising a fairness objective nobody chose is worse
   * than one with no opinion, and a default here would make that silent.
   */
  readonly burdenSchedule: BurdenSchedule;
  /** H-12. The monthly floor every doctor should reach. */
  readonly monthlyMinimumShifts?: number;
  /**
   * One-off proclaimed holidays the statutory calendar cannot derive, e.g. a declared election day.
   *
   * Merged into the calendar used to answer `isPublicHoliday` for any day that does not state it.
   * Defaults to `SOURCED_DECLARATIONS` — the ones already transcribed with a source — rather than
   * to nothing, so a caller who forgets is right about history instead of quietly wrong.
   */
  readonly declaredHolidays?: readonly DeclaredHoliday[];
  readonly constraints: readonly WireConstraint[];
  readonly lockedAssignments?: readonly WireAssignmentRef[];
  readonly previousPublished?: readonly WireAssignmentRef[];
}

/** Raised rather than emitting a request the parser would reject. */
export class RequestBuildError extends Error {}

/**
 * Typed empty defaults.
 *
 * `?? new Map()` infers `Map<any, any>`, and the `any` then propagates through every destructure
 * downstream — nine `no-unsafe-*` errors from one omitted type argument. Named constants rather than
 * inline annotations so the shape is stated once.
 */
const NO_AVAILABILITY: ReadonlyMap<DoctorCode, DoctorAvailability> = new Map();
const NO_LEDGER: ReadonlyMap<DoctorCode, LedgerCarryIn> = new Map();

// ── Conversion ─────────────────────────────────────────────────────────────────────────

const DEFAULT_TIME_BUDGET_SECONDS = 30;
const DEFAULT_STAFF_CATEGORY = 'independent_practitioner';

/** `7` → `"07:00"`. Hours past midnight wrap, which is why `endsNextDay` exists. */
function asTime(hour: number): string {
  const wrapped = ((hour % 24) + 24) % 24;
  return `${String(wrapped).padStart(2, '0')}:00`;
}

/**
 * One shift, converted.
 *
 * `endsNextDay` is **derived from the arithmetic**, not from the shift's kind. A shift starting at 23
 * and running 8 hours ends at 31, i.e. 07:00 the following day. Deriving it from `kind === 'night'`
 * would be the same mistake as inferring `kind` from `endsNextDay` — a coincidence of this practice's
 * hours rather than a definition.
 */
function toWireShift(shift: ShiftDefinition, day: RosterDay, schedule: BurdenSchedule): WireShift {
  const endHour = shift.startHour + shift.hours;
  const endsNextDay = endHour >= 24;
  return {
    shiftId: shift.id,
    kind: shift.kind,
    start: asTime(shift.startHour),
    end: asTime(endHour),
    ...(endsNextDay ? { endsNextDay: true } : {}),
    burdenWeight: resolveBurden(day, shift, schedule).weight,
  };
}

function toWireDay(
  day: RosterDay,
  byPattern: ReadonlyMap<PatternId, ShiftPattern>,
  schedule: BurdenSchedule,
  calendar: ReadonlyMap<IsoDate, PublicHoliday>,
): WireDay {
  const pattern = byPattern.get(day.patternId);
  if (pattern === undefined) {
    throw new RequestBuildError(
      `${day.date} names pattern "${day.patternId}", which is not in the supplied patterns ` +
        `(${[...byPattern.keys()].join(', ')}). A day whose shifts cannot be resolved must not be ` +
        'sent — the solver would fall back to its own table, which is a single-tenant leak.',
    );
  }
  if (pattern.shifts.length === 0) {
    throw new RequestBuildError(
      `pattern "${day.patternId}" has no shifts. A day with no shifts is not a day off, it is a ` +
        'day with no cover.',
    );
  }
  return {
    date: day.date,
    patternId: day.patternId,
    // ⚠️ The explicit fact first, then the CALENDAR — never `dayClass`.
    //
    // `dayClass === 'public-holiday'` was the old fallback and it is wrong in exactly the case
    // that costs the most: `classifyDay` lets Saturday and Sunday outrank public-holiday, so for a
    // holiday falling on a weekend the fact is not in `dayClass` at all. Christmas on a Sunday
    // would have crossed the wire as an ordinary Sunday, and the burden schedule prices a public
    // holiday well above one.
    //
    // `lib/calendar/holidays.ts` knows the Act 36 of 1994 rules including the s2(1) Sunday→Monday
    // shift, so an absent `isPublicHoliday` is now answered rather than guessed at. A caller that
    // sets the field explicitly still wins: a proclaimed one-off the calendar has not been told
    // about must be able to override, which is what `declaredHolidays` on the input is for.
    isPublicHoliday: day.isPublicHoliday ?? calendar.has(day.date),
    shifts: pattern.shifts.map((shift) => toWireShift(shift, day, schedule)),
  };
}

/**
 * Availability, converted — the reason this module exists.
 *
 * `DoctorAvailability.rules` is a list and the solver accepts exactly one, so a doctor carrying two
 * is refused here rather than silently truncated. The parser refuses it too; failing on this side
 * gives a message that names the doctor.
 */
function toWireAvailability(availability: DoctorAvailability): WireAvailability | undefined {
  if (availability.rules.length === 0) {
    // No restriction. Omitted rather than sent as an empty rule list: absent means unrestricted,
    // and an empty list would read as "restricted, in no way", which is a different claim.
    return undefined;
  }
  if (availability.rules.length > 1) {
    throw new RequestBuildError(
      `${availability.doctor} carries ${String(availability.rules.length)} availability rules and ` +
        'the solver models one. A second rule kind needs a contract change, not a dropped rule.',
    );
  }
  const rule = availability.rules[0];
  if (rule === undefined) {
    throw new RequestBuildError(`${availability.doctor}: availability rule list is malformed.`);
  }
  return {
    doctorCode: availability.doctor,
    rules: [
      {
        kind: 'NO_WEEKDAY_BEFORE',
        hour: rule.hour,
        // ⚠️ The single most important line here. Integers mean different days on the two sides.
        ...(rule.exceptWeekdays === undefined || rule.exceptWeekdays.length === 0
          ? {}
          : { exceptWeekdays: namesFromWeekdays(rule.exceptWeekdays) }),
      },
    ],
    derivedFrom: {
      shiftsObserved: availability.evidence.shiftsObserved,
      contradictions: availability.evidence.contradictions,
    },
  };
}

/**
 * Builds a solve request, or throws.
 *
 * Every field the contract documents is emitted, including the four the model does not yet consume —
 * `burdenLedger`, `burdenWeights`, `lockedAssignments`, `previousPublished`. Omitting them would let
 * their shapes rot until the day something needs them.
 */
export function buildSolveRequest(input: BuildRequestInput): SolveRequest {
  const byPattern = new Map(input.patterns.map((pattern) => [pattern.id, pattern]));

  if (input.doctors.length === 0) {
    throw new RequestBuildError('no doctors. Nothing can be rostered.');
  }
  if (input.days.length === 0) {
    throw new RequestBuildError('no days. There is nothing to solve.');
  }

  const codes = new Set<DoctorCode>();
  for (const doctor of input.doctors) {
    if (codes.has(doctor.code)) {
      throw new RequestBuildError(`duplicate doctor code "${doctor.code}"`);
    }
    codes.add(doctor.code);
  }

  const seen = new Set<IsoDate>();
  for (const day of input.days) {
    if (seen.has(day.date)) {
      throw new RequestBuildError(`duplicate date ${day.date}`);
    }
    seen.add(day.date);
    if (day.date < input.horizon.start || day.date > input.horizon.end) {
      throw new RequestBuildError(
        `${day.date} is outside the horizon ${input.horizon.start}..${input.horizon.end}. ` +
          'Solving it would publish a roster covering dates nobody asked about.',
      );
    }
  }

  // Built once over the horizon rather than per day: `holidaysInRange` runs the computus for
  // every year it spans, and doing that thirty-one times a month is pure waste.
  const calendar = holidayLookup(
    input.horizon.start,
    input.horizon.end,
    input.declaredHolidays ?? SOURCED_DECLARATIONS,
  );

  // Availability for a doctor who cannot be rostered is either a stale record or the wrong
  // request. The parser refuses it; catching it here names the doctor.
  const availability: WireAvailability[] = [];
  for (const [code, entry] of input.availability ?? NO_AVAILABILITY) {
    if (!codes.has(code)) {
      throw new RequestBuildError(
        `availability for "${code}", who is not among this request's doctors.`,
      );
    }
    const wire = toWireAvailability(entry);
    if (wire !== undefined) {
      availability.push(wire);
    }
  }

  for (const preference of input.preferences ?? []) {
    if (!codes.has(preference.doctor)) {
      throw new RequestBuildError(
        `preference for "${preference.doctor}", who is not a doctor here.`,
      );
    }
    if (preference.dates.length === 0) {
      throw new RequestBuildError(
        `${preference.doctor}: a preference with no dates has no meaning.`,
      );
    }
  }

  for (const slot of input.recurringSlots ?? []) {
    if (!codes.has(slot.doctor)) {
      throw new RequestBuildError(`recurring slot for "${slot.doctor}", who is not a doctor here.`);
    }
  }

  // S-09. The partition with S-05 is enforced here rather than trusted: `inferSlotShares` already
  // excludes anchored slots, but the builder also takes hand-assembled input, and a slot carrying
  // both terms is priced twice with weights calibrated for one.
  const anchored = new Set(
    (input.recurringSlots ?? []).map((slot) => `${String(slot.weekday)}|${slot.shiftId}`),
  );
  for (const share of input.slotShares ?? []) {
    if (!codes.has(share.doctor)) {
      throw new RequestBuildError(`slot share for "${share.doctor}", who is not a doctor here.`);
    }
    if (share.share <= 0 || share.share > 1) {
      throw new RequestBuildError(
        `${share.doctor}: a slot share must be in (0, 1], not ${String(share.share)}.`,
      );
    }
    if (anchored.has(`${String(share.weekday)}|${share.shiftId}`)) {
      throw new RequestBuildError(
        `${share.doctor}: "${share.shiftId}" already has a recurring slot on that weekday. ` +
          'S-05 and S-09 partition the slots; sending both prices it twice.',
      );
    }
  }

  return {
    contractVersion: CONTRACT_VERSION,
    solveRunId: input.solveRunId,
    tenantId: input.tenantId,
    rosterId: input.rosterId,
    horizon: input.horizon,
    timeBudgetSeconds: input.timeBudgetSeconds ?? DEFAULT_TIME_BUDGET_SECONDS,
    doctors: input.doctors.map((doctor) => ({
      code: doctor.code,
      availableFrom: doctor.availableFrom,
      availableUntil: doctor.availableUntil ?? null,
      staffCategory: doctor.staffCategory ?? DEFAULT_STAFF_CATEGORY,
      ...(doctor.maxShiftsPerMonth === undefined
        ? {}
        : { maxShiftsPerMonth: doctor.maxShiftsPerMonth }),
      ...(doctor.cannotWork === undefined ? {} : { cannotWork: doctor.cannotWork }),
      ...(doctor.maxShiftsPerWeekend === undefined
        ? {}
        : { maxShiftsPerWeekend: doctor.maxShiftsPerWeekend }),
    })),
    days: input.days.map((day) => toWireDay(day, byPattern, input.burdenSchedule, calendar)),
    availability,
    preferences: (input.preferences ?? []).map((preference) => ({
      doctorCode: preference.doctor,
      type: preference.type,
      tentative: preference.tentative ?? false,
      dates: [...preference.dates].sort(),
      shiftIds: preference.shiftIds === undefined ? null : [...preference.shiftIds],
      sourceToken: preference.sourceToken ?? null,
    })),
    recurringSlots: (input.recurringSlots ?? []).map((slot) => ({
      doctorCode: slot.doctor,
      // ⚠️ Never the integer.
      weekday: nameFromWeekday(slot.weekday),
      shiftId: slot.shiftId,
      validFrom: slot.validFrom ?? null,
      validUntil: slot.validUntil ?? null,
    })),
    slotShares: (input.slotShares ?? []).map((share) => ({
      doctorCode: share.doctor,
      // ⚠️ Never the integer.
      weekday: nameFromWeekday(share.weekday),
      shiftId: share.shiftId,
      share: share.share,
    })),
    burdenLedger: [...(input.burdenLedger ?? NO_LEDGER)]
      .filter(([code]) => codes.has(code))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, carry]) => ({
        doctorCode: code,
        cumulativeBurden: carry.cumulativeBurden,
        entitlement: carry.entitlement,
        // Emitted as a pair or not at all. One half alone is the dimensional error that broke
        // S-01 on 2 September — a cumulative burden over a denominator that does not match it.
        ...(carry.holidayBurden === undefined || carry.holidayEntitlement === undefined
          ? {}
          : {
              holidayBurden: carry.holidayBurden,
              holidayEntitlement: carry.holidayEntitlement,
            }),
      })),
    burdenWeights: input.burdenWeights,
    constraints: input.constraints,
    lockedAssignments: input.lockedAssignments ?? [],
    previousPublished: input.previousPublished ?? [],
    ...(input.monthlyMinimumShifts === undefined
      ? {}
      : { monthlyMinimumShifts: input.monthlyMinimumShifts }),
  };
}
