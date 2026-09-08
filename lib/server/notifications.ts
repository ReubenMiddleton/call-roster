/**
 * The notification outbox. "When RosterPublished -> notify every doctor on their chosen
 * channel" and "When SwapApproved -> notify both doctors" (docs/domain/commands-events.md).
 *
 * ⚠️ Nothing sends these yet. WhatsApp business verification is deferred until after the pilot
 * (Track B6, docs/NEEDS_YOUR_INPUT.md) -- every row this module writes sits at `status: 'pending'`
 * forever until a real sender exists. Recording the outbox now is the seam ADR-0010 asks for:
 * every place a notification *should* fire already fires one, so wiring up delivery later is a
 * new consumer of this table, not a hunt through the codebase for the right call sites.
 */

import type { PoolClient } from 'pg';

export type NotificationEventType = 'RosterPublished' | 'SwapApproved';

interface EnqueueNotificationInput {
  readonly tenantId: string;
  readonly doctorId: string;
  readonly eventType: NotificationEventType;
  readonly payload: unknown;
}

export async function enqueueNotification(
  client: PoolClient,
  input: EnqueueNotificationInput,
): Promise<void> {
  await client.query(
    `insert into notification (tenant_id, doctor_id, event_type, payload)
     values ($1, $2, $3, $4)`,
    [input.tenantId, input.doctorId, input.eventType, JSON.stringify(input.payload)],
  );
}

interface MemberRow {
  doctor_id: string;
}

/**
 * "Notify every doctor" on publish -- every doctor read literally, not only those with a shift
 * this month: the point is *"check your row,"* and a doctor with nothing assigned still needs to
 * know a new roster exists. Scoped to active membership on the roster's month, so a departed
 * doctor doesn't get notified about a roster that postdates them.
 */
export async function enqueueRosterPublishedNotifications(
  client: PoolClient,
  tenantId: string,
  rosterId: string,
  month: string,
): Promise<number> {
  const monthStart = `${month}-01`;
  const memberResult = await client.query<MemberRow>(
    `select distinct doctor_id
     from practice_membership
     where tenant_id = $1
       and valid_at @> $2::date`,
    [tenantId, monthStart],
  );

  for (const member of memberResult.rows) {
    await enqueueNotification(client, {
      tenantId,
      doctorId: member.doctor_id,
      eventType: 'RosterPublished',
      payload: { rosterId, month },
    });
  }
  return memberResult.rows.length;
}
