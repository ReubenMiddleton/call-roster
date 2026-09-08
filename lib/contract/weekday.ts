/**
 * Weekday names for the solver contract, and the conversions to and from this side's integers.
 *
 * ## ⚠️ Why this module exists
 *
 * **A weekday integer means two different days depending on which side of the boundary you are on.**
 *
 * - TypeScript uses `Date.getUTCDay()`, so **Sunday = 0** and Monday = 1.
 * - Python uses `date.weekday()`, so **Monday = 0** and Sunday = 6.
 *
 * Both are correct in their own language and neither can reasonably change. So the same concept —
 * "the Monday exception on D07's availability rule" — is `1` here and `0` there. Sent as an integer
 * it silently becomes **Sunday** on arrival, and nothing anywhere raises an error: the roster is
 * merely wrong, on the one day of the week nobody was looking at.
 *
 * `docs/architecture/solver-contract.md` calls this boundary the highest-risk interface in the
 * system precisely because it can drift without a compile error. This is that drift, already
 * present in two live data structures — `AvailabilityRule.exceptWeekdays` and `RecurringSlot`.
 *
 * **So a weekday never crosses the wire as an integer.** It crosses as a name, and the conversion
 * happens exactly once per side, here. The contract's `recurringSlots` already did this correctly
 * with `"weekday": "TUESDAY"`; this module makes that rule explicit and reusable rather than a
 * convention one field happens to follow.
 */

/**
 * The wire representation. Order is Sunday-first to match this side's integers, so
 * `WEEKDAY_NAMES[n]` is a direct lookup — do not reorder it to look like Python's.
 */
export const WEEKDAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** Whether a string is a valid wire weekday. Use before trusting external input. */
export function isWeekdayName(value: string): value is WeekdayName {
  return (WEEKDAY_NAMES as readonly string[]).includes(value);
}

/**
 * Wire name to this side's integer, where **Sunday is 0**.
 *
 * Throws on an unknown name rather than returning a default. The contract says to reject unknown
 * fields rather than ignore them, and the same reasoning applies with more force to a value: a
 * silent fallback here puts a doctor on the wrong day.
 */
export function weekdayFromName(name: string): number {
  const index = (WEEKDAY_NAMES as readonly string[]).indexOf(name);
  if (index === -1) {
    throw new Error(`Not a weekday name: "${name}". Expected one of ${WEEKDAY_NAMES.join(', ')}.`);
  }
  return index;
}

/**
 * This side's integer to the wire name, where **Sunday is 0**.
 *
 * Throws outside 0–6. `noUncheckedIndexedAccess` would force a check on the lookup anyway; this
 * makes the failure legible instead of `undefined` leaking onto the wire.
 */
export function nameFromWeekday(weekday: number): WeekdayName {
  const name = WEEKDAY_NAMES[weekday];
  if (name === undefined) {
    throw new Error(`Weekday out of range: ${String(weekday)}. Expected 0-6, Sunday = 0.`);
  }
  return name;
}

/** Convenience for the shape availability rules actually hold. Sorted, so output is stable. */
export function namesFromWeekdays(weekdays: readonly number[]): WeekdayName[] {
  return [...new Set(weekdays)].sort((a, b) => a - b).map(nameFromWeekday);
}

/** The inverse. Sorted for the same reason. */
export function weekdaysFromNames(names: readonly string[]): number[] {
  return [...new Set(names.map(weekdayFromName))].sort((a, b) => a - b);
}
