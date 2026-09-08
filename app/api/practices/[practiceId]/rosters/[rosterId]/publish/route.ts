import { z } from 'zod';
import {
  conflict,
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../../../lib/server/api-error.ts';
import {
  journalRefusal,
  writeCommandJournal,
} from '../../../../../../../lib/server/command-journal.ts';
import { withTenant } from '../../../../../../../lib/server/db.ts';
import { readJsonBody } from '../../../../../../../lib/server/json-body.ts';
import { tryRecalculateLedger } from '../../../../../../../lib/server/ledger-refresh.ts';
import { enqueueRosterPublishedNotifications } from '../../../../../../../lib/server/notifications.ts';
import { fetchRosterDetail } from '../../../../../../../lib/server/roster-detail.ts';
import { createRosterVersion } from '../../../../../../../lib/server/roster-version.ts';
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';

const publishSchema = z.object({ actorId: z.string().min(1).optional() }).strict();

/**
 * `PublishRoster`: `DRAFT` → `PUBLISHED`. "An event, not a save"
 * (docs/domain/commands-events.md) — it writes an immutable, hash-chained `roster_version`
 * snapshot before flipping the status, and from that point on the roster is invisible to direct
 * edits (`assignments/route.ts`, `rosters/[rosterId]/slots/route.ts` both refuse to touch a
 * non-`draft` roster). It also enqueues a `RosterPublished` notification for every doctor with
 * active membership that month (`lib/server/notifications.ts`) — recorded, not delivered; nothing
 * can send WhatsApp yet. Also triggers a best-effort ledger recalculation
 * (`lib/server/ledger-refresh.ts`) once the publish itself has committed — publishing is the
 * moment assignments move out of `draft` and become eligible for `burden_credit`, so it is exactly
 * when the ledger picture changes. Never blocks the publish: a tenant with no burden schedule
 * configured yet still gets `published`, just with `ledger.recalculated: false` and why. **Not
 * done**: activating ICS feeds (minting one is a separate, doctor-initiated action —
 * `doctors/[doctorId]/ics-feed`, never automatic) or minting a read-only share link, which nothing
 * in this API has a concept of yet.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string; rosterId: string }> },
): Promise<Response> {
  // Hoisted so the catch block below can journal a refusal -- a `const` inside `try` isn't
  // visible there, and each is only as complete as the code got before throwing.
  let journalContext: { tenantId?: string; rosterId?: string; actorId: string | null } = {
    actorId: null,
  };
  try {
    const { practiceId, rosterId } = await context.params;
    journalContext = { ...journalContext, rosterId };
    const tenantId = requireTenantForPractice(request, practiceId);
    journalContext = { ...journalContext, tenantId };
    const { actorId } = publishSchema.parse(await readJsonBody(request));
    journalContext = { ...journalContext, actorId: actorId ?? null };

    const outcome = await withTenant(tenantId, async (client) => {
      // Locks the row for the transaction so two concurrent publishes of the same roster can't
      // both see 'draft' and both try to write version 1.
      const statusResult = await client.query<{ status: string; month: string }>(
        'select status, month from roster where id = $1 and tenant_id = $2 for update',
        [rosterId, tenantId],
      );
      const statusRow = statusResult.rows[0];
      if (statusRow === undefined) {
        return undefined;
      }
      if (statusRow.status !== 'draft') {
        throw conflict(
          `Cannot publish a roster with status '${statusRow.status}'; only a draft can be published.`,
        );
      }

      const snapshot = await fetchRosterDetail(client, tenantId, rosterId);
      if (snapshot === undefined) {
        throw new Error(`roster ${rosterId} vanished mid-transaction`);
      }

      const created = await createRosterVersion(
        client,
        tenantId,
        rosterId,
        snapshot,
        actorId ?? null,
      );
      await client.query("update roster set status = 'published' where id = $1", [rosterId]);
      await writeCommandJournal(client, {
        tenantId,
        actorId: actorId ?? null,
        commandType: 'PublishRoster',
        rosterId,
        rosterVersion: created.versionNumber,
        before: { status: 'draft' },
        after: { status: 'published', versionNumber: created.versionNumber },
      });
      const notified = await enqueueRosterPublishedNotifications(
        client,
        tenantId,
        rosterId,
        statusRow.month,
      );

      return { version: created, notified };
    });

    if (outcome === undefined) {
      throw notFound(`No roster ${rosterId}.`);
    }

    const ledger = await tryRecalculateLedger(tenantId);

    return jsonResponse({
      status: 'published',
      version: outcome.version,
      doctorsNotified: outcome.notified,
      ledger,
    });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'PublishRoster',
      journalContext.actorId,
      journalContext.rosterId ?? null,
      error,
    );
    return toErrorResponse(error, {
      tenantId: journalContext.tenantId,
      route: new URL(request.url).pathname,
    });
  }
}
