import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createDoctorSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    validFrom: z.string().regex(ISO_DATE_RE, 'validFrom must be an ISO date (YYYY-MM-DD)'),
    // Open-ended on purpose: a doctor with no known departure date is the common case, not the
    // exception -- ADR-0008's temporal model represents that as an unbounded upper range.
    validTo: z.string().regex(ISO_DATE_RE, 'validTo must be an ISO date (YYYY-MM-DD)').optional(),
  })
  .strict();

interface DoctorRow {
  id: string;
  full_name: string;
  valid_from: string;
  valid_to: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const doctors = await withTenant(tenantId, async (client) => {
      const result = await client.query<DoctorRow>(
        `select p.id, p.full_name, lower(pm.valid_at) as valid_from, upper(pm.valid_at) as valid_to
         from practice_membership pm
         join person p on p.id = pm.doctor_id
         where pm.tenant_id = $1
         order by p.full_name`,
        [tenantId],
      );
      return result.rows;
    });

    return jsonResponse({
      doctors: doctors.map((doctor) => ({
        id: doctor.id,
        fullName: doctor.full_name,
        validFrom: doctor.valid_from,
        validTo: doctor.valid_to,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Creates a person and their first `practice_membership` in one transaction -- `person` is
 * deliberately not tenant-scoped (ADR-0007), so a bare person row with no membership is
 * invisible to every tenant, including the one that just created it. Doing both writes in one
 * `withTenant` call is what makes that safe rather than a race.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const { fullName, validFrom, validTo } = createDoctorSchema.parse(body);

    const doctor = await withTenant(tenantId, async (client) => {
      // `person`'s SELECT policy requires an existing practice_membership row (ADR-0007) -- at
      // the moment of creation none exists yet, so `INSERT ... RETURNING` would fail the same
      // way practice creation's did. Generating the id up front avoids needing to read it back
      // at all; the membership insert that follows is what makes the person visible from now on.
      const doctorId = randomUUID();
      await client.query('insert into person (id, full_name) values ($1, $2)', [
        doctorId,
        fullName,
      ]);

      await client.query(
        `insert into practice_membership (tenant_id, doctor_id, valid_at)
         values ($1, $2, daterange($3, $4, '[]'))`,
        [tenantId, doctorId, validFrom, validTo ?? null],
      );

      return { id: doctorId, fullName, validFrom, validTo: validTo ?? null };
    });

    return jsonResponse(doctor, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
