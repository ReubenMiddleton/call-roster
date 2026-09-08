/**
 * L2, error records (`docs/ops/diagnostics.md`) -- for the failures that ARE exceptions, as
 * distinct from L1's command journal, which covers the far more common case of nothing throwing
 * at all (a warning that fires when it shouldn't, an export that comes out wrong). OpenTelemetry
 * exception semantic conventions for field names: "the vocabulary, not the SDK" -- a future
 * exporter (Sentry-compatible, self-hosted GlitchTip) is a field mapping, not a
 * re-instrumentation (ADR-0013).
 *
 * The one place this is called today is `lib/server/api-error.ts`'s `toErrorResponse`, in its
 * fallback branch -- every other branch there is an already-classified, expected outcome
 * (validation, a known SQLSTATE, an `ApiError` a route built deliberately), which is exactly what
 * `journalRefusal`'s `outcome: 'refused'` already covers. Only the unclassified case is a real,
 * unanticipated exception worth L2's attention.
 */

import type { PoolClient } from 'pg';
import { getAppVersion, getSchemaVersion } from './build-info.ts';
import { withAppUser, withTenant } from './db.ts';

interface ExceptionDetails {
  readonly type: string;
  readonly message: string;
  readonly stacktrace: string | null;
}

/** Handles the two shapes a `catch` clause actually sees: a real `Error` (the overwhelming
 * majority), and a thrown non-`Error` value (a string, a plain object) -- rare, but "diagnostics
 * must never cost him work" means this must never itself throw trying to describe one. */
function describeException(error: unknown): ExceptionDetails {
  if (error instanceof Error) {
    return {
      type: error.constructor.name,
      message: error.message,
      stacktrace: error.stack ?? null,
    };
  }
  let message: string;
  try {
    message = typeof error === 'string' ? error : JSON.stringify(error);
  } catch {
    message = String(error);
  }
  return { type: 'NonErrorThrown', message, stacktrace: null };
}

async function insertErrorRecord(
  client: PoolClient,
  tenantId: string | null,
  error: unknown,
  route: string | undefined,
): Promise<void> {
  const { type, message, stacktrace } = describeException(error);
  await client.query(
    `insert into error_record
       (tenant_id, exception_type, exception_message, exception_stacktrace, source, route,
        app_version, schema_version)
     values ($1, $2, $3, $4, 'server', $5, $6, $7)`,
    [tenantId, type, message, stacktrace, route ?? null, getAppVersion(), getSchemaVersion()],
  );
}

/**
 * Best-effort L2 capture for a genuinely unanticipated server-side exception. Never throws --
 * a failure to record an error must never turn into a worse error than the one it was trying to
 * describe, the same rule `journalRefusal` follows for L1. Runs in its own transaction so a
 * caller mid-rollback (which is exactly when this is usually called) doesn't drag the recording
 * down with it.
 *
 * `tenantId` is `undefined` for a genuinely tenant-less failure (malformed input to
 * `POST /api/practices`, before any tenant exists) -- recorded via `withAppUser` rather than
 * skipped, since the RLS policy already makes a null-tenant row invisible to every tenant
 * context, not merely unrecorded.
 */
export async function recordError(
  tenantId: string | undefined,
  error: unknown,
  route?: string,
): Promise<void> {
  try {
    if (tenantId === undefined) {
      await withAppUser((client) => insertErrorRecord(client, null, error, route));
    } else {
      await withTenant(tenantId, (client) => insertErrorRecord(client, tenantId, error, route));
    }
  } catch (recordingError) {
    console.error('Failed to record an L2 error record:', recordingError);
  }
}
