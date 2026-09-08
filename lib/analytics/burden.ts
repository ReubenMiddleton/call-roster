/**
 * Burden weights: what one shift costs the person who works it.
 *
 * **The weights are data, and the numbers in this file are now `[CONFIRMED]`** — approved by the
 * practice principal on 31 August 2026. Everything downstream (the ledger, the equity metrics, the
 * solver objective) stays parameterised by a schedule, so the next practice supplies its own and a
 * revision here is a versioned data change rather than a code change.
 *
 * Two design rules that matter more than the values:
 *
 * 1. **A schedule is versioned with a validity interval.** Historical credits keep the weight
 *    that was in force when they were earned. Recalculating history under new weights silently
 *    rewrites who owed what, which is the fastest way to lose the ledger's credibility.
 * 2. **Resolution is an ordered, most-specific-first rule list**, not a lookup. That makes the
 *    combination rules explicit and inspectable, which a nested table does not.
 */

import type { BurdenRule, BurdenSchedule } from './burden-types.ts';
import { dayOfWeek } from './shifts.ts';
import type { RosterDay, ShiftDefinition } from './types.ts';

export type { BurdenRule, BurdenSchedule } from './burden-types.ts';

/**
 * The practice's agreed weight table. `[CONFIRMED 2026-09-04]` — **question 35 is answered**, and
 * these are the principal's own numbers rather than anyone's placeholders.
 *
 * ## What changed from v1, and why v1 is gone rather than retained
 *
 * | | v1 (assumed) | **v2 (his numbers)** |
 * |---|---|---|
 * | Weekday 07:00–15:00 | 1.0 | 1.0 |
 * | **Weekday from 15:00** | *(1.0, unnamed)* | **1.75** |
 * | Weekday night | 2.5 | 2.5 |
 * | **Friday from 17:00** | *(none — priced as a weekday)* | **3.0** |
 * | Saturday | 3.0 | 3.0 |
 * | **Sunday** | 3.5 | **3.0** |
 * | **Public holiday** | 5.0 | **4.0** |
 * | **Christmas / New Year's Eve night** | 8.0 | **6.0** |
 * | Long day 07:00–17:00 | 1.5 | 1.5 |
 *
 * `fairness.md` says weights are versioned so that **historical credits stay at the weight in force
 * when they were earned** — recalculating history under new weights silently rewrites who owed what.
 * That rule is right and it does not bite here: **v1 was never operative.** No roster was published
 * under it, no credit was ever shown to a doctor, and the numbers were placeholders the principal
 * had approved only as "fair" in the abstract. Retaining v1 as a historical band would preserve a
 * fiction. **The next change will need a real second version**, and the `validFrom` field is why
 * that will be a data change rather than a migration.
 *
 * Three things his answers settle:
 *
 * - **Question S is answered, and the earlier reading was wrong.** A weekday 15:00–23:00 is *harder*
 *   than a 07:00–15:00 — *"they should be bumped up from 1.0, he reckons about a 1.75."* v1 priced
 *   them identically. Sunday and Saturday, by contrast, he levelled at 3.0.
 * - **Question W is answered.** Friday from 17:00 is weekend work and prices with Saturday and
 *   Sunday at 3.0. This moves roughly 120 shifts up a band.
 * - **Saturday and Sunday still outrank a public holiday** — a holiday on a Saturday *"counts once
 *   as a Saturday"*, and at 4.0 versus 3.0 the holiday rule now wins on a weekday holiday while
 *   `classifyDay` keeps the weekend precedence. No rule here needs to know about that.
 *
 * ⚠️ **Pattern B's front half is still unpriced.** `fri-early` (07:00–12:00) and `fri-midday`
 * (12:00–17:00) fall through to the 1.0 floor, because his answer was about the 15:00–23:00 shift
 * and `fri-midday` starts at 12:00. Not guessed — a 12:00–17:00 is not the shift he priced. Logged.
 *
 * ⚠️ **He also noted the practice already pays public holidays at a higher rate**, so a monetary
 * fairness mechanism exists alongside this one. Worth knowing before presenting burden as *the*
 * measure of fairness to the group.
 */
export const AGREED_BURDEN_V2: BurdenSchedule = {
  version: 'agreed-v2',
  validFrom: '2025-01-01',
  confidence: 'CONFIRMED',
  rules: [
    // Named special dates first. Nothing outranks Christmas night.
    // Both are scoped to the night shift: Christmas *night* is the hardest slot in the year,
    // Christmas morning is an ordinary public holiday. A day-level match alone would price the
    // 07:00 shift at 6.0 as well.
    {
      label: 'Christmas night',
      match: { specialDate: 'christmas', shiftKind: 'night' },
      weight: 6,
    },
    {
      label: "New Year's Eve night",
      match: { specialDate: 'new-years-eve', shiftKind: 'night' },
      weight: 6,
    },

    // Then the calendar classes, which already outrank the shift kind in this table.
    { label: 'public holiday', match: { dayClass: 'public-holiday' }, weight: 4 },
    { label: 'Sunday', match: { dayClass: 'sunday' }, weight: 3 },
    { label: 'Saturday', match: { dayClass: 'saturday' }, weight: 3 },

    // ⚠️ Friday's back half is weekend work, and must sit ABOVE `weekday night` — otherwise a
    // Friday 23:00 would price at 2.5 rather than 3.0. It sits BELOW the calendar classes so a
    // public-holiday Friday still prices as a holiday.
    //
    // Matched on weekday + start hour rather than `patternId: 'B'`, because a Friday that is a
    // public holiday runs Pattern C and a Friday is a Friday either way.
    { label: 'Friday from 17:00', match: { weekday: 5, fromHour: 17 }, weight: 3 },

    // Then weekday shift kinds, most burdensome first.
    { label: 'weekday night', match: { dayClass: 'weekday', shiftKind: 'night' }, weight: 2.5 },

    // ⚠️ Matched on `fromHour: 15`, NOT on `shiftKind: 'afternoon'`. The principal's answer was
    // about the 15:00–23:00 shift specifically, and `afternoon` would also catch `fri-midday`
    // (12:00–17:00), which he did not price and which is not the same shift at all.
    { label: 'weekday from 15:00', match: { dayClass: 'weekday', fromHour: 15 }, weight: 1.75 },

    {
      label: 'reduced-day long day',
      match: { dayClass: 'weekday', shiftKind: 'long-day' },
      weight: 1.5,
    },

    // The floor: an ordinary weekday daytime shift.
    { label: 'weekday daytime', match: {}, weight: 1 },
  ],
};

interface ResolvedBurden {
  readonly weight: number;
  /** Which rule fired. Carried through so every number in a report can be explained. */
  readonly rule: string;
}

/**
 * Resolves the burden weight for one assignment.
 *
 * Returns the matching rule's label alongside the weight because the ledger's whole value is
 * explainability: *"that Sunday cost you 3.5 because it is a Sunday"* is the sentence a doctor
 * accepts, and it cannot be produced after the fact from the number alone.
 */
export function resolveBurden(
  day: RosterDay,
  shift: ShiftDefinition,
  schedule: BurdenSchedule,
): ResolvedBurden {
  for (const rule of schedule.rules) {
    if (matches(rule, day, shift)) {
      return { weight: rule.weight, rule: rule.label };
    }
  }
  // A schedule with no catch-all is a configuration error, not a runtime condition to absorb.
  // Silently returning 0 would make an entire month's burden vanish from the ledger.
  throw new Error(
    `burden schedule "${schedule.version}" has no rule matching ${day.dayClass}/${shift.kind}; add a catch-all rule`,
  );
}

function matches(rule: BurdenRule, day: RosterDay, shift: ShiftDefinition): boolean {
  const { match } = rule;
  if (match.specialDate !== undefined && match.specialDate !== day.specialDate) {
    return false;
  }
  if (match.dayClass !== undefined && match.dayClass !== day.dayClass) {
    return false;
  }
  if (match.shiftKind !== undefined && match.shiftKind !== shift.kind) {
    return false;
  }
  if (match.patternId !== undefined && match.patternId !== shift.patternId) {
    return false;
  }
  // Weekday and hour follow the date and the shift, not the pattern - see BurdenMatch.
  if (match.weekday !== undefined && match.weekday !== dayOfWeek(day.date)) {
    return false;
  }
  if (match.fromHour !== undefined && shift.startHour < match.fromHour) {
    return false;
  }
  return true;
}

/**
 * Checks a schedule is usable before it is applied to anything.
 *
 * Returns a list of problems rather than throwing, so a settings screen can show all of them at
 * once instead of one per save.
 */
export function validateBurdenSchedule(schedule: BurdenSchedule): readonly string[] {
  const problems: string[] = [];

  if (schedule.rules.length === 0) {
    problems.push('schedule has no rules');
  }

  const hasCatchAll = schedule.rules.some((rule) => Object.keys(rule.match).length === 0);
  if (!hasCatchAll) {
    problems.push('schedule has no catch-all rule, so some shifts would have no weight');
  }

  for (const [index, rule] of schedule.rules.entries()) {
    if (!Number.isFinite(rule.weight) || rule.weight < 0) {
      problems.push(`rule ${String(index)} ("${rule.label}") has a non-finite or negative weight`);
    }
    // A weekday of 7 or an hour of 24 would simply never match, which is worse than an error:
    // the schedule would look correct and quietly price those shifts at the catch-all.
    const { weekday, fromHour } = rule.match;
    if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
      problems.push(
        `rule ${String(index)} ("${rule.label}") has weekday ${String(weekday)}; must be 0-6`,
      );
    }
    if (fromHour !== undefined && (!Number.isInteger(fromHour) || fromHour < 0 || fromHour > 23)) {
      problems.push(
        `rule ${String(index)} ("${rule.label}") has fromHour ${String(fromHour)}; must be 0-23`,
      );
    }
  }

  // A catch-all above a specific rule makes the specific rule dead. That is a silent
  // misconfiguration: the schedule looks right and prices everything at the floor.
  const catchAllIndex = schedule.rules.findIndex((rule) => Object.keys(rule.match).length === 0);
  if (catchAllIndex >= 0 && catchAllIndex < schedule.rules.length - 1) {
    problems.push(
      `the catch-all rule is at position ${String(catchAllIndex)} of ${String(schedule.rules.length)}; every rule after it is unreachable`,
    );
  }

  if (schedule.validTo !== undefined && schedule.validTo < schedule.validFrom) {
    problems.push('validTo is before validFrom');
  }

  return problems;
}
