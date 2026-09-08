import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jsonResponse, toErrorResponse } from '../../../lib/server/api-error.ts';
import { withAppUser } from '../../../lib/server/db.ts';

const createPracticeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
  })
  .strict();

interface PracticeRow {
  id: string;
  name: string;
  created_at: Date;
}

/**
 * Creates a practice (tenant). Bootstrapping: there is no tenant to scope to until the row
 * exists, so this is the one write in the API that isn't behind `x-tenant-id` -- `practice`'s
 * own RLS insert policy is deliberately `with check (true)` for exactly this reason
 * (`supabase/migrations/0002_practice_and_people.sql`). Tenant provisioning during the pilot is
 * meant to be this cheap (ADR-0010).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const { name } = createPracticeSchema.parse(body);

    const practice = await withAppUser(async (client) => {
      // `practice`'s SELECT policy is `id = app_current_tenant_id()` (ADR-0007) -- there is no
      // tenant context yet at creation time, so `INSERT ... RETURNING` would fail even though
      // the insert itself is allowed: RETURNING must also satisfy the SELECT policy on the new
      // row. Generating the id here lets us adopt it as this transaction's tenant context right
      // after inserting, so the read-back that follows is a normal, policy-satisfying read.
      const id = randomUUID();
      await client.query('insert into practice (id, name) values ($1, $2)', [id, name]);
      await client.query("select set_config('app.tenant_id', $1, true)", [id]);
      const result = await client.query<PracticeRow>(
        'select id, name, created_at from practice where id = $1',
        [id],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('insert into practice returned no row');
      }
      return row;
    });

    return jsonResponse(
      { id: practice.id, name: practice.name, createdAt: practice.created_at.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
