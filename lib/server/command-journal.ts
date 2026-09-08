/**
 * The L1 command journal (`docs/ops/diagnostics.md`) -- the append-only record of every user
 * intent, and simultaneously the ECTA s15(4) audit trail `docs/ops/compliance.md` requires. One
 * mechanism, two purposes, by design: *"This journal IS the append-only audit trail ... Do not
 * build a second one."* Replaces the earlier `audit_log`/`writeAuditLog` (renamed in place,
 * `supabase/migrations/0009_command_journal.sql` -- see `docs/DECISIONS.md`).
 *
 * L0's redaction-by-construction lives here: `before`/`after` hold entity references (uuids,
 * dates, shift/pattern ids), never a display name -- a name exists in exactly one table
 * (`person`) and is joined at render time, never copied into this journal.
 * `scripts/check-diagnostics-safety.ts` is the gate that keeps this honest.
 *
 * `occurred_at`/`issued_at` is left to the column's own `default now()` deliberately: server-side
 * time, never a client clock, is the stated rule, and the surest way to honour it is to never
 * accept a timestamp as an argument here for it at all.
 */

import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, pgErrorCode } from './api-error.ts';
import { withTenant } from './db.ts';

/**
 * Matches `docs/domain/commands-events.md`'s command vocabulary, restricted to the commands that
 * actually have a route handler today. Extend this union, not a bare string, when a new command
 * starts journaling -- `command_journal.command_type` is deliberately unconstrained `text` in the
 * database for exactly this reason (see the migration's own comment).
 */
export type CommandType =
  | 'PublishRoster'
  | 'UnpublishRoster'
  | 'CloseReviewWindow'
  | 'ArchiveRoster'
  | 'AssignDoctorToSlot'
  | 'ClearAssignment'
  | 'RequestSwap'
  | 'ApproveSwap'
  | 'RejectSwap';

/** "applied / refused / failed, plus the constraint IDs involved on a refusal" (diagnostics.md).
 * All seven routes journal all three -- `applied` from the route body itself, `refused`/`failed`
 * from `journalRefusal` in each route's `catch` block, classified by `classifyOutcome` below. */
export type CommandOutcome = 'applied' | 'refused' | 'failed';

export interface CommandJournalEntry {
  readonly tenantId: string;
  /** ⚠️ Pre-auth placeholder, like `x-tenant-id` (`lib/server/tenant-context.ts`) -- there is no
   * session to attribute a mutation to yet. Null means genuinely unknown, not "the system". */
  readonly actorId: string | null;
  /** Imperative, matching the command vocabulary -- `'PublishRoster'`, not `'roster.published'`. */
  readonly commandType: CommandType;
  readonly outcome?: CommandOutcome;
  /** Entity references only -- codes, dates, shift ids. Never a display name: see the module
   * docblock and `scripts/check-diagnostics-safety.ts`. */
  readonly before?: unknown;
  readonly after?: unknown;
  /** The one sanctioned free-text field, in two uses -- see the migration's column comment. On
   * an `applied` row: product-supplied administrative text (ECTA s15(4)). On a `refused`/`failed`
   * row (`journalRefusal`, below): the system's own deterministic explanation, never user-typed. */
  readonly reason?: string | null;
  readonly rosterId?: string | null;
  readonly rosterVersion?: number | null;
  /** Client-supplied correlation fields, present once a real browser client exists (`app/` is
   * still a scaffold today) -- `undefined`/absent is the honest, current state of every call site
   * in this API, not a placeholder bug. */
  readonly appRunId?: string | null;
  readonly clientAt?: string | null;
  readonly appVersion?: string | null;
  readonly schemaVersion?: string | null;
}

/**
 * Computes the next `seq` for an `appRunId` by reading the current max within the same
 * transaction -- correct for the one caller pattern that exists today (a single command per
 * transaction, no real concurrent client yet). ⚠️ Not safe against two transactions racing to
 * journal the same `appRunId` concurrently -- deferred rather than solved with an advisory lock
 * or a sequence object nobody can exercise yet, since every call site today passes no `appRunId`
 * at all (`app/` is still a scaffold). The unique index on `(app_run_id, seq)`
 * (the migration) turns a race into a loud constraint violation rather than silent corruption,
 * which is the safe failure mode until a real client makes this worth building properly.
 */
async function nextSeq(client: PoolClient, appRunId: string): Promise<number> {
  const result = await client.query<{ next_seq: number }>(
    'select coalesce(max(seq), 0) + 1 as next_seq from command_journal where app_run_id = $1',
    [appRunId],
  );
  const row = result.rows[0];
  return row?.next_seq ?? 1;
}

export async function writeCommandJournal(
  client: PoolClient,
  entry: CommandJournalEntry,
): Promise<void> {
  const seq =
    entry.appRunId === undefined || entry.appRunId === null
      ? null
      : await nextSeq(client, entry.appRunId);

  await client.query(
    `insert into command_journal
       (tenant_id, app_run_id, seq, roster_id, roster_version, actor_id, command_type, before,
        after, outcome, reason, client_at, app_version, schema_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      entry.tenantId,
      entry.appRunId ?? null,
      seq,
      entry.rosterId ?? null,
      entry.rosterVersion ?? null,
      entry.actorId,
      entry.commandType,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.outcome ?? 'applied',
      entry.reason ?? null,
      entry.clientAt ?? null,
      entry.appVersion ?? null,
      entry.schemaVersion ?? null,
    ],
  );
}

interface ClassifiedOutcome {
  readonly outcome: Extract<CommandOutcome, 'refused' | 'failed'>;
  readonly reason: string;
}

/**
 * Turns whatever a route's `catch` block caught into a journal-worthy verdict, or `null` when
 * there is nothing worth recording. Two things are deliberately **not** journaled:
 *
 * - **404 `not_found`.** There is no entity to attribute the attempt to -- `rosterId` in the
 *   journal is a reference, and a reference to nothing is noise, not a diagnosis.
 * - **A `ZodError`.** Malformed input (a missing field, a bad enum value) is not an intent
 *   against a real entity; the client-side validation this will eventually have is the fix for
 *   it, not a journal row.
 *
 * `refused` covers every *named* business rule this schema knows how to reject something for --
 * an `ApiError` (400/409) built by a route with `badRequest`/`conflict`, or the two SQLSTATEs
 * that are domain constraints rather than accidents: `23P01` (the exclusion constraint --
 * overlapping shift) and `23514` (H-03 -- outside the doctor's membership interval). `failed`
 * is everything else: a unique or foreign-key violation Postgres caught that the application
 * itself did not anticipate, or a genuinely unexpected exception. The `reason` for an `ApiError`
 * is its own message -- already the specific, human-readable "why", written once at the throw
 * site; reusing it here is the only way to get a real reason without re-deriving one.
 */
function classifyOutcome(error: unknown): ClassifiedOutcome | null {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return null;
    }
    return { outcome: 'refused', reason: error.message };
  }
  if (error instanceof z.ZodError) {
    return null;
  }
  const code = pgErrorCode(error);
  if (code === '23P01') {
    return {
      outcome: 'refused',
      reason: 'Exclusion violation: the doctor already holds an overlapping shift.',
    };
  }
  if (code === '23514') {
    return {
      outcome: 'refused',
      reason: 'H-03: the doctor is not a member of this practice on that date.',
    };
  }
  if (code === '23505') {
    return { outcome: 'failed', reason: 'A unique-constraint violation was not anticipated.' };
  }
  if (code === '23503') {
    return { outcome: 'failed', reason: 'A referenced id did not exist.' };
  }
  return { outcome: 'failed', reason: 'An unexpected error occurred.' };
}

/**
 * Best-effort journaling for a command that did **not** apply -- called from a route's `catch`
 * block, after the command's own transaction has already rolled back. Runs in its own
 * transaction for exactly that reason: a rolled-back transaction cannot carry a journal row
 * recording what it failed to do. "Diagnostics must never cost him work"
 * (`docs/ops/diagnostics.md`) applies here as much as anywhere -- a failure to journal a refusal
 * must never turn into a worse error response than the refusal itself, so this never throws.
 *
 * `tenantId` is `undefined` when the failure happened before tenant resolution (a missing
 * `x-tenant-id` header) -- nothing to scope a journal row to, so this is a deliberate no-op.
 */
export async function journalRefusal(
  tenantId: string | undefined,
  commandType: CommandType,
  actorId: string | null,
  rosterId: string | null,
  error: unknown,
): Promise<void> {
  if (tenantId === undefined) {
    return;
  }
  const classified = classifyOutcome(error);
  if (classified === null) {
    return;
  }
  try {
    await withTenant(tenantId, (client) =>
      writeCommandJournal(client, {
        tenantId,
        actorId,
        commandType,
        rosterId,
        outcome: classified.outcome,
        reason: classified.reason,
      }),
    );
  } catch (journalError) {
    console.error('Failed to journal a refused/failed command:', journalError);
  }
}
