/**
 * The tests that justify the normalisation design.
 *
 * The scenario is deliberately one where the right answer is known before any code runs: five
 * doctors with mutually exclusive availability, each working **every slot they were available
 * for**. Nobody could have worked more and nobody could have worked less, so the only defensible
 * verdict is that all five carried exactly their fair share.
 *
 * That makes it a decisive test rather than a plausible one. A fairness measure that calls this
 * distribution unequal is measuring the wrong thing, and there is no argument about what the
 * expected value should be.
 */

import { describe, expect, it } from 'vitest';
import { AGREED_BURDEN_V2 } from './burden.ts';
import { gini } from './equity.ts';
import { buildLedger, entitlementWeights } from './ledger.ts';
import { buildPeriodReport } from './metrics.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';
import { heterogeneousAvailabilityPeriod } from './synthetic.ts';

const period = heterogeneousAvailabilityPeriod();

describe('the heterogeneous-availability scenario', () => {
  it('is fully covered, with the burden arithmetic we expect', () => {
    const ledger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);

    // 84 days x 3 shifts.
    expect(ledger.totalShifts).toBe(252);
    expect(ledger.uncoveredSlots).toBe(0);
    expect(ledger.entries).toHaveLength(5);

    // On AGREED_BURDEN_V2, confirmed 2026-09-04. 60 weekdays, of which 12 are Fridays:
    //   S01 mornings   60 x 1.0                        =  60
    //   S02 afternoons 60 x 1.75  (15:00, before 17:00) = 105
    //   S03 nights     48 x 2.5 + 12 x 3.0             = 156  ← Friday nights are weekend work
    //   S04 Saturdays  36 x 3.0                        = 108
    //   S05 Sundays    36 x 3.0                        = 108
    const burden = new Map(ledger.entries.map((entry) => [entry.doctor, entry.burden]));
    expect(burden.get('S01')).toBeCloseTo(60, 10);
    expect(burden.get('S02')).toBeCloseTo(105, 10);
    expect(burden.get('S03')).toBeCloseTo(156, 10);
    expect(burden.get('S04')).toBeCloseTo(108, 10);
    expect(burden.get('S05')).toBeCloseTo(108, 10);
    expect(ledger.totalBurden).toBeCloseTo(537, 10);
    // Saturday and Sunday now cost the same, so the two weekend doctors carry identical burden.
    expect(burden.get('S04')).toBeCloseTo(burden.get('S05') ?? 0, 10);
    // ⚠️ The Friday rule reaches the weekday-night doctor, which is easy to miss: a Friday 23:00
    // is after 17:00 on a Friday, so it prices as weekend work even though the day classifies as
    // a weekday and runs Pattern A. 12 Fridays x 0.5 = the 6 points above a flat 60 x 2.5.
    expect(burden.get('S03')).toBeGreaterThan(60 * 2.5);
  });
});

describe('why raw burden and equal shares are the wrong denominators', () => {
  it('raw burden ranks the Sunday doctor as carrying twice the weekday doctor', () => {
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, {
      basis: 'equal',
    });
    const byDoctor = new Map(report.doctors.map((doctor) => [doctor.doctor, doctor]));

    // S05 works 36 shifts, S01 works 60 — and S05 still carries more burden.
    expect(byDoctor.get('S05')?.shifts).toBe(36);
    expect(byDoctor.get('S01')?.shifts).toBe(60);
    expect(byDoctor.get('S05')?.burden).toBeGreaterThan(byDoctor.get('S01')?.burden ?? 0);
  });

  it('an equal-shares basis wrongly reports the restricted doctors as overloaded', () => {
    // ⚠️ This test asserts the BUG, on purpose. It is the failure mode the practice owner
    // identified: "that shouldn't force them to work more at my dad's practice just because the
    // analytics says they are slacking" — and its mirror image, a weekends-only doctor being told
    // they are over-worked and having weekends taken away when weekends are all they can work.
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, {
      basis: 'equal',
    });
    const ratio = new Map(report.doctors.map((doctor) => [doctor.doctor, doctor.loadRatio]));

    // Fair share on an equal basis is 531/5 = 106.2 each.
    expect(ratio.get('S03') ?? 0).toBeGreaterThan(1.4); // weekday nights: "overloaded"
    expect(ratio.get('S01') ?? 0).toBeLessThan(0.7); // weekday mornings: "slacking"

    // ⚠️ The spread is what the test is really about, and asserting it directly is what makes this
    // robust. It used to also assert the Sunday doctor above 1.2 — true on v1's weights, where a
    // Sunday cost 3.5 against a Saturday's 3.0. On the principal's confirmed v2 numbers Sunday and
    // Saturday are level at 3.0, so S05 now lands near 1.0 and is no longer the striking case.
    // **The bug did not go away; it moved.** Which doctor an equal basis defames depends on which
    // cell happens to be priciest, so the durable claim is the spread, not the doctor.
    const ratios = [...ratio.values()].filter((value): value is number => value !== null);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.8);

    // And the practice looks meaningfully unequal when in fact nobody had any choice.
    expect(report.practice.giniLoadRatio).toBeGreaterThan(0.1);
  });

  it('an active-days basis does not fix it either', () => {
    // Worth pinning: active-days corrects for joiners and leavers and nothing else. All five
    // doctors here span the same 28 days, so it degenerates to the equal basis.
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, {
      basis: 'active-days',
    });
    expect(report.practice.giniLoadRatio).toBeGreaterThan(0.1);
  });
});

describe('revealed-opportunity normalisation', () => {
  it('reports every doctor as exactly fair, which is the correct answer here', () => {
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2, {
      basis: 'revealed-opportunity',
    });

    for (const doctor of report.doctors) {
      expect(doctor.loadRatio, `${doctor.doctor} load ratio`).toBeCloseTo(1, 9);
    }
    // Exactly equal, not approximately: each doctor's numerator and denominator are the same
    // set of slots.
    expect(report.practice.giniLoadRatio).toBeCloseTo(0, 9);
  });

  it('still reports raw burden as unequal, because it is', () => {
    // The normalisation must not launder the underlying facts. S03 really did work twenty nights
    // and S01 really did work twenty mornings; the report has to be able to say both that the
    // burden differed and that the *distribution of it* was fair.
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    // Asserted as a CONTRAST rather than against a fixed threshold. The old assertion was
    // `> 0.15`, which passed on v1's weights and fails on v2's at 0.145 — not because the
    // normalisation changed but because levelling Sunday to Saturday genuinely narrowed the raw
    // spread. Pinning the gap between the two measures keeps the claim ("the normalisation does
    // not launder the facts") true under any weight table the practice agrees to next.
    expect(report.practice.giniLoadRatio).toBeCloseTo(0, 9);
    expect(report.practice.giniBurden).toBeGreaterThan(0.1);
    expect(report.practice.giniBurden).toBeGreaterThan(report.practice.giniLoadRatio + 0.1);
  });

  it('discriminates: a doctor who works less than their opportunity drops below 1.0', () => {
    // Move half of S02's afternoons to S01, who is now shown to be available for afternoons too.
    // S02 has an unchanged opportunity set and less burden, so their ratio must fall.
    const assignments = period.assignments.map((assignment, index) =>
      assignment.doctor === 'S02' && index % 2 === 0
        ? { ...assignment, doctor: 'S01' }
        : assignment,
    );
    const report = buildPeriodReport(
      { ...period, label: 'reassigned', assignments },
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );
    const ratio = new Map(report.doctors.map((doctor) => [doctor.doctor, doctor.loadRatio]));

    expect(ratio.get('S02') ?? 1).toBeLessThan(0.8);
    // And the three doctors whose commitment did not change are now carrying more than their
    // share of what remains.
    expect(ratio.get('S03') ?? 0).toBeGreaterThan(1);
    expect(ratio.get('S05') ?? 0).toBeGreaterThan(1);
  });

  it('scopes opportunity to the doctor’s own membership window', () => {
    // A doctor who leaves halfway through must not be charged for the slots they were absent
    // for. Drop every S04 assignment after the second Saturday.
    const assignments = period.assignments.filter(
      (assignment) => !(assignment.doctor === 'S04' && assignment.date > '2025-01-20'),
    );
    const ledger = buildLedger(
      { ...period, label: 'departed', assignments },
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );
    const weights = entitlementWeights(
      { ...period, label: 'departed', assignments },
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      ledger,
      { basis: 'revealed-opportunity' },
    );

    // Two Saturdays of opportunity, not twelve: 6 shifts x 3.0.
    expect(weights.get('S04')).toBeCloseTo(18, 10);

    // The contrast that makes the point: over the untruncated period the same doctor's
    // opportunity is all twelve Saturdays. Without window scoping, 18 carried against a 108
    // opportunity would read as one sixth of a fair share rather than exactly one.
    const fullLedger = buildLedger(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const fullWeights = entitlementWeights(
      period,
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
      fullLedger,
      { basis: 'revealed-opportunity' },
    );
    expect(fullWeights.get('S04')).toBeCloseTo(108, 10);

    const report = buildPeriodReport(
      { ...period, label: 'departed', assignments },
      PILOT_PATTERNS_V1,
      AGREED_BURDEN_V2,
    );
    const s04 = report.doctors.find((doctor) => doctor.doctor === 'S04');
    // Still exactly fair: they worked everything available to them while they were here, so
    // leaving early must not read as under-contributing.
    expect(s04?.loadRatio ?? 0).toBeCloseTo(1, 9);
    expect(s04?.activeDays).toBe(8);

    // Leaving early is correctly reported as low-sample rather than as under-contributing.
    expect(s04?.ratioConfidence).toBe('low-sample');
  });

  it('is not fooled by a doctor who never worked at all', () => {
    // Nobody with zero assignments appears in the ledger, so there is no phantom 0.0 ratio
    // dragging the practice-wide figures down.
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    expect(report.doctors.map((doctor) => doctor.doctor)).not.toContain('S99');
  });
});

describe('the gini it reports is the one on load ratios, not on burden', () => {
  it('would tell a different and misleading story if it used raw burden', () => {
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const rawBurdenGini = gini(report.doctors.map((doctor) => doctor.equalisableBurden));
    expect(report.practice.giniBurden).toBeCloseTo(rawBurdenGini, 10);
    // Both are reported. Only one of them is the fairness headline, and it is the other one.
    expect(report.practice.giniBurden).toBeGreaterThan(report.practice.giniLoadRatio);
  });
});
