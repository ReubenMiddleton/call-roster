/**
 * ⚠️ TEMPORARY, pre-auth. There is no authentication yet (HANDOFF.md: "Auth, and anything
 * multi-user" does not exist). Tenant identity is carried by a plain request header instead of a
 * verified session or JWT claim, so **anyone who can set a header can claim to be any tenant** --
 * this must never run against real data, only against local/dev databases seeded with synthetic
 * tenants.
 *
 * Every route handler that needs a tenant goes through this module, so replacing it with the
 * real session's tenant claim the day auth exists is a one-file change, not a search-and-replace
 * across every route.
 */

import { badRequest, notFound } from './api-error.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireTenantId(request: Request): string {
  const tenantId = request.headers.get('x-tenant-id');
  if (tenantId === null || !UUID_RE.test(tenantId)) {
    throw badRequest('Missing or invalid x-tenant-id header.');
  }
  return tenantId;
}

/**
 * For every `/api/practices/[practiceId]/...` route: the header and the path segment must name
 * the same practice. RLS would already return zero rows on a mismatch (the isolation policy is
 * `tenant_id = app_current_tenant_id()`), so this is defence in depth, not the real boundary --
 * but it turns a confusing empty result into an honest 404, and fails before any query runs.
 */
export function requireTenantForPractice(request: Request, practiceId: string): string {
  const tenantId = requireTenantId(request);
  if (tenantId !== practiceId) {
    throw notFound(`No practice ${practiceId}.`);
  }
  return tenantId;
}
