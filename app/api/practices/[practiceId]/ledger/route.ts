import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

interface LedgerRow {
  doctor_id: string;
  doctor_name: string;
  shifts: string;
  burden: string;
}

/**
 * The persisted ledger, aggregated per doctor from `burden_credit` -- raw totals only. Load
 * ratios need the full opportunity-set computation (`entitlementWeights`,
 * `revealed-opportunity` basis), which is only computed as part of a `POST .../recalculate` run;
 * this endpoint is the cheap "what's currently on the books" read, not a live recomputation.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<LedgerRow>(
        `select bc.doctor_id, p.full_name as doctor_name, count(*) as shifts, sum(bc.weight_used) as burden
         from burden_credit bc
         join person p on p.id = bc.doctor_id
         where bc.tenant_id = $1
         group by bc.doctor_id, p.full_name
         order by sum(bc.weight_used) desc`,
        [tenantId],
      );
      return result.rows;
    });

    return jsonResponse({
      entries: rows.map((row) => ({
        doctorId: row.doctor_id,
        doctorName: row.doctor_name,
        shifts: Number(row.shifts),
        burden: Number(row.burden),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
