/**
 * A uniform error shape for every route handler: `{ error: { code, message } }`. Never leaks an
 * internal error's message or stack to the client -- only an `ApiError` thrown deliberately by a
 * handler gets its message returned; anything else becomes a generic 500 after being logged
 * server-side.
 *
 * Deliberately built on the plain Web `Response`, not `next/server`'s `NextResponse`. A route
 * handler may return either -- `NextResponse` only adds cookies/rewrites/`next()`, none of which
 * this API uses -- and the plain form is what makes `scripts/check-api-e2e.ts` able to import
 * these route modules directly and call them as functions: `next/server` resolves only inside
 * Next's own bundler, not under plain Node ESM.
 */

import { z } from 'zod';
import { recordError } from './error-record.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, 'bad_request', message);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, 'not_found', message);
}

/** For a conflict the application itself detects -- e.g. a roster-lifecycle command applied to
 * the wrong status -- as opposed to one Postgres reports via a SQLSTATE (`toErrorResponse`
 * handles those). Same `code: 'conflict'` either way; the client shouldn't need to know which
 * layer noticed. */
export function conflict(message: string): ApiError {
  return new ApiError(409, 'conflict', message);
}

export function jsonResponse(data: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, { status });
}

/** `pg` attaches the SQLSTATE as `.code` on the error it throws. Exported for
 * `lib/server/command-journal.ts`'s outcome classifier, which needs the same mapping to decide
 * `refused` vs `failed` -- one source of truth for what each SQLSTATE means, not two. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  return (error as { code?: string }).code;
}

export interface ErrorResponseContext {
  /** Enables L2 tenant correlation (`docs/ops/diagnostics.md`) for the fallback branch below.
   * `undefined` when unknown -- the error is still recorded, just without tenant scoping
   * (`error-record.ts`'s `recordError` handles `undefined` deliberately, not as a caller's
   * oversight). A required key rather than an optional one specifically so a route's own
   * `journalContext.tenantId` (itself `string | undefined`, hoisted for `journalRefusal`) can be
   * passed straight through without `exactOptionalPropertyTypes` friction. */
  readonly tenantId: string | undefined;
  /** The request path, for "what was being asked when this broke." Never the full URL --
   * query params could carry anything. */
  readonly route?: string;
}

/** Call from a route handler's `catch` block. Handles `ApiError`, Zod validation errors, and
 * four specific Postgres SQLSTATEs the schema is known to raise on an expected user path --
 * everything else is L2's job: recorded (`lib/server/error-record.ts`) and reported as an opaque
 * 500, since none of it was anticipated by name the way the branches below are:
 *
 * - `23505` unique_violation — e.g. a second roster for a month that already has one.
 * - `23P01` exclusion_violation — the doctor is already assigned an overlapping shift
 *   (`supabase/migrations/0004_roster_and_assignment.sql`'s GiST exclusion constraint).
 * - `23514` check_violation — the membership-containment trigger's H-03 check, raised with this
 *   SQLSTATE explicitly rather than the plpgsql default `P0001` for exactly this reason: a named
 *   code is something to branch on, message text is not.
 * - `23503` foreign_key_violation — a referenced id (an `actorId`, a `doctorId` on a path that
 *   doesn't already fail closed at the query itself) doesn't exist.
 *
 * `async` for exactly one reason: recording an L2 error record is a database write. Every call
 * site already returns this directly from an `async` route handler (`return toErrorResponse(...)`),
 * so the signature change needed no call-site updates -- verified by grepping for every usage
 * before making it, not assumed.
 */
export async function toErrorResponse(
  error: unknown,
  context?: ErrorResponseContext,
): Promise<Response> {
  if (error instanceof ApiError) {
    return errorResponse(error.status, error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    return errorResponse(400, 'bad_request', error.issues.map((issue) => issue.message).join('; '));
  }
  const code = pgErrorCode(error);
  if (code === '23505') {
    return errorResponse(409, 'conflict', 'That already exists.');
  }
  if (code === '23P01') {
    return errorResponse(
      409,
      'conflict',
      'That doctor is already assigned to an overlapping shift.',
    );
  }
  if (code === '23514') {
    return errorResponse(
      400,
      'bad_request',
      'That doctor is not a member of this practice on that date.',
    );
  }
  if (code === '23503') {
    return errorResponse(400, 'bad_request', 'One of the referenced ids does not exist.');
  }
  console.error(error);
  await recordError(context?.tenantId, error, context?.route);
  return errorResponse(500, 'internal_error', 'Something went wrong.');
}
