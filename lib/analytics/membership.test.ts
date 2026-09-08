/**
 * Joiners and leavers must not skew the fairness figures.
 *
 * A direct requirement from the practice owner, 31 August 2026:
 *
 * > *"New doctors are constantly joining and others are leaving on a year to year basis, so the
 * > system we build should be able to elegantly handle this sort of thing without having doctors
 * > that have left skew the analytics or fairness scale."*
 *
 * Two failure modes, both found by running the report over the real fifteen months rather than by
 * reasoning about it:
 *
 * 1. **A departed doctor sits in the current fairness average forever.** Their own historical
 *    figures are correct, but the practice-wide number is a claim about the people being rostered
 *    *now*.
 * 2. **A recent joiner clears an absolute threshold and gets judged anyway.** One doctor joined ten
 *    weeks before the period ended, cleared both the 20-shift and 60-day bars, and was reported as
 *    carrying 30% more than his share.
 */

import { describe, expect, it } from 'vitest';
import { AGREED_BURDEN_V2 } from './burden.ts';
import { DEPARTURE_GAP_DAYS, buildPeriodReport } from './metrics.ts';
import { PILOT_PATTERNS_V1 } from './shifts.ts';
import { buildSaturatedPeriod, dateRange } from './synthetic.ts';
import type { Assignment, RosterPeriod } from './types.ts';

/**
 * A year of Pattern A, with three doctors splitting each day. Long enough that the 90-day
 * departure gap and the 50% presence share are both meaningful.
 */
function yearPeriod(): RosterPeriod {
  return buildSaturatedPeriod(
    'a-year',
    dateRange('2025-01-06', 364),
    'A',
    ['std-morning', 'std-afternoon', 'std-night'],
    [
      {
        doctor: 'S01',
        dayClasses: ['weekday', 'saturday', 'sunday'],
        shiftIds: ['std-morning'],
      },
      {
        doctor: 'S02',
        dayClasses: ['weekday', 'saturday', 'sunday'],
        shiftIds: ['std-afternoon'],
      },
      { doctor: 'S03', dayClasses: ['weekday', 'saturday', 'sunday'], shiftIds: ['std-night'] },
    ],
  );
}

/** Reassigns a doctor's shifts outside a date window to a stand-in, simulating a partial tenure. */
function tenure(
  period: RosterPeriod,
  doctor: string,
  from: string,
  to: string,
  standIn: string,
): RosterPeriod {
  const assignments: Assignment[] = period.assignments.map((assignment) =>
    assignment.doctor === doctor && (assignment.date < from || assignment.date > to)
      ? { ...assignment, doctor: standIn }
      : assignment,
  );
  return { ...period, assignments };
}

const period = yearPeriod();

describe('membership inference', () => {
  it('marks everyone active when everyone works to the end of the period', () => {
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    expect(report.doctors.every((doctor) => doctor.membership === 'active')).toBe(true);
    expect(report.practice.departedDoctorCount).toBe(0);
    expect(report.practice.activeDoctorCount).toBe(3);
  });

  it('infers departure from a trailing gap longer than the threshold', () => {
    // S03 stops at the end of June; the period runs to early January. Roughly six months' gap.
    const departed = tenure(period, 'S03', '2025-01-06', '2025-06-30', 'S01');
    const report = buildPeriodReport(departed, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const s03 = report.doctors.find((doctor) => doctor.doctor === 'S03');

    expect(s03?.membership).toBe('inferred-departed');
    expect(s03?.daysSinceLastShift).toBeGreaterThan(DEPARTURE_GAP_DAYS);
    expect(report.practice.departedDoctorCount).toBe(1);
    expect(report.practice.activeDoctorCount).toBe(2);
  });

  it('does not mark a doctor departed for an ordinary gap between shifts', () => {
    // Stops three weeks before the end. A doctor working a couple of shifts a month must not be
    // written off for that — which is why the threshold is 90 days and not 30.
    const quiet = tenure(period, 'S03', '2025-01-06', '2025-12-15', 'S01');
    const report = buildPeriodReport(quiet, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    expect(report.doctors.find((doctor) => doctor.doctor === 'S03')?.membership).toBe('active');
  });

  it('keeps a departed doctor’s own figures, scoped to the time they were here', () => {
    const departed = tenure(period, 'S03', '2025-01-06', '2025-06-30', 'S01');
    const report = buildPeriodReport(departed, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const s03 = report.doctors.find((doctor) => doctor.doctor === 'S03');

    // Still in the table — hiding someone from their own ledger is worse than flagging them.
    expect(s03).toBeDefined();
    expect(s03?.shifts).toBeGreaterThan(100);
    // Their window is the half-year they worked, not the whole period.
    expect(s03?.lastSeen).toBe('2025-06-30');
    expect(s03?.presenceShare ?? 1).toBeLessThan(0.55);
  });

  it('excludes a departed doctor from the practice-wide fairness figure', () => {
    // The point of the requirement. S03 worked only nights, so a half-tenure leaves them with a
    // load ratio well away from 1.0; that must not sit in the current headline forever.
    const departed = tenure(period, 'S03', '2025-01-06', '2025-06-30', 'S01');
    const report = buildPeriodReport(departed, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);

    const activeRatios = report.doctors
      .filter((doctor) => doctor.membership === 'active' && doctor.ratioConfidence === 'ok')
      .map((doctor) => doctor.loadRatio);
    expect(activeRatios.length).toBeGreaterThan(0);
    expect(activeRatios).not.toContain(null);

    expect(report.practice.caveats).toContainEqual(
      expect.stringContaining('membership is inferred to have ended'),
    );
  });
});

describe('presence share', () => {
  it('flags a recent joiner as low-sample even when the absolute thresholds pass', () => {
    // ⚠️ This is the regression test for a real miss. Before the presence check existed, a doctor
    // who joined ten weeks before the period ended cleared 20 shifts and 60 days and was reported
    // as carrying 30% more than his share, on ten weeks of evidence.
    const joiner = tenure(period, 'S03', '2025-11-01', '2026-01-04', 'S01');
    const report = buildPeriodReport(joiner, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    const s03 = report.doctors.find((doctor) => doctor.doctor === 'S03');

    // Both absolute bars are comfortably cleared.
    expect(s03?.shifts ?? 0).toBeGreaterThan(20);
    expect(s03?.activeDays ?? 0).toBeGreaterThan(60);
    // And it is still not enough to judge them on.
    expect(s03?.presenceShare ?? 1).toBeLessThan(0.5);
    expect(s03?.ratioConfidence).toBe('low-sample');
    expect(s03?.membership).toBe('active');
  });

  it('reports presence as a fraction of the period, so it scales with the window', () => {
    const report = buildPeriodReport(period, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    for (const doctor of report.doctors) {
      expect(doctor.presenceShare).toBeGreaterThan(0.99);
      expect(doctor.presenceShare).toBeLessThanOrEqual(1);
    }
  });

  it('explains the exclusion rather than silently dropping people', () => {
    const joiner = tenure(period, 'S03', '2025-11-01', '2026-01-04', 'S01');
    const report = buildPeriodReport(joiner, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
    expect(report.practice.caveats).toContainEqual(
      expect.stringContaining('A recent joiner will appear here'),
    );
  });
});
