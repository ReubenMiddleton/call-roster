/**
 * DB-backed burden schedules -- the tenant-scoped replacement for the `AGREED_BURDEN_V2` constant
 * `lib/server/ledger.ts` used to apply to every tenant regardless of who they were. Converts
 * between `burden_schedule`/`burden_rule` rows and the exact `BurdenSchedule`/`BurdenRule`/
 * `BurdenMatch` shapes `lib/analytics/burden.ts` already validates and resolves against -- no
 * burden arithmetic is reimplemented here, only the DB round-trip.
 */

import type { PoolClient } from 'pg';
import type { BurdenMatch, BurdenRule, BurdenSchedule } from '../analytics/burden-types.ts';
import { validateBurdenSchedule } from '../analytics/burden.ts';
import type { DayClass, IsoDate, ShiftKind } from '../analytics/types.ts';
import { badRequest, conflict } from './api-error.ts';

export interface StoredBurdenSchedule extends BurdenSchedule {
  readonly id: string;
}

interface ScheduleRow {
  id: string;
  version: string;
  valid_from: string;
  valid_to: string | null;
  confidence: string;
}

interface RuleRow {
  schedule_id: string;
  label: string;
  day_class: string | null;
  shift_kind: string | null;
  pattern_id: string | null;
  special_date: string | null;
  weekday: number | null;
  from_hour: number | null;
  weight: string;
}

function rowToMatch(row: RuleRow): BurdenMatch {
  return {
    ...(row.day_class === null ? {} : { dayClass: row.day_class as DayClass }),
    ...(row.shift_kind === null ? {} : { shiftKind: row.shift_kind as ShiftKind }),
    ...(row.pattern_id === null ? {} : { patternId: row.pattern_id }),
    ...(row.special_date === null ? {} : { specialDate: row.special_date }),
    ...(row.weekday === null ? {} : { weekday: row.weekday }),
    ...(row.from_hour === null ? {} : { fromHour: row.from_hour }),
  };
}

/** Every schedule version this tenant has ever had, oldest first, each with its ordered rules. */
export async function loadBurdenSchedules(
  client: PoolClient,
  tenantId: string,
): Promise<readonly StoredBurdenSchedule[]> {
  const scheduleResult = await client.query<ScheduleRow>(
    'select id, version, valid_from, valid_to, confidence from burden_schedule where tenant_id = $1 order by valid_from',
    [tenantId],
  );
  const ruleResult = await client.query<RuleRow>(
    `select br.schedule_id, br.label, br.day_class, br.shift_kind, br.pattern_id, br.special_date,
       br.weekday, br.from_hour, br.weight
     from burden_rule br
     where br.tenant_id = $1
     order by br.schedule_id, br.position`,
    [tenantId],
  );

  return scheduleResult.rows.map((schedule) => {
    const rules: BurdenRule[] = ruleResult.rows
      .filter((rule) => rule.schedule_id === schedule.id)
      .map((rule) => ({ label: rule.label, match: rowToMatch(rule), weight: Number(rule.weight) }));
    return {
      id: schedule.id,
      version: schedule.version,
      validFrom: schedule.valid_from,
      ...(schedule.valid_to === null ? {} : { validTo: schedule.valid_to }),
      confidence: schedule.confidence as BurdenSchedule['confidence'],
      rules,
    };
  });
}

/** The schedule version covering one date, or `undefined` if none does. Comparing ISO date
 * strings directly is correct here -- lexicographic order matches chronological order for
 * `YYYY-MM-DD`, the same assumption `lib/calendar/pattern-precedence.ts` makes. */
export function scheduleForDate(
  schedules: readonly BurdenSchedule[],
  date: IsoDate,
): BurdenSchedule | undefined {
  return schedules.find(
    (schedule) =>
      date >= schedule.validFrom && (schedule.validTo === undefined || date < schedule.validTo),
  );
}

export interface CreateBurdenScheduleInput {
  readonly version: string;
  readonly validFrom: IsoDate;
  readonly confidence: BurdenSchedule['confidence'];
  readonly rules: readonly BurdenRule[];
}

/**
 * Creates a new schedule version, closing whichever previous one was still open
 * (`valid_to is null`) at `validFrom` -- "weight changes apply forward only"
 * (docs/domain/fairness.md). A schedule's rules are never edited in place; a correction is a new
 * version, like every other temporal entity in this schema (ADR-0008).
 *
 * Validated with `validateBurdenSchedule` (lib/analytics/burden.ts) before anything is written: a
 * schedule with no catch-all rule, or one where the catch-all isn't last, is rejected here rather
 * than discovered the first time `recalculateLedger` hits a shift it can't price.
 */
export async function createBurdenSchedule(
  client: PoolClient,
  tenantId: string,
  input: CreateBurdenScheduleInput,
): Promise<StoredBurdenSchedule> {
  const candidate: BurdenSchedule = {
    version: input.version,
    validFrom: input.validFrom,
    confidence: input.confidence,
    rules: input.rules,
  };
  const problems = validateBurdenSchedule(candidate);
  if (problems.length > 0) {
    throw badRequest(`Invalid burden schedule: ${problems.join('; ')}`);
  }

  const previousResult = await client.query<{ id: string; valid_from: string }>(
    'select id, valid_from from burden_schedule where tenant_id = $1 and valid_to is null for update',
    [tenantId],
  );
  const previous = previousResult.rows[0];
  if (previous !== undefined) {
    if (input.validFrom <= previous.valid_from) {
      throw conflict(
        `A schedule is already open from ${previous.valid_from}; the new one's validFrom (${input.validFrom}) must be after it.`,
      );
    }
    await client.query('update burden_schedule set valid_to = $1 where id = $2', [
      input.validFrom,
      previous.id,
    ]);
  }

  const scheduleResult = await client.query<{ id: string }>(
    `insert into burden_schedule (tenant_id, version, valid_from, confidence)
     values ($1, $2, $3, $4)
     returning id`,
    [tenantId, input.version, input.validFrom, input.confidence],
  );
  const schedule = scheduleResult.rows[0];
  if (schedule === undefined) {
    throw new Error('insert into burden_schedule returned no row');
  }

  for (const [position, rule] of input.rules.entries()) {
    await client.query(
      `insert into burden_rule
         (tenant_id, schedule_id, position, label, day_class, shift_kind, pattern_id, special_date, weekday, from_hour, weight)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        tenantId,
        schedule.id,
        position,
        rule.label,
        rule.match.dayClass ?? null,
        rule.match.shiftKind ?? null,
        rule.match.patternId ?? null,
        rule.match.specialDate ?? null,
        rule.match.weekday ?? null,
        rule.match.fromHour ?? null,
        rule.weight,
      ],
    );
  }

  return {
    id: schedule.id,
    version: input.version,
    validFrom: input.validFrom,
    confidence: input.confidence,
    rules: input.rules,
  };
}
