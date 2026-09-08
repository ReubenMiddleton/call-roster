import { describe, expect, it } from 'vitest';
import { AGREED_BURDEN_V2 } from './burden.ts';
import {
  buildLedger,
  cellKey,
  entitlementWeights,
  EQUALISABLE_PROVENANCES,
  HOLIDAY_LEDGER_WINDOW_MONTHS,
  holidayLedgerCutoff,
  LEDGER_WINDOW_MONTHS,
  ledgerCutoff,
  equalisableBurdenVector,
  revealedCells,
} from './ledger.ts';
import { buildPeriodReport } from './metrics.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';
import type { Assignment, Provenance, RosterPeriod } from './types.ts';

/** One weekday, one Saturday, one Sunday. Pattern A throughout. */
function threeDayPeriod(assignments: readonly Assignment[]): RosterPeriod {
  return {
    label: 'three-days',
    days: [
      { date: '2025-01-06', patternId: 'A', dayClass: 'weekday' },
      { date: '2025-01-11', patternId: 'A', dayClass: 'saturday' },
      { date: '2025-01-12', patternId: 'A', dayClass: 'sunday' },
    ],
    assignments,
  };
}

function assignment(
  date: string,
  shiftId: string,
  doctor: string,
  provenance: Provenance,
): Assignment {
  return { date, shiftId, doctor, provenance };
}

describe('provenance', () => {
  it('excludes requested burden from the equalisation total and includes the rest', () => {
    // The single most consequential rule in the ledger. A doctor who asks for extra shifts must
    // not have next month's work withheld as a consequence.
    const period = threeDayPeriod([
      assignment('2025-01-06', 'std-morning', 'S01', 'directed'), // 1.0
      assignment('2025-01-06', 'std-night', 'S01', 'requested'), // 2.5, excluded
      assignment('2025-01-11', 'std-morning', 'S01', 'absorbed'), // 3.0, included
      assignment('2025-01-12', 'std-morning', 'S01', 'unknown'), // 3.0, included
    ]);
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const entry = ledger.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.burden).toBeCloseTo(9.5, 10);
    expect(entry?.equalisableBurden).toBeCloseTo(7, 10);
    expect(entry?.burdenByProvenance.requested).toBeCloseTo(2.5, 10);
  });

  it('keeps absorbed burden in the objective, on the owner’s explicit instruction', () => {
    // Burden taken on because nobody else was available is a recurring operational failure. A
    // system that hides it destroys the evidence needed to argue for fixing it. See
    // docs/domain/fairness.md.
    expect(EQUALISABLE_PROVENANCES).toContain('absorbed');
    expect(EQUALISABLE_PROVENANCES).not.toContain('requested');
  });

  it('counts shifts as well as burden per provenance', () => {
    const period = threeDayPeriod([
      assignment('2025-01-06', 'std-morning', 'S01', 'requested'),
      assignment('2025-01-06', 'std-afternoon', 'S01', 'requested'),
      assignment('2025-01-06', 'std-night', 'S02', 'directed'),
    ]);
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const s01 = ledger.entries.find((entry) => entry.doctor === 'S01');
    expect(s01?.shiftsByProvenance.requested).toBe(2);
    expect(s01?.shiftsByProvenance.directed).toBe(0);
  });
});

describe('buildLedger', () => {
  it('refuses to silently drop an assignment naming an unknown shift', () => {
    // A dropped assignment understates someone's burden, which is the one class of bug a
    // fairness ledger must never have.
    const period = threeDayPeriod([assignment('2025-01-06', 'graveyard', 'S01', 'directed')]);
    expect(() => buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2)).toThrow(
      /unknown shift "graveyard"/,
    );
  });

  it('refuses an assignment on a date the period does not contain', () => {
    const period = threeDayPeriod([assignment('2025-02-01', 'std-morning', 'S01', 'directed')]);
    expect(() => buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2)).toThrow(
      /no matching day/,
    );
  });

  it('counts uncovered slots, which H-01 says should always be zero', () => {
    // 3 days x 3 slots = 9. Only one assigned.
    const period = threeDayPeriod([assignment('2025-01-06', 'std-morning', 'S01', 'directed')]);
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    expect(ledger.uncoveredSlots).toBe(8);
  });

  it('tracks the first and last date a doctor appears', () => {
    const period = threeDayPeriod([
      assignment('2025-01-12', 'std-morning', 'S01', 'directed'),
      assignment('2025-01-06', 'std-morning', 'S01', 'directed'),
    ]);
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const entry = ledger.entries[0];
    expect(entry?.firstSeen).toBe('2025-01-06');
    expect(entry?.lastSeen).toBe('2025-01-12');
    expect(entry?.activeDays).toBe(7);
  });

  it('carries the burden schedule’s confidence through to the ledger', () => {
    const ledger = buildLedger(threeDayPeriod([]), PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    // CONFIRMED since 2026-09-04, when the principal gave his own numbers (question 35). Before
    // that the table was approved as "fair" in the abstract but the numbers were placeholders.
    expect(ledger.scheduleConfidence).toBe('CONFIRMED');
    expect(ledger.scheduleVersion).toBe('agreed-v2');
  });

  it('sorts heaviest first and exposes the burden vector for leximax', () => {
    const period = threeDayPeriod([
      assignment('2025-01-06', 'std-morning', 'S01', 'directed'), // 1.0
      assignment('2025-01-12', 'std-morning', 'S02', 'directed'), // 3.0, a Sunday
    ]);
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    expect(ledger.entries.map((entry) => entry.doctor)).toEqual(['S02', 'S01']);
    expect(equalisableBurdenVector(ledger)).toEqual([3, 1]);
  });
});

describe('revealedCells', () => {
  it('records only the day-class and shift-kind combinations actually worked', () => {
    const period = threeDayPeriod([
      assignment('2025-01-06', 'std-night', 'S01', 'directed'),
      assignment('2025-01-11', 'std-morning', 'S01', 'directed'),
    ]);
    const cells = revealedCells(period, PILOT_PATTERNS_V1);
    const s01 = cells.get('S01');
    expect(s01?.has(cellKey('weekday', 'night'))).toBe(true);
    expect(s01?.has(cellKey('saturday', 'morning'))).toBe(true);
    // Never worked a Sunday, so no Sunday opportunity is inferred. This is the proxy's
    // documented downward bias, asserted so a future change to it is deliberate.
    expect(s01?.has(cellKey('sunday', 'morning'))).toBe(false);
    expect(s01?.size).toBe(2);
  });
});

describe('entitlementWeights', () => {
  const period = threeDayPeriod([
    assignment('2025-01-06', 'std-morning', 'S01', 'directed'),
    assignment('2025-01-12', 'std-morning', 'S02', 'directed'),
  ]);
  const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);

  it('gives everyone 1 on the equal basis', () => {
    const weights = entitlementWeights(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, ledger, {
      basis: 'equal',
    });
    expect([...weights.values()]).toEqual([1, 1]);
  });

  it('uses the caller’s numbers on the explicit basis, and demands them', () => {
    const weights = entitlementWeights(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, ledger, {
      basis: 'explicit',
      explicitWeights: new Map([['S01', 0.5]]),
    });
    expect(weights.get('S01')).toBe(0.5);
    // A doctor with no explicit weight gets 0, which computeLoadRatios reports as "not
    // comparable" rather than inventing a share for them.
    expect(weights.get('S02')).toBe(0);

    expect(() =>
      entitlementWeights(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, ledger, {
        basis: 'explicit',
      }),
    ).toThrow(/requires explicitWeights/);
  });

  it('takes revealed-opportunity cells from the caller when given', () => {
    const fromPeriod = entitlementWeights(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, ledger, {
      basis: 'revealed-opportunity',
    });
    // S01 was seen only on a weekday morning here. Told they also work weekday nights, their
    // opportunity set widens and their entitlement must grow - the seam that lets a denominator
    // be fitted on history and applied to a month it did not come from.
    const supplied = entitlementWeights(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, ledger, {
      basis: 'revealed-opportunity',
      cells: new Map([
        ['S01', new Set([cellKey('weekday', 'morning'), cellKey('weekday', 'night')])],
      ]),
    });

    expect(supplied.get('S01')).toBeGreaterThan(fromPeriod.get('S01') ?? 0);
    // S02 was not mentioned in the supplied cells, so they have no opportunity at all - not
    // whatever the period happened to show. Supplied cells replace, never merge.
    expect(supplied.get('S02')).toBe(0);
  });
});

describe('report caveats', () => {
  it('no longer warns about the weights, because the practice agreed them', () => {
    // Inverted on 2026-08-31. The caveat machinery is still exercised by the other tests in this
    // block; what changed is that this particular warning must NOT fire for a CONFIRMED schedule.
    // A report carrying a health warning it has outgrown teaches readers to ignore all of them.
    const report = buildPeriodReport(
      threeDayPeriod([assignment('2025-01-06', 'std-morning', 'S01', 'directed')]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );
    expect(report.practice.caveats).not.toContainEqual(
      expect.stringContaining('provisional until the practice agrees the weights'),
    );
  });

  it('warns that availability is inferred, on the revealed-opportunity basis', () => {
    const report = buildPeriodReport(
      threeDayPeriod([assignment('2025-01-06', 'std-morning', 'S01', 'directed')]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      { basis: 'revealed-opportunity' },
    );
    expect(report.practice.caveats).toContainEqual(
      expect.stringContaining('revealed availability'),
    );
  });

  it('warns when most shifts have no recorded provenance, as all history does', () => {
    const report = buildPeriodReport(
      threeDayPeriod([
        assignment('2025-01-06', 'std-morning', 'S01', 'unknown'),
        assignment('2025-01-06', 'std-afternoon', 'S02', 'unknown'),
      ]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );
    expect(report.practice.caveats).toContainEqual(
      expect.stringContaining('no recorded provenance'),
    );
  });

  it('warns about a coverage gap', () => {
    const report = buildPeriodReport(
      threeDayPeriod([assignment('2025-01-06', 'std-morning', 'S01', 'directed')]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );
    expect(report.practice.caveats).toContainEqual(expect.stringContaining('H-01 is violated'));
  });

  it('warns that an equal basis is meaningless for this practice', () => {
    const report = buildPeriodReport(
      threeDayPeriod([assignment('2025-01-06', 'std-morning', 'S01', 'directed')]),
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      { basis: 'equal' },
    );
    expect(report.practice.caveats).toContainEqual(expect.stringContaining('equally available'));
  });
});

describe('Friday counting', () => {
  it('counts Fridays separately from the burden day class', () => {
    // Friday is confirmed weekend work by the practice (2026-08-31) but classifies as `weekday`
    // for burden, so it is priced at weekday rates. Counting it separately is what makes the
    // under-pricing visible instead of invisible. See the Weekend entry in the glossary.
    const period: RosterPeriod = {
      label: 'one-friday',
      days: [
        { date: '2025-01-10', patternId: 'B', dayClass: 'weekday' }, // a Friday
        { date: '2025-01-07', patternId: 'A', dayClass: 'weekday' }, // a Tuesday
      ],
      assignments: [
        assignment('2025-01-10', 'fri-night', 'S01', 'directed'),
        assignment('2025-01-07', 'std-night', 'S01', 'directed'),
      ],
    };
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const entry = ledger.entries[0];

    expect(entry?.shiftsOnFriday).toBe(1);
    // Both still classify as `weekday` — `dayClass` is a calendar fact and Friday is a weekday.
    expect(entry?.shiftsByDayClass.weekday).toBe(2);
    // But they no longer price the same. Question V was answered on 2026-09-04: the Friday night
    // is weekend work at 3.0, the Tuesday night stays 2.5. The count and the weight now disagree
    // on purpose, which is why `shiftsOnFriday` is tracked separately from `shiftsByDayClass`.
    expect(entry?.burden).toBeCloseTo(5.5, 10); // 3.0 Friday night + 2.5 Tuesday night
  });
});

describe('ledger windows', () => {
  it('walks back three months for S-01', () => {
    expect(ledgerCutoff('2026-09')).toBe('2026-06-01');
    expect(LEDGER_WINDOW_MONTHS).toBe(3);
  });

  it('crosses a year boundary correctly', () => {
    expect(ledgerCutoff('2026-02')).toBe('2025-11-01');
    expect(holidayLedgerCutoff('2026-02')).toBe('2025-02-01');
  });

  it('⚠️ walks back TWELVE months for S-08, not three', () => {
    // The two windows answer different questions and must not converge. S-01 runs over three
    // months on the principal's instruction; S-08 runs over twelve because he asked for public
    // holidays to be shared "throughout the year", and a year holds only about 44 holiday slots.
    // Three months of those is roughly eleven across thirteen doctors — not enough to be fair
    // with, and a solver told otherwise would spread noise.
    expect(holidayLedgerCutoff('2026-09')).toBe('2025-09-01');
    expect(HOLIDAY_LEDGER_WINDOW_MONTHS).toBe(12);
    expect(holidayLedgerCutoff('2026-09') < ledgerCutoff('2026-09')).toBe(true);
  });

  it('refuses a malformed month rather than returning a plausible date', () => {
    // A silently wrong cutoff would quietly change the span of every fairness figure.
    expect(() => ledgerCutoff('September')).toThrow(/not an ISO month/);
    expect(() => holidayLedgerCutoff('2026')).toThrow(/not an ISO month/);
  });
});
