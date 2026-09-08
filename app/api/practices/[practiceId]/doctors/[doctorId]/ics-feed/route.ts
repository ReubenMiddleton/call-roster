import type { PoolClient } from 'pg';
import {
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../../../lib/server/db.ts';
import { generateIcsToken } from '../../../../../../../lib/server/ics.ts';
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';

interface FeedRow {
  token: string;
  sequence: number;
}

async function requireMembership(
  client: PoolClient,
  tenantId: string,
  doctorId: string,
): Promise<boolean> {
  const result = await client.query(
    'select 1 from practice_membership where tenant_id = $1 and doctor_id = $2 limit 1',
    [tenantId, doctorId],
  );
  return result.rows.length > 0;
}

/**
 * `RegenerateIcsToken`, and the initial mint besides -- both are "give this doctor a fresh
 * working link", which is the same operation whether or not one already existed. Revokes any
 * existing active feed first (`ics_feed_one_active_per_doctor`'s partial unique index would
 * refuse a second active row for the same doctor anyway, but revoking explicitly is what makes
 * the old URL actually stop working, which is the entire point of "regenerate").
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string; doctorId: string }> },
): Promise<Response> {
  try {
    const { practiceId, doctorId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const feed = await withTenant(tenantId, async (client) => {
      const isMember = await requireMembership(client, tenantId, doctorId);
      if (!isMember) {
        return undefined;
      }

      await client.query(
        'update ics_feed set revoked_at = now() where tenant_id = $1 and doctor_id = $2 and revoked_at is null',
        [tenantId, doctorId],
      );

      const result = await client.query<FeedRow>(
        `insert into ics_feed (tenant_id, doctor_id, token) values ($1, $2, $3)
         returning token, sequence`,
        [tenantId, doctorId, generateIcsToken()],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('insert into ics_feed returned no row');
      }
      return row;
    });

    if (feed === undefined) {
      throw notFound(`No doctor ${doctorId} in this practice.`);
    }

    return jsonResponse(
      { token: feed.token, path: `/api/ics/${feed.token}`, sequence: feed.sequence },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Revokes the doctor's active feed, if one exists. The URL stops working immediately -- there
 * is no grace period, matching "an ICS URL is a bearer credential" (docs/domain/commands-events.md). */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ practiceId: string; doctorId: string }> },
): Promise<Response> {
  try {
    const { practiceId, doctorId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const revoked = await withTenant(tenantId, async (client) => {
      const result = await client.query(
        `update ics_feed set revoked_at = now()
         where tenant_id = $1 and doctor_id = $2 and revoked_at is null
         returning id`,
        [tenantId, doctorId],
      );
      return result.rows.length > 0;
    });

    if (!revoked) {
      throw notFound(`No active ICS feed for doctor ${doctorId}.`);
    }

    return jsonResponse({ revoked: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
