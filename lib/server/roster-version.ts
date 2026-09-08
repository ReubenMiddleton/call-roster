/**
 * Immutable, hash-chained roster snapshots -- `roster_version` grants `app_user` select/insert
 * only (supabase/migrations/0004), so once written a version can never be mutated through this
 * API. "Editing a published roster creates version N+1; it never mutates N"
 * (docs/architecture/data-model.md).
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RosterDetail } from './roster-detail.ts';

export interface RosterVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly hash: string;
  readonly prevHash: string | null;
  readonly publishedAt: string;
}

interface RosterVersionRow {
  id: string;
  version_number: number;
  hash: string;
  prev_hash: string | null;
  published_at: Date;
}

/**
 * Chains a new version onto whatever the roster's last one was (or starts the chain at 1). The
 * hash covers the previous link plus this snapshot, so tampering with any earlier version
 * invalidates every hash after it -- the property that makes the chain worth having.
 *
 * Caller must hold a lock on the `roster` row (`select ... for update`) for the duration of the
 * transaction this runs in, so two concurrent publishes of the same roster can't both compute
 * the same next version number.
 */
export async function createRosterVersion(
  client: PoolClient,
  tenantId: string,
  rosterId: string,
  snapshot: RosterDetail,
  publishedBy: string | null,
): Promise<RosterVersion> {
  const prevResult = await client.query<{ version_number: number; hash: string }>(
    'select version_number, hash from roster_version where roster_id = $1 order by version_number desc limit 1',
    [rosterId],
  );
  const prev = prevResult.rows[0];
  const versionNumber = (prev?.version_number ?? 0) + 1;
  const prevHash = prev?.hash ?? null;

  const snapshotJson = JSON.stringify(snapshot);
  const hash = createHash('sha256')
    .update(`${prevHash ?? ''}${snapshotJson}`)
    .digest('hex');

  const result = await client.query<RosterVersionRow>(
    `insert into roster_version (tenant_id, roster_id, version_number, prev_hash, hash, snapshot, published_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, version_number, hash, prev_hash, published_at`,
    [tenantId, rosterId, versionNumber, prevHash, hash, snapshotJson, publishedBy],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insert into roster_version returned no row');
  }
  return {
    id: row.id,
    versionNumber: row.version_number,
    hash: row.hash,
    prevHash: row.prev_hash,
    publishedAt: row.published_at.toISOString(),
  };
}

interface LatestVersionRow {
  version_number: number;
  snapshot: RosterDetail;
}

/** The most recent version's snapshot, or `undefined` if the roster has never been published. */
export async function latestRosterVersion(
  client: PoolClient,
  rosterId: string,
): Promise<{ versionNumber: number; snapshot: RosterDetail } | undefined> {
  const result = await client.query<LatestVersionRow>(
    'select version_number, snapshot from roster_version where roster_id = $1 order by version_number desc limit 1',
    [rosterId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return undefined;
  }
  return { versionNumber: row.version_number, snapshot: row.snapshot };
}
