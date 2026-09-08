/**
 * Tests for workforce-change detection.
 *
 * This exists because two constraints in this practice turned out to be artefacts of headcount rather
 * than statements about anyone's habits — H-02 became true when D04 took a slot, and H-07 became four
 * times more true as the roster grew. A verdict computed across such a boundary describes two
 * different practices at once.
 */

import { describe, expect, it } from 'vitest';
import type { Assignment, RosterDay, RosterPeriod } from './types.ts';
import {
  ABSENCE_IS_DEPARTURE_DAYS,
  buildWorkforceTimeline,
  spansWorkforceChange,
} from './workforce.ts';

/** Builds a period with one shift per day, assigned by a caller-supplied function. */
function period(
  from: string,
  days: number,
  assign: (index: number) => string | null,
): RosterPeriod {
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const rosterDays: RosterDay[] = [];
  const assignments: Assignment[] = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    rosterDays.push({ date, patternId: 'A', dayClass: 'weekday' });
    const doctor = assign(index);
    if (doctor !== null) {
      assignments.push({ date, shiftId: 'std-morning', doctor, provenance: 'directed' });
    }
  }
  return { label: 'test', days: rosterDays, assignments };
}

describe('buildWorkforceTimeline', () => {
  it('records a first shift as a join', () => {
    const timeline = buildWorkforceTimeline(period('2025-01-01', 30, () => 'S01'));
    expect(timeline.changes).toEqual([
      { month: '2025-01', kind: 'joined', doctor: 'S01', date: '2025-01-01' },
    ]);
  });

  it('detects a joiner partway through', () => {
    // S02 appears on day 100. That is the shape D04 has in the real data: absent entirely, then
    // present, and a constraint verdict either side of it is not comparable.
    const timeline = buildWorkforceTimeline(
      period('2025-01-01', 200, (index) => (index < 100 ? 'S01' : 'S02')),
    );
    const joins = timeline.changes.filter((change) => change.kind === 'joined');
    expect(joins.map((change) => change.doctor)).toEqual(['S01', 'S02']);
    expect(joins[1]?.date).toBe('2025-04-11');
  });

  it('treats a long trailing absence as a departure', () => {
    // S01 stops on day 20 of a 200-day period. Well past the threshold.
    const timeline = buildWorkforceTimeline(
      period('2025-01-01', 200, (index) => (index < 20 ? 'S01' : 'S02')),
    );
    const left = timeline.changes.filter((change) => change.kind === 'left');
    expect(left).toHaveLength(1);
    expect(left[0]?.doctor).toBe('S01');
    expect(left[0]?.date).toBe('2025-01-20');
  });

  it('does not call an ordinary gap a departure', () => {
    // A doctor working a couple of shifts a month leaves gaps. Writing them off would then require
    // un-writing them off, which is why the threshold is 90 days rather than 30.
    const timeline = buildWorkforceTimeline(
      period('2025-01-01', 200, (index) => (index % 40 === 0 ? 'S01' : 'S02')),
    );
    expect(timeline.changes.filter((change) => change.kind === 'left')).toHaveLength(0);
  });

  it('reads a long mid-history gap as a departure and a return', () => {
    // The honest reading. A roster cannot tell you someone was on unpaid leave, so a 120-day hole
    // is recorded as both, and whoever reads it can decide.
    const timeline = buildWorkforceTimeline(
      period('2025-01-01', 300, (index) => {
        if (index < 20) return 'S01';
        if (index < 160) return 'S02';
        return 'S01';
      }),
    );
    const s01 = timeline.changes.filter((change) => change.doctor === 'S01');
    expect(s01.map((change) => change.kind)).toEqual(['joined', 'left', 'joined']);
  });

  it('reports headcount per month', () => {
    const timeline = buildWorkforceTimeline(
      period('2025-01-01', 60, (index) => (index % 2 === 0 ? 'S01' : 'S02')),
    );
    // 60 days from 1 January reaches 1 March, so three months are touched - not two.
    expect(timeline.headcountByMonth).toEqual([
      { month: '2025-01', headcount: 2 },
      { month: '2025-02', headcount: 2 },
      { month: '2025-03', headcount: 1 },
    ]);
  });
});

describe('spans of stable composition', () => {
  it('splits at a joiner', () => {
    const timeline = buildWorkforceTimeline(
      period('2025-01-01', 200, (index) => (index < 100 ? 'S01' : 'S02')),
    );
    // Two spans: before S02 arrives and after. S01's departure also lands in there.
    expect(timeline.spans.length).toBeGreaterThan(1);
    expect(timeline.spans[0]?.fromMonth).toBe('2025-01');
  });

  it('gives one span when nothing changes', () => {
    const timeline = buildWorkforceTimeline(period('2025-01-01', 90, () => 'S01'));
    expect(timeline.spans).toHaveLength(1);
    // 90 days from 1 January ends on 31 March: three months, not four.
    expect(timeline.spans[0]?.months).toBe(3);
  });
});

describe('spansWorkforceChange', () => {
  const timeline = buildWorkforceTimeline(
    period('2025-01-01', 200, (index) => (index < 100 ? 'S01' : 'S02')),
  );

  it('flags a window that crosses a change', () => {
    // The question a re-verification trigger needs answered: is this verdict describing one
    // practice or several?
    const crossing = spansWorkforceChange(timeline, '2025-01', '2025-07');
    expect(crossing.length).toBeGreaterThan(0);
  });

  it('passes a window inside one span', () => {
    expect(spansWorkforceChange(timeline, '2025-01', '2025-02')).toHaveLength(0);
  });

  it('does not count a change in the window’s own first month', () => {
    // A window starting at a new roster is not a window containing a change - it simply begins
    // after one. Otherwise every window would look contaminated by its own start.
    expect(spansWorkforceChange(timeline, '2025-01', '2025-01')).toHaveLength(0);
  });
});

describe('the threshold', () => {
  it('is the same 90 days the principal confirmed', () => {
    // Not a coincidence and not independent: it is the same number as DEPARTURE_GAP_DAYS, for the
    // same reason. Asserted so a future change to one prompts a look at the other.
    expect(ABSENCE_IS_DEPARTURE_DAYS).toBe(90);
  });
});
