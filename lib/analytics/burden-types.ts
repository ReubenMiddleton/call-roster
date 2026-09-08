/**
 * Types for the burden schedule, split from `burden.ts` so that a caller who only needs the
 * shape (a settings form, a migration, a JSON validator) does not pull in the illustrative table
 * and mistake it for a default.
 */

import type { DayClass, IsoDate, PatternId, ShiftKind } from './types.ts';

/**
 * What a burden rule matches on. An empty object matches everything — the catch-all.
 *
 * `weekday` and `fromHour` were added on 1 September 2026 after an audit found the schedule could
 * not express the one rule the practice is most likely to ask for next: **"a Friday from 17:00
 * counts as weekend work"** (question W).
 *
 * `patternId: 'B'` looked like it would do the job, because Pattern B is the Friday pattern. It does
 * not: a Friday that is a public holiday runs **Pattern C**, whose `red-evening` is *also*
 * 17:00–23:00 on that Friday. A pattern-keyed rule would price Good Friday evening as a weekday and
 * every other Friday evening as a weekend, which is the kind of inconsistency nobody would notice
 * until a doctor did.
 *
 * Matching on the weekday and the hour is what the practice actually means, so that is what the
 * schedule now expresses — and the answer to W becomes a data change rather than a code change,
 * which was the whole point of a rule list.
 */
export interface BurdenMatch {
  readonly dayClass?: DayClass;
  readonly shiftKind?: ShiftKind;
  readonly patternId?: PatternId;
  /** A named date such as `christmas`. Matched exactly, and combined with `shiftKind`. */
  readonly specialDate?: string;
  /**
   * Day of week, 0 = Sunday … 6 = Saturday.
   *
   * Independent of `patternId` and of `dayClass` on purpose — a Friday is a Friday whether it runs
   * Pattern B, Pattern C, or is a public holiday.
   */
  readonly weekday?: number;
  /**
   * Matches a shift starting at or after this hour, 0–23.
   *
   * Compared against the shift's own `startHour`, so it follows the shift rather than the pattern
   * it belongs to.
   */
  readonly fromHour?: number;
}

/** One entry in an ordered, most-specific-first weight table. */
export interface BurdenRule {
  /** Shown to users when explaining a credit. Write it as a noun phrase: "public holiday". */
  readonly label: string;
  readonly match: BurdenMatch;
  readonly weight: number;
}

/**
 * A versioned set of burden weights with a validity interval.
 *
 * `validTo` absent means "still in force". Temporal intervals rather than an `is_active` flag,
 * consistent with ADR-0008 and for the same reason: the ledger must be able to answer *"what was
 * a Sunday worth in March 2025"* years after the weights changed.
 */
export interface BurdenSchedule {
  readonly version: string;
  readonly validFrom: IsoDate;
  readonly validTo?: IsoDate;
  /**
   * How much the practice has actually agreed to these numbers. A report built on an `ASSUMED`
   * schedule must say so on its face; see `docs/domain/constraints.md` on confidence tags.
   */
  readonly confidence: 'CONFIRMED' | 'INFERRED' | 'ASSUMED';
  readonly rules: readonly BurdenRule[];
}
