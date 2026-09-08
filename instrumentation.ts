/**
 * L2, the server half's framework hook (`docs/ops/diagnostics.md`). Stable since Next.js 15, and
 * loaded automatically by Next's own server runtime -- no `next.config.ts` flag needed on this
 * version (16.3.3).
 *
 * `onRequestError` fires for an error in a Route Handler, Server Action, Server Component or
 * Middleware **regardless of any error boundary** -- the one thing a component-level boundary
 * cannot catch. ⚠️ **In this codebase, that mostly means it won't fire for the API today**: every
 * route handler already wraps its whole body in `try`/`catch` and reports through
 * `toErrorResponse` (`lib/server/api-error.ts`), which is where L2 error recording actually
 * happens for the overwhelming majority of failures -- see that module. This hook exists as
 * defense in depth for exactly what a route handler's own `try`/`catch` cannot cover: middleware,
 * a route that someday forgets the pattern, or a genuine framework-level crash.
 *
 * No tenant context reaches this hook -- the framework has no concept of one -- so every record
 * from here is tenant-less by construction, the same honest gap `lib/server/error-record.ts`
 * documents for any caller that doesn't know its tenant yet.
 */

import { recordError } from './lib/server/error-record.ts';

export async function register(): Promise<void> {
  // No process-level setup needed yet -- this exists so the file matches Next's documented
  // shape and so a future need (e.g. initialising an OTel SDK) has an obvious home.
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
): Promise<void> {
  await recordError(undefined, error, `${request.method} ${request.path}`);
}
