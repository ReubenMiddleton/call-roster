import { z } from 'zod';
import type { BurdenMatch, BurdenRule } from '../../../../../lib/analytics/burden-types.ts';
import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import {
  createBurdenSchedule,
  loadBurdenSchedules,
} from '../../../../../lib/server/burden-schedule.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_CLASSES = ['weekday', 'saturday', 'sunday', 'public-holiday'] as const;
const SHIFT_KINDS = ['morning', 'afternoon', 'evening', 'night', 'long-day'] as const;

// Mirrors `BurdenMatch` in lib/analytics/burden-types.ts exactly -- every field optional, and
// absence (not `null`) is what "this rule doesn't care about this dimension" means, both here
// and in the matcher `resolveBurden` runs against it.
const burdenMatchSchema = z
  .object({
    dayClass: z.enum(DAY_CLASSES).optional(),
    shiftKind: z.enum(SHIFT_KINDS).optional(),
    patternId: z.string().min(1).optional(),
    specialDate: z.string().min(1).max(50).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    fromHour: z.number().int().min(0).max(23).optional(),
  })
  .strict();

const burdenRuleSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    match: burdenMatchSchema,
    weight: z.number().min(0),
  })
  .strict();

const createBurdenScheduleSchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    validFrom: z.string().regex(ISO_DATE_RE, 'validFrom must be an ISO date (YYYY-MM-DD)'),
    confidence: z.enum(['CONFIRMED', 'INFERRED', 'ASSUMED']),
    // Most-specific-first, ending in a catch-all ({} match) -- `validateBurdenSchedule`
    // (lib/analytics/burden.ts) enforces this against the actual submitted rules, not just their
    // shape, so it isn't duplicated here as a second, potentially-drifting Zod refinement.
    rules: z.array(burdenRuleSchema).min(1),
  })
  .strict();

// Zod's `.optional()` types a field as `T | undefined`, which doesn't satisfy
// `exactOptionalPropertyTypes`'s stricter "absent or T, never present-and-undefined" reading of
// `BurdenMatch`'s own optional fields -- rebuilding each match with the same conditional-spread
// pattern used elsewhere in this codebase (e.g. `roster-detail.ts`) closes that gap, even though
// the runtime values were already correct.
function toBurdenMatch(match: z.infer<typeof burdenMatchSchema>): BurdenMatch {
  return {
    ...(match.dayClass === undefined ? {} : { dayClass: match.dayClass }),
    ...(match.shiftKind === undefined ? {} : { shiftKind: match.shiftKind }),
    ...(match.patternId === undefined ? {} : { patternId: match.patternId }),
    ...(match.specialDate === undefined ? {} : { specialDate: match.specialDate }),
    ...(match.weekday === undefined ? {} : { weekday: match.weekday }),
    ...(match.fromHour === undefined ? {} : { fromHour: match.fromHour }),
  };
}

function toBurdenRules(
  rules: z.infer<typeof createBurdenScheduleSchema>['rules'],
): readonly BurdenRule[] {
  return rules.map((rule) => ({
    label: rule.label,
    match: toBurdenMatch(rule.match),
    weight: rule.weight,
  }));
}

/**
 * `GET`: every schedule version this tenant has ever created, oldest first, each with an `active`
 * flag (`validTo` still unset). `POST`: creates the next version -- see
 * `lib/server/burden-schedule.ts` for validation and how the previous open version gets closed.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const schedules = await withTenant(tenantId, (client) => loadBurdenSchedules(client, tenantId));

    return jsonResponse({
      burdenSchedules: schedules.map((schedule) => ({
        id: schedule.id,
        version: schedule.version,
        validFrom: schedule.validFrom,
        validTo: schedule.validTo ?? null,
        active: schedule.validTo === undefined,
        confidence: schedule.confidence,
        rules: schedule.rules,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const parsed = createBurdenScheduleSchema.parse(body);

    const schedule = await withTenant(tenantId, (client) =>
      createBurdenSchedule(client, tenantId, {
        version: parsed.version,
        validFrom: parsed.validFrom,
        confidence: parsed.confidence,
        rules: toBurdenRules(parsed.rules),
      }),
    );

    return jsonResponse(
      {
        id: schedule.id,
        version: schedule.version,
        validFrom: schedule.validFrom,
        validTo: schedule.validTo ?? null,
        confidence: schedule.confidence,
        rules: schedule.rules,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
