import { describe, expect, it } from 'vitest';
import { anchorHolders } from './anchors.ts';
import {
  DEPARTURE_AXES,
  type DepartureAxisKey,
  departureProfile,
  historyBefore,
  MIN_HISTORY_MONTHS,
  placeInBand,
  referenceBand,
  totalVariationDistance,
} from './departure.ts';
import { classifyDay, PILOT_PATTERNS_V1 } from './shifts.ts';
import type { Assignment, RosterDay, RosterPeriod } from './types.ts';

const SHIFTS = ['std-morning', 'std-afternoon', 'std-night'] as const;

/**
 * A run of Pattern A days starting on a Monday, with the three slots filled by the given rota.
 *
 * `rota` is indexed by `dayNumber % rota.length`, so a rota of one doctor per slot reproduces a
 * perfectly regular anchor pattern and any deviation is deliberate.
 */
function period(
  label: string,
  start: string,
  weeks: number,
  rota: readonly string[][],
): RosterPeriod {
  const days: RosterDay[] = [];
  const assignments: Assignment[] = [];
  const from = new Date(`${start}T00:00:00Z`);

  for (let index = 0; index < weeks * 7; index += 1) {
    const at = new Date(from.getTime() + index * 86_400_000);
    const date = at.toISOString().slice(0, 10);
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
  return { label, days, assignments };
}

/** A week-long rota where the same three doctors hold the same three slots every day. */
const REGULAR = [['D01', 'D02', 'D03']];

function distanceOf(profile: ReturnType<typeof departureProfile>, key: DepartureAxisKey): number {
  const axis = profile.axes.find((entry) => entry.key === key);
  if (axis === undefined) {
    throw new Error(`no axis ${key}`);
  }
  return axis.distance;
}

const OPTIONS = { patterns: PILOT_PATTERNS_V1 };

describe('totalVariationDistance', () => {
  it('is zero for identical distributions, regardless of scale', () => {
    const small = new Map([
      ['D01', 1],
      ['D02', 3],
    ]);
    const large = new Map([
      ['D01', 10],
      ['D02', 30],
    ]);
    expect(totalVariationDistance(small, large)).toBeCloseTo(0);
  });

  it('is one when the two share nothing', () => {
    expect(totalVariationDistance(new Map([['D01', 5]]), new Map([['D02', 5]]))).toBeCloseTo(1);
  });

  it('reads as the share of shifts that would have to change hands', () => {
    // History: D01 all ten. Candidate: D01 eight, D02 two. Two in ten sit differently → 0.2.
    const history = new Map([['D01', 10]]);
    const candidate = new Map([
      ['D01', 8],
      ['D02', 2],
    ]);
    expect(totalVariationDistance(candidate, history)).toBeCloseTo(0.2);
  });

  it('treats a doctor absent from one side as a full contribution, not a skip', () => {
    const left = new Map([
      ['D01', 1],
      ['D02', 1],
    ]);
    const right = new Map([['D01', 1]]);
    expect(totalVariationDistance(left, right)).toBeCloseTo(0.5);
  });

  it('calls two empty inputs identical rather than maximally different', () => {
    expect(totalVariationDistance(new Map(), new Map())).toBe(0);
    expect(totalVariationDistance(new Map([['D01', 1]]), new Map())).toBe(1);
  });
});

describe('anchorHolders', () => {
  it('derives the usual holder of each weekday slot from history alone', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    const holders = anchorHolders(history.assignments);
    // Monday is 1 in this module's convention (0 = Sunday).
    expect(holders.get('1|std-morning')).toBe('D01');
    expect(holders.get('1|std-night')).toBe('D03');
  });

  it('reports no holder for a slot that merely rotates', () => {
    // Three doctors taking turns is a rotation, not an anchor. A simple majority would call the
    // most frequent one an anchor and then report every ordinary turn as a departure.
    //
    // The rota is three rows long on purpose. Seven rows would advance in step with the week and
    // land the same row on the same weekday forever, which is an anchor pattern rather than a
    // rotation — the first version of this test made exactly that mistake and asserted 0 against 21.
    const rotating = period('history', '2026-01-05', 12, [
      ['D01', 'D02', 'D03'],
      ['D02', 'D03', 'D01'],
      ['D03', 'D01', 'D02'],
    ]);
    expect(anchorHolders(rotating.assignments).size).toBe(0);
  });
});

describe('departureProfile', () => {
  it('reports zero on every axis when the candidate repeats history exactly', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    const candidate = period('candidate', '2026-03-30', 4, REGULAR);
    const profile = departureProfile(candidate, history, OPTIONS);

    for (const axis of profile.axes) {
      expect(axis.distance).toBeCloseTo(0);
    }
    expect(profile.anchorMisses).toEqual([]);
    expect(profile.doctorsWithoutHistory).toEqual([]);
  });

  it('reports a large departure when the same doctors swap round completely', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    const candidate = period('candidate', '2026-03-30', 4, [['D03', 'D01', 'D02']]);
    const profile = departureProfile(candidate, history, OPTIONS);

    // Nobody's total changes — each still works a third — so share-of-shifts is unmoved. That is
    // the point of measuring more than one axis: the month looks identical by workload and is
    // completely rearranged by slot.
    expect(distanceOf(profile, 'share-of-shifts')).toBeCloseTo(0);
    expect(distanceOf(profile, 'anchor-slots')).toBeCloseTo(1);
    expect(profile.anchorMisses).toHaveLength(84);
  });

  it('names who took an anchor slot instead, because that is what gets asked about', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    const candidate = period('candidate', '2026-03-30', 1, [['D02', 'D01', 'D03']]);
    const miss = departureProfile(candidate, history, OPTIONS).anchorMisses[0];
    expect(miss?.usualHolder).toBe('D01');
    expect(miss?.instead).toBe('D02');
    expect(miss?.shiftId).toBe('std-morning');
  });

  it('moves the nights axis without moving the others when only nights are redistributed', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    // D03 keeps the same number of shifts but half of them move to mornings, and D01 takes nights.
    const candidate = period('candidate', '2026-03-30', 4, [
      ['D01', 'D02', 'D03'],
      ['D03', 'D02', 'D01'],
    ]);
    const profile = departureProfile(candidate, history, OPTIONS);
    expect(distanceOf(profile, 'share-of-shifts')).toBeCloseTo(0);
    expect(distanceOf(profile, 'nights')).toBeGreaterThan(0.4);
  });

  it('flags an axis as unreliable rather than reporting noise', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    const candidate = period('candidate', '2026-03-30', 1, REGULAR); // 7 days → 7 nights
    const nights = departureProfile(candidate, history, OPTIONS).axes.find(
      (axis) => axis.key === 'nights',
    );
    expect(nights?.slots).toBe(7);
    expect(nights?.reliable).toBe(false);
  });

  it('surfaces a doctor with no history rather than folding them into the distances', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    const candidate = period('candidate', '2026-03-30', 4, [['D01', 'D02', 'D99']]);
    const profile = departureProfile(candidate, history, OPTIONS);
    expect(profile.doctorsWithoutHistory).toEqual(['D99']);
  });

  it('does not punish a month merely because a doctor left', () => {
    // The comparison is restricted to doctors present in the candidate and renormalised. Without
    // that, every month after a departure scores as wildly unusual for a reason the admin already
    // knows about, and the number stops meaning anything.
    const history = period('history', '2026-01-05', 12, [
      ['D01', 'D02', 'D03'],
      ['D01', 'D02', 'D04'],
    ]);
    const candidate = period('candidate', '2026-03-30', 4, [['D01', 'D02', 'D03']]);
    const profile = departureProfile(candidate, history, OPTIONS);
    expect(distanceOf(profile, 'share-of-shifts')).toBeLessThan(0.2);
  });

  it('never reports a distance outside 0..1', () => {
    const history = period('history', '2026-01-05', 12, REGULAR);
    for (const rota of [REGULAR, [['D03', 'D01', 'D02']], [['D01', 'D01', 'D01']]]) {
      const profile = departureProfile(period('c', '2026-03-30', 4, rota), history, OPTIONS);
      for (const axis of profile.axes) {
        expect(axis.distance).toBeGreaterThanOrEqual(0);
        expect(axis.distance).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('historyBefore', () => {
  it('flattens every month before the index and excludes the index itself', () => {
    const months = [
      period('m1', '2026-01-05', 1, REGULAR),
      period('m2', '2026-01-12', 1, REGULAR),
      period('m3', '2026-01-19', 1, REGULAR),
    ];
    const before = historyBefore(months, 2);
    expect(before.days).toHaveLength(14);
    expect(before.assignments.every((entry) => entry.date < '2026-01-19')).toBe(true);
  });

  it('is empty at index zero, which is why the first month is warm-up', () => {
    const months = [period('m1', '2026-01-05', 1, REGULAR)];
    expect(historyBefore(months, 0).assignments).toEqual([]);
  });
});

describe('referenceBand', () => {
  /** Twelve identical four-week months, then one where the rota is reversed. */
  function months(): RosterPeriod[] {
    const built: RosterPeriod[] = [];
    for (let index = 0; index < 12; index += 1) {
      const start = new Date(Date.UTC(2026, 0, 5) + index * 28 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      built.push(period(`m${String(index)}`, start, 4, REGULAR));
    }
    const lastStart = new Date(Date.UTC(2026, 0, 5) + 12 * 28 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    built.push(period('odd', lastStart, 4, [['D03', 'D01', 'D02']]));
    return built;
  }

  it('scores every month but the first, and marks the warm-up ones', () => {
    const { perMonth } = referenceBand(months(), OPTIONS);
    expect(perMonth).toHaveLength(12); // thirteen months, minus the first which has no history
    expect(perMonth.filter((month) => !month.counted)).toHaveLength(MIN_HISTORY_MONTHS - 1);
  });

  it('produces a band per axis, ordered min ≤ p25 ≤ median ≤ p75 ≤ max', () => {
    const { bands } = referenceBand(months(), OPTIONS);
    expect(bands.map((band) => band.axis)).toEqual(DEPARTURE_AXES);
    for (const band of bands) {
      expect(band.min).toBeLessThanOrEqual(band.p25);
      expect(band.p25).toBeLessThanOrEqual(band.median);
      expect(band.median).toBeLessThanOrEqual(band.p75);
      expect(band.p75).toBeLessThanOrEqual(band.max);
    }
  });

  it('puts the odd month out at the top of the anchor band', () => {
    const { bands, perMonth } = referenceBand(months(), OPTIONS);
    const anchorBand = bands.find((band) => band.axis === 'anchor-slots');
    const odd = perMonth[perMonth.length - 1];
    expect(odd?.label).toBe('odd');
    expect(odd?.distances.get('anchor-slots')).toBeCloseTo(anchorBand?.max ?? -1);
  });

  it('reports NaN rather than a fabricated band when there is nothing to measure', () => {
    const { bands } = referenceBand([], OPTIONS);
    expect(bands.every((band) => Number.isNaN(band.median))).toBe(true);
    expect(bands.every((band) => band.months === 0)).toBe(true);
  });
});

describe('placeInBand', () => {
  const band = {
    axis: 'nights' as const,
    min: 0.1,
    p25: 0.15,
    median: 0.2,
    p75: 0.25,
    max: 0.4,
    months: 27,
  };

  it('calls the interquartile range ordinary', () => {
    expect(placeInBand(0.2, band)).toBe('about as different as an ordinary month');
    expect(placeInBand(0.15, band)).toBe('about as different as an ordinary month');
    expect(placeInBand(0.25, band)).toBe('about as different as an ordinary month');
  });

  it('names the tails without implying either is good or bad', () => {
    expect(placeInBand(0.3, band)).toBe('more different than most months');
    expect(placeInBand(0.12, band)).toBe('less different than most months');
  });

  it('says plainly when nothing on record goes that far', () => {
    expect(placeInBand(0.5, band)).toBe('further from your usual pattern than any month on record');
    expect(placeInBand(0.05, band)).toBe('closer to your usual pattern than any month on record');
  });

  it('refuses to place anything against an empty band', () => {
    expect(placeInBand(0.2, { ...band, median: Number.NaN })).toBe('no band to compare against');
  });
});
