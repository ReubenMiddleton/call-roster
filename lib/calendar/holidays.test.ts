import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  familyDay,
  goodFriday,
  holidayLookup,
  holidaysInRange,
  type PublicHoliday,
  SOURCED_DECLARATIONS,
  statutoryHolidays,
  suppressedObservances,
} from './holidays.ts';

/** Dates only, for the assertions that care about the set rather than the naming. */
function dates(holidays: readonly PublicHoliday[]): readonly string[] {
  return holidays.map((holiday) => holiday.date);
}

describe('the Easter computus', () => {
  // Every expected date here comes from the practice's own transcribed sheets, not from an almanac.
  // That is the point of computing rather than tabulating: the algorithm has to reproduce dates
  // nobody typed into it.
  it('reproduces the Good Fridays observed in the transcribed history', () => {
    expect(goodFriday(2024)).toBe('2024-03-29');
    expect(goodFriday(2025)).toBe('2025-04-18');
    expect(goodFriday(2026)).toBe('2026-04-03');
  });

  it('reproduces the Family Days observed in the transcribed history', () => {
    expect(familyDay(2024)).toBe('2024-04-01');
    expect(familyDay(2025)).toBe('2025-04-21');
    expect(familyDay(2026)).toBe('2026-04-06');
  });

  it('always lands Easter on a Sunday, Good Friday on a Friday and Family Day on a Monday', () => {
    // The property, checked over a century. A computus bug that shifts a year by a day would still
    // produce a plausible-looking date, and the three fixed weekdays are what catches it.
    for (let year = 1980; year <= 2080; year += 1) {
      expect(new Date(`${easterSunday(year)}T00:00:00Z`).getUTCDay()).toBe(0);
      expect(new Date(`${goodFriday(year)}T00:00:00Z`).getUTCDay()).toBe(5);
      expect(new Date(`${familyDay(year)}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it('keeps Easter inside its only possible window, 22 March to 25 April', () => {
    for (let year = 1980; year <= 2080; year += 1) {
      const date = easterSunday(year);
      expect(date >= `${String(year)}-03-22`).toBe(true);
      expect(date <= `${String(year)}-04-25`).toBe(true);
    }
  });
});

describe('the statutory calendar', () => {
  it('is the twelve of Schedule 1, ten fixed and the two computed from Easter', () => {
    const statutory = statutoryHolidays(2027).filter((holiday) => holiday.origin === 'statutory');
    expect(dates(statutory)).toEqual([
      '2027-01-01',
      '2027-03-21',
      '2027-03-26', // Good Friday
      '2027-03-29', // Family Day
      '2027-04-27',
      '2027-05-01',
      '2027-06-16',
      '2027-08-09',
      '2027-09-24',
      '2027-12-16',
      '2027-12-25',
      '2027-12-26',
    ]);
  });

  it('carries twelve statutory dates in every year, coincidences aside', () => {
    // A year cannot have fewer unless two holidays collide. 2008 is the only such year in the
    // window, and it is covered by its own test below.
    for (let year = 1995; year <= 2080; year += 1) {
      const statutory = statutoryHolidays(year).filter((h) => h.origin === 'statutory');
      expect(statutory.length).toBe(year === 2008 ? 11 : 12);
    }
  });

  it('merges two holidays landing on one date rather than emitting the day twice', () => {
    // 21 March 2008 was both Human Rights Day and Good Friday — the only coincidence between 1995
    // and 2080. One date, one cell in the export, one day worked. The Act substitutes only for a
    // Sunday, so nothing extra is granted and nothing extra is invented.
    const holidays = statutoryHolidays(2008);
    expect(holidays.filter((holiday) => holiday.date === '2008-03-21')).toEqual([
      { date: '2008-03-21', name: 'Human Rights Day / Good Friday', origin: 'statutory' },
    ]);
  });

  it('comes back sorted, because the export prints it in date order', () => {
    const holidays = dates(statutoryHolidays(2025));
    expect([...holidays].sort()).toEqual(holidays);
  });
});

describe('the s2(1) Sunday rule', () => {
  it('keeps the Sunday AND adds the Monday — Youth Day 2024', () => {
    // Both dates are flagged in the transcribed June 2024 sheet, and that month's notes state the
    // reasoning. The Act adds the Monday; it never stops the Sunday being a public holiday.
    const holidays = statutoryHolidays(2024);
    expect(holidays).toContainEqual({
      date: '2024-06-16',
      name: 'Youth Day',
      origin: 'statutory',
    });
    expect(holidays).toContainEqual({
      date: '2024-06-17',
      name: 'Youth Day (observed)',
      origin: 'observed',
      observedFor: '2024-06-16',
    });
  });

  it('reproduces Freedom Day 2025 and Women’s Day 2026, the two the source sheets show moving', () => {
    expect(statutoryHolidays(2025)).toContainEqual({
      date: '2025-04-28',
      name: 'Freedom Day (observed)',
      origin: 'observed',
      observedFor: '2025-04-27',
    });
    expect(statutoryHolidays(2026)).toContainEqual({
      date: '2026-08-10',
      name: "National Women's Day (observed)",
      origin: 'observed',
      observedFor: '2026-08-09',
    });
  });

  it('never observes a holiday on a date that is not a Monday', () => {
    for (let year = 1995; year <= 2080; year += 1) {
      for (const holiday of statutoryHolidays(year)) {
        if (holiday.origin === 'observed') {
          expect(new Date(`${holiday.date}T00:00:00Z`).getUTCDay()).toBe(1);
        }
      }
    }
  });

  it('never emits two holidays on one date', () => {
    for (let year = 1995; year <= 2080; year += 1) {
      const seen = dates(statutoryHolidays(year));
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});

describe('a suppressed observance', () => {
  // The finding this module exists to make visible: the "unpredictable" 27 December declarations
  // are all Christmas-on-a-Sunday years. See the module docblock.
  it('is what happens when Christmas falls on a Sunday', () => {
    const suppressed = suppressedObservances(2022);
    expect(suppressed).toEqual([
      {
        date: '2022-12-25',
        name: 'Christmas Day',
        wouldObserveOn: '2022-12-26',
        blockedBy: 'Day of Goodwill',
      },
    ]);
  });

  it('drops the observance rather than cascading it to the Tuesday', () => {
    // The Act creates no cascade. Inventing 27 December here would be inventing a day off.
    const holidays = statutoryHolidays(2022);
    expect(dates(holidays)).not.toContain('2022-12-27');
    expect(holidays.filter((holiday) => holiday.date === '2022-12-26')).toEqual([
      { date: '2022-12-26', name: 'Day of Goodwill', origin: 'statutory' },
    ]);
  });

  it('accounts for every 27 December declaration the documentation records', () => {
    // 2011, 2016 and 2022 are the three years docs/domain/holidays.md lists. All three collide.
    for (const year of [2011, 2016, 2022]) {
      expect(suppressedObservances(year)).toHaveLength(1);
    }
  });

  it('predicts the next occurrences, so an admin can be warned in advance', () => {
    const upcoming: number[] = [];
    for (let year = 2027; year <= 2045; year += 1) {
      if (suppressedObservances(year).length > 0) {
        upcoming.push(year);
      }
    }
    expect(upcoming).toEqual([2033, 2039, 2044]);
  });

  it('is only ever Christmas — the statutory rules produce no other collision', () => {
    // The claim the module docblock makes, checked rather than asserted. If a future amendment to
    // Schedule 1 introduces a second adjacent pair, this fails and the docblock needs rewriting.
    for (let year = 1995; year <= 2080; year += 1) {
      for (const collision of suppressedObservances(year)) {
        expect(collision.name).toBe('Christmas Day');
        expect(collision.blockedBy).toBe('Day of Goodwill');
      }
    }
  });

  it('finds none in a year where no observance collides', () => {
    // 2027 has two Sunday holidays and both observe cleanly, so there is nothing to report.
    expect(suppressedObservances(2027)).toEqual([]);
    expect(statutoryHolidays(2027).filter((holiday) => holiday.origin === 'observed')).toHaveLength(
      2,
    );
  });
});

describe('declared holidays', () => {
  it('are added as data, not derived', () => {
    const holidays = holidaysInRange('2024-05-01', '2024-05-31', SOURCED_DECLARATIONS);
    expect(holidays).toContainEqual({
      date: '2024-05-29',
      name: 'General election day',
      origin: 'declared',
    });
  });

  it('fill the gap a suppressed observance leaves', () => {
    const holidays = dates(holidaysInRange('2022-12-24', '2022-12-31', SOURCED_DECLARATIONS));
    expect(holidays).toEqual(['2022-12-25', '2022-12-26', '2022-12-27']);
  });

  it('are a no-op on a date that is already statutory', () => {
    const holidays = holidaysInRange('2025-12-25', '2025-12-25', [
      { date: '2025-12-25', name: 'Christmas, declared again by an over-eager admin' },
    ]);
    expect(holidays).toEqual([{ date: '2025-12-25', name: 'Christmas Day', origin: 'statutory' }]);
  });

  it('every sourced declaration names where it came from', () => {
    // The rule the constant exists to enforce: no date invented from memory. A declaration that
    // cannot be checked against something in the repository would silently reprice a real shift.
    for (const entry of SOURCED_DECLARATIONS) {
      expect(entry.source).toBeTruthy();
    }
  });
});

describe('holidaysInRange', () => {
  it('spans a year boundary, which is where the roster’s spill days live', () => {
    const holidays = dates(holidaysInRange('2025-12-15', '2026-01-02'));
    expect(holidays).toEqual(['2025-12-16', '2025-12-25', '2025-12-26', '2026-01-01']);
  });

  it('is inclusive of both endpoints', () => {
    expect(dates(holidaysInRange('2025-12-25', '2025-12-26'))).toEqual([
      '2025-12-25',
      '2025-12-26',
    ]);
  });

  it('returns nothing for a range with no holiday in it', () => {
    expect(holidaysInRange('2025-02-01', '2025-02-28')).toEqual([]);
  });

  it('refuses an inverted range rather than silently returning nothing', () => {
    expect(() => holidaysInRange('2025-12-26', '2025-12-25')).toThrow(/ends before it starts/);
  });

  it('refuses a malformed date rather than computing a plausible wrong year', () => {
    expect(() => holidaysInRange('2025-12', '2025-12-25')).toThrow(/not an ISO date/);
    expect(() => holidaysInRange('not-a-date!', '2025-12-25')).toThrow(/not an ISO date/);
  });
});

describe('holidayLookup', () => {
  it('keys the range by date, which is how every per-day caller asks', () => {
    const lookup = holidayLookup('2026-04-01', '2026-04-30');
    expect(lookup.get('2026-04-03')?.name).toBe('Good Friday');
    expect(lookup.get('2026-04-06')?.name).toBe('Family Day');
    expect(lookup.get('2026-04-27')?.name).toBe('Freedom Day');
    expect(lookup.has('2026-04-04')).toBe(false);
  });
});
