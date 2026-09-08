import { z } from 'zod';
import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

// Matches the `kind` check constraint on `pattern_shift` (supabase/migrations/0003_shift_structure.sql).
const SHIFT_KINDS = ['morning', 'afternoon', 'evening', 'night', 'long-day'] as const;

const shiftSchema = z
  .object({
    shiftKey: z.string().trim().min(1).max(50),
    startHour: z.number().int().min(0).max(23),
    hours: z.number().positive().max(24),
    kind: z.enum(SHIFT_KINDS),
  })
  .strict();

const createPatternSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    // "Each [pattern] divides one date's 24 hours into shifts that sum to exactly 24 hours, with
    // exactly one doctor on duty throughout" -- docs/domain/shift-patterns.md. A real domain
    // invariant, not a speculative one: all three patterns in production data satisfy it.
    shifts: z
      .array(shiftSchema)
      .min(1)
      .refine(
        (shifts) => shifts.reduce((sum, shift) => sum + shift.hours, 0) === 24,
        "a pattern's shifts must sum to exactly 24 hours",
      ),
  })
  .strict();

interface PatternRow {
  id: string;
  name: string;
}

interface PatternShiftRow {
  id: string;
  pattern_id: string;
  shift_key: string;
  start_hour: number;
  hours: string;
  kind: string;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const patterns = await withTenant(tenantId, async (client) => {
      const patternResult = await client.query<PatternRow>(
        'select id, name from shift_pattern where tenant_id = $1 order by name',
        [tenantId],
      );
      const shiftResult = await client.query<PatternShiftRow>(
        `select ps.id, ps.pattern_id, ps.shift_key, ps.start_hour, ps.hours, ps.kind
         from pattern_shift ps
         where ps.tenant_id = $1
         order by ps.start_hour`,
        [tenantId],
      );

      return patternResult.rows.map((pattern) => ({
        id: pattern.id,
        name: pattern.name,
        shifts: shiftResult.rows
          .filter((shift) => shift.pattern_id === pattern.id)
          .map((shift) => ({
            id: shift.id,
            shiftKey: shift.shift_key,
            startHour: shift.start_hour,
            hours: Number(shift.hours),
            kind: shift.kind,
          })),
      }));
    });

    return jsonResponse({ shiftPatterns: patterns });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Creates a named pattern and its shifts together -- a pattern with no shifts covers no hours
 * of the day and can never back a real roster, so there is no reason to allow the two-step form. */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const { name, shifts } = createPatternSchema.parse(body);

    const pattern = await withTenant(tenantId, async (client) => {
      const patternResult = await client.query<PatternRow>(
        'insert into shift_pattern (tenant_id, name) values ($1, $2) returning id, name',
        [tenantId, name],
      );
      const patternRow = patternResult.rows[0];
      if (patternRow === undefined) {
        throw new Error('insert into shift_pattern returned no row');
      }

      const insertedShifts = [];
      for (const shift of shifts) {
        const shiftResult = await client.query<{ id: string }>(
          `insert into pattern_shift (tenant_id, pattern_id, shift_key, start_hour, hours, kind)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [tenantId, patternRow.id, shift.shiftKey, shift.startHour, shift.hours, shift.kind],
        );
        const shiftRow = shiftResult.rows[0];
        if (shiftRow === undefined) {
          throw new Error('insert into pattern_shift returned no row');
        }
        insertedShifts.push({ id: shiftRow.id, ...shift });
      }

      return { id: patternRow.id, name: patternRow.name, shifts: insertedShifts };
    });

    return jsonResponse(pattern, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
