import { describe, expect, it } from 'vitest';
import {
  anchorHolders,
  inferRecurringSlots,
  inferSlotShares,
  slotKey,
  windowStart,
} from './anchors.ts';
import { classifyDay } from './shifts.ts';
import type { Assignment, RosterDay, RosterPeriod } from './types.ts';

const SHIFTS = ['std-morning', 'std-afternoon', 'std-night'] as const;

function period(start: string, weeks: number, rota: readonly string[][]): RosterPeriod {
  const days: RosterDay[] = [];
  const assignments: Assignment[] = [];
  const from = new Date(`${start}T00:00:00Z`);

  for (let index = 0; index < weeks * 7; index += 1) {
    const date = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    days.push({ date, patternId: 'A', dayClass: classifyDay(date, false), isPublicHoliday: false });
    const row = rota[index % rota.length];
    if (row === undefined) {
      continue;
    }
    SHIFTS.forEach((shiftId, slot) => {
      const doctor = row[slot];
      if (doctor !== undefined) {
        assignments.push({ date, shiftId, doctor, provenance: 'unknown' });
      }
    });
  }
  return { label: 'p', days, assignments };
}

const REGULAR = [['D01', 'D02', 'D03']];

describe('slotKey', () => {
  it('is weekday then shift, with Sunday as 0', () => {
    expect(slotKey(1, 'std-morning')).toBe('1|std-morning');
  });
});

describe('anchorHolders', () => {
  it('finds the dominant holder of every weekday slot', () => {
    const holders = anchorHolders(period('2026-01-05', 12, REGULAR).assignments);
    expect(holders.size).toBe(21); // seven weekdays × three slots
    expect(holders.get(slotKey(1, 'std-morning'))).toBe('D01');
  });

  it('returns nothing for a genuine rotation', () => {
    const rotating = period('2026-01-05', 12, [
      ['D01', 'D02', 'D03'],
      ['D02', 'D03', 'D01'],
      ['D03', 'D01', 'D02'],
    ]);
    expect(anchorHolders(rotating.assignments).size).toBe(0);
  });
});

describe('inferRecurringSlots', () => {
  it('produces the shape buildSolveRequest takes', () => {
    const slots = inferRecurringSlots(period('2026-01-05', 12, REGULAR));
    expect(slots).toHaveLength(21);
    // Looked up rather than taken by index: the sort is weekday then shift id *alphabetically*, so
    // `slots[0]` is Sunday's afternoon, not its morning.
    expect(slots.find((slot) => slot.weekday === 1 && slot.shiftId === 'std-morning')).toEqual({
      doctor: 'D01',
      weekday: 1,
      shiftId: 'std-morning',
      held: 12,
      observed: 12,
    });
  });

  it('sorts by weekday, then by shift id', () => {
    const slots = inferRecurringSlots(period('2026-01-05', 12, REGULAR));
    const weekdays = slots.map((slot) => slot.weekday);
    expect(weekdays).toEqual([...weekdays].sort((left, right) => left - right));
    expect(slots[0]?.weekday).toBe(0);
    expect(slots[0]?.shiftId).toBe('std-afternoon');
    expect(slots[slots.length - 1]?.weekday).toBe(6);
  });

  it('drops a slot seen too few times to be a pattern', () => {
    // Two weeks is two observations per weekday slot, under the default minimum of four. A "slot"
    // seen twice is a coincidence, and sending it would have the solver defend a pattern that does
    // not exist.
    expect(inferRecurringSlots(period('2026-01-05', 2, REGULAR))).toEqual([]);
    expect(
      inferRecurringSlots(period('2026-01-05', 2, REGULAR), { minObservations: 2 }),
    ).toHaveLength(21);
  });

  it('honours the window, which is what makes a handover visible', () => {
    // D01 holds the Monday morning for six weeks, then D05 takes it for six. Reading the whole
    // period would call it 50/50 and return no anchor at all; reading the trailing half returns D05.
    const early = period('2026-01-05', 6, REGULAR);
    const late = period('2026-02-16', 6, [['D05', 'D02', 'D03']]);
    const combined: RosterPeriod = {
      label: 'p',
      days: [...early.days, ...late.days],
      assignments: [...early.assignments, ...late.assignments],
    };

    const whole = inferRecurringSlots(combined).find(
      (slot) => slot.weekday === 1 && slot.shiftId === 'std-morning',
    );
    expect(whole).toBeUndefined();

    const recent = inferRecurringSlots(combined, { from: '2026-02-16' }).find(
      (slot) => slot.weekday === 1 && slot.shiftId === 'std-morning',
    );
    expect(recent?.doctor).toBe('D05');
  });

  it('excludes assignments on or after `before`, so a month cannot inform its own solve', () => {
    const combined = period('2026-01-05', 12, REGULAR);
    const slots = inferRecurringSlots(combined, { before: '2026-01-19' });
    // Two weeks of history, so every slot falls under the default minimum.
    expect(slots).toEqual([]);
  });

  it('returns nothing for an empty period rather than throwing', () => {
    expect(inferRecurringSlots({ label: 'p', days: [], assignments: [] })).toEqual([]);
  });
});

describe('windowStart', () => {
  it('steps back whole months and lands on the first', () => {
    expect(windowStart('2026-08', 6)).toBe('2026-02-01');
    expect(windowStart('2026-01', 6)).toBe('2025-07-01');
  });

  it('refuses a malformed month', () => {
    expect(() => windowStart('2026', 6)).toThrow(/not an ISO month/);
  });
});

describe('inferSlotShares', () => {
  // A three-week cycle in which nobody clears two thirds of anything: D01, D02 and D03 each
  // hold every slot once. This is the shape `inferRecurringSlots` discards and S-09 exists for.
  const ROTATION = [
    ['D01', 'D02', 'D03'],
    ['D02', 'D03', 'D01'],
    ['D03', 'D01', 'D02'],
  ];

  it('reports every participant of a rotated slot, with their share', () => {
    const shares = inferSlotShares(period('2026-01-05', 12, ROTATION)).filter(
      (share) => share.weekday === 1 && share.shiftId === 'std-morning',
    );
    expect(shares.map((share) => share.doctor).sort()).toEqual(['D01', 'D02', 'D03']);
    for (const share of shares) {
      expect(share.share).toBeCloseTo(1 / 3, 5);
    }
  });

  it('excludes any slot that has a dominant holder, so S-05 and S-09 never overlap', () => {
    // ⚠️ The partition is the point. Two objective terms pulling on one slot price it twice,
    // and the weights are calibrated for one.
    const anchored = period('2026-01-05', 12, REGULAR);
    expect(inferSlotShares(anchored)).toEqual([]);
    expect(inferRecurringSlots(anchored).length).toBeGreaterThan(0);
  });

  it('shares of one slot sum to one', () => {
    const shares = inferSlotShares(period('2026-01-05', 12, ROTATION)).filter(
      (share) => share.weekday === 3 && share.shiftId === 'std-night',
    );
    const total = shares.reduce((sum, share) => sum + share.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('honours the same window bounds as the anchors', () => {
    // Both are the same measurement read at two thresholds; computing them over different
    // spans would let them disagree about who currently works a slot.
    const combined = period('2026-01-05', 12, ROTATION);
    expect(inferSlotShares(combined, { before: '2026-01-19' })).toEqual([]);
  });

  it('drops a slot seen too few times to call', () => {
    expect(inferSlotShares(period('2026-01-05', 12, ROTATION), { minObservations: 99 })).toEqual(
      [],
    );
  });

  it('returns nothing for an empty period rather than throwing', () => {
    expect(inferSlotShares({ label: 'p', days: [], assignments: [] })).toEqual([]);
  });
});

describe('handover detection', () => {
  /**
   * Sixteen consecutive Tuesdays from 2026-01-06, one `std-afternoon` each, handed over after
   * `weeksBefore`. Sixteen weeks spans four months, so either side of a mid-point handover has the
   * two clean months {@link HANDOVER_CONFIRM_MONTHS} requires.
   */
  function handover(oldHolder: string, newHolder: string, weeksBefore: number): RosterPeriod {
    const days: RosterDay[] = [];
    const assignments: Assignment[] = [];
    for (let week = 0; week < 16; week += 1) {
      const date = new Date(Date.UTC(2026, 0, 6 + week * 7)).toISOString().slice(0, 10);
      days.push({
        date,
        patternId: 'A',
        dayClass: classifyDay(date, false),
        isPublicHoliday: false,
      });
      assignments.push({
        date,
        shiftId: 'std-afternoon',
        doctor: week < weeksBefore ? oldHolder : newHolder,
        provenance: 'unknown',
      });
    }
    return { label: 'p', days, assignments };
  }

  it('gives the slot to the new holder outright, not to a rotation between the two', () => {
    // ⚠️ THE SEPTEMBER 2026 REGRESSION. D05 took Tuesday afternoon outright in July; the six-month
    // window held four pre-handover months against two post-, reported D03 at 58% — under
    // ANCHOR_DOMINANCE — and so produced a *rotation between the old holder and the new one*,
    // which is the one thing it was not. The blind solve gave D03 three of the month's Tuesday
    // afternoons; the practice gave him none. Fixing this moved the blind match 48.9% → 61.7%.
    const period = handover('D03', 'D05', 8);

    const anchor = inferRecurringSlots(period).find((slot) => slot.shiftId === 'std-afternoon');
    expect(anchor?.doctor).toBe('D05');
    expect(anchor?.held).toBe(anchor?.observed); // narrowed, so the old holder is not counted

    // And the partition holds: an anchored slot must not also arrive as a share.
    expect(inferSlotShares(period)).toEqual([]);
  });

  it('ignores a single month of a stand-in', () => {
    // One month of a new name is a locum, a holiday or a transcription slip. Acting on it would
    // throw away the real holder's history — hence HANDOVER_CONFIRM_MONTHS.
    const anchor = inferRecurringSlots(handover('D03', 'D05', 13)).find(
      (slot) => slot.shiftId === 'std-afternoon',
    );
    expect(anchor?.doctor).toBe('D03');
    expect(anchor?.observed).toBe(16);
  });

  it('leaves a genuine rotation on the full window', () => {
    // No stable monthly majority, so the walk stops immediately and nothing is narrowed. Getting
    // this wrong would shrink every pool slot to its most recent month.
    const shares = inferSlotShares(
      period('2026-01-05', 12, [
        ['D01', 'D02', 'D03'],
        ['D02', 'D03', 'D01'],
        ['D03', 'D01', 'D02'],
      ]),
    ).filter((share) => share.weekday === 1 && share.shiftId === 'std-morning');
    expect(shares.map((share) => share.observed)).toEqual([12, 12, 12]);
  });

  it('does not narrow a slot whose holder never changed', () => {
    const anchor = inferRecurringSlots(period('2026-01-05', 12, REGULAR)).find(
      (slot) => slot.weekday === 1 && slot.shiftId === 'std-morning',
    );
    expect(anchor?.observed).toBe(12);
  });
});
