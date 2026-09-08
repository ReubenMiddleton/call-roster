/**
 * The seven weekday names `weekday_default_pattern` stores, in the same order
 * `lib/calendar/pattern-precedence.ts` indexes its `weekdayDefaults` array: index 0 is Sunday.
 * That module's own weekday integers are `Date.getUTCDay()`'s, not the solver's -- see its
 * docblock -- so this order is deliberate, not incidental.
 */
export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];
