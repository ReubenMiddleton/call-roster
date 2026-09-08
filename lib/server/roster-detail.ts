/**
 * The whole month's grid data for one roster: every slot, its shift definition, and whichever
 * doctor (if any) holds it. Shared by the roster-detail GET endpoint and `PublishRoster`, which
 * snapshots exactly this shape into `roster_version.snapshot` -- the two must never drift apart,
 * so there is one function rather than two copies of the query.
 */

import type { PoolClient } from 'pg';

export interface RosterDetail {
  readonly id: string;
  readonly month: string;
  readonly status: string;
  readonly createdAt: string;
  readonly slots: readonly RosterSlot[];
}

export interface RosterSlot {
  readonly id: string;
  readonly onDate: string;
  readonly shiftKey: string;
  readonly startHour: number;
  readonly hours: number;
  readonly kind: string;
  readonly assignment: RosterAssignment | null;
}

export interface RosterAssignment {
  readonly id: string;
  readonly doctorId: string | null;
  readonly doctorName: string | null;
  readonly periodStart: string | undefined;
  readonly periodEnd: string | undefined;
  readonly provenance: string | null;
  readonly locked: boolean | null;
}

interface RosterRow {
  id: string;
  month: string;
  status: string;
  created_at: Date;
}

interface SlotRow {
  slot_id: string;
  on_date: string;
  shift_key: string;
  start_hour: number;
  hours: string;
  kind: string;
  assignment_id: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  period_start: Date | null;
  period_end: Date | null;
  provenance: string | null;
  locked: boolean | null;
}

export async function fetchRosterDetail(
  client: PoolClient,
  tenantId: string,
  rosterId: string,
): Promise<RosterDetail | undefined> {
  const rosterResult = await client.query<RosterRow>(
    'select id, month, status, created_at from roster where id = $1 and tenant_id = $2',
    [rosterId, tenantId],
  );
  const rosterRow = rosterResult.rows[0];
  if (rosterRow === undefined) {
    return undefined;
  }

  const slotResult = await client.query<SlotRow>(
    `select
       ss.id as slot_id, ss.on_date, ps.shift_key, ps.start_hour, ps.hours, ps.kind,
       sa.id as assignment_id, sa.doctor_id, p.full_name as doctor_name,
       lower(sa.period) as period_start, upper(sa.period) as period_end,
       sa.provenance, sa.locked
     from shift_slot ss
     join pattern_shift ps on ps.id = ss.pattern_shift_id
     left join shift_assignment sa on sa.shift_slot_id = ss.id
     left join person p on p.id = sa.doctor_id
     where ss.roster_id = $1 and ss.tenant_id = $2
     order by ss.on_date, ps.start_hour`,
    [rosterId, tenantId],
  );

  return {
    id: rosterRow.id,
    month: rosterRow.month,
    status: rosterRow.status,
    createdAt: rosterRow.created_at.toISOString(),
    slots: slotResult.rows.map((slot) => ({
      id: slot.slot_id,
      onDate: slot.on_date,
      shiftKey: slot.shift_key,
      startHour: slot.start_hour,
      hours: Number(slot.hours),
      kind: slot.kind,
      assignment:
        slot.assignment_id === null
          ? null
          : {
              id: slot.assignment_id,
              doctorId: slot.doctor_id,
              doctorName: slot.doctor_name,
              periodStart: slot.period_start?.toISOString(),
              periodEnd: slot.period_end?.toISOString(),
              provenance: slot.provenance,
              locked: slot.locked,
            },
    })),
  };
}
