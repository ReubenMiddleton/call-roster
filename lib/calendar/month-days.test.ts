import { describe, expect, it } from 'vitest';
import { holidayLookup } from './holidays.ts';
import { rosterDaysForMonth } from './month-days.ts';
import {
  PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
  PILOT_HOLIDAY_SUSPENDS_V1,
  PILOT_WEEKDAY_DEFAULTS_V1,
} from './pattern-precedence.ts';

function pilot(overrides: Record<string, unknown> = {}) {
  return {
    weekdayDefaults: PILOT_WEEKDAY_DEFAULTS_V1,
    holidaySuspends: PILOT_HOLIDAY_SUSPENDS_V1,
    suggestWhenUndetermined: PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
    holidays: holidayLookup('2026-01-01', '2027-12-31'),
    ...overrides,
  };
}

describe('rosterDaysForMonth', () => {
  it('builds a whole month with no history at all', () => {
    // The point of the module: September 2026 has no sheet, and never needs one.
    const { days, undecided } = rosterDaysForMonth('2026-09', pilot());
    expect(days).toHaveLength(30);
    expect(undecided).toEqual([]);
    expect(days[0]).toEqual({
      date: '2026-09-01',
      patternId: 'A',
      dayClass: 'weekday',
      isPublicHoliday: false,
    });
  });

  it('gives Fridays the four-shift pattern', () => {
    const { days } = rosterDaysForMonth('2026-09', pilot());
    const fridays = days.filter((day) => day.patternId === 'B').map((day) => day.date);
    expect(fridays).toEqual(['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25']);
  });

  it('classifies a holiday on a weekday as public-holiday and carries the calendar fact', () => {
    const { days } = rosterDaysForMonth('2026-06', pilot());
    const youthDay = days.find((day) => day.date === '2026-06-16');
    expect(youthDay).toEqual({
      date: '2026-06-16',
      patternId: 'A',
      dayClass: 'public-holiday',
      isPublicHoliday: true,
    });
  });

  it('keeps a holiday on a weekend classified as the weekend day, not as a holiday', () => {
    // The ordering the principal confirmed: a holiday on a Saturday "counts once as a Saturday".
    // `dayClass` is therefore lossy about the calendar, which is exactly why `isPublicHoliday` is a
    // separate field rather than something derived at the far end.
    const { days } = rosterDaysForMonth('2026-08', pilot());
    const womensDay = days.find((day) => day.date === '2026-08-09'); // a Sunday
    expect(womensDay?.dayClass).toBe('sunday');
    expect(womensDay?.isPublicHoliday).toBe(true);
  });

  it('holds an undecided date out of days rather than emitting one with no pattern', () => {
    // April 2026: Good Friday on the 3rd. A day with no pattern has no shifts, and a day with no
    // shifts vanishes from the roster silently. So it is reported, not included.
    const { days, undecided } = rosterDaysForMonth('2026-04', pilot());
    expect(days).toHaveLength(29);
    expect(days.map((day) => day.date)).not.toContain('2026-04-03');
    expect(undecided).toHaveLength(1);
    expect(undecided[0]?.date).toBe('2026-04-03');
    expect(undecided[0]?.suggestion).toBe('A');
  });

  it('emits the full month once the admin has settled the undecided date', () => {
    const { days, undecided } = rosterDaysForMonth(
      '2026-04',
      pilot({ dateOverrides: new Map([['2026-04-03', 'A']]) }),
    );
    expect(days).toHaveLength(30);
    expect(undecided).toEqual([]);
    expect(days.find((day) => day.date === '2026-04-03')?.patternId).toBe('A');
  });
});
