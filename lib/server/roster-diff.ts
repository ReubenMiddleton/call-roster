/**
 * "`UnpublishRoster` must emit a diff of what changed. Going backwards silently is how people
 * stop trusting the system." (docs/domain/commands-events.md)
 *
 * Compares two `RosterDetail` snapshots slot by slot. Until versioned editing of a published
 * roster exists (only `DRAFT` rosters can be mutated today -- see the status guards in
 * `assignments/route.ts` and `rosters/[rosterId]/slots/route.ts`), calling this against a
 * roster's last published version will always return an empty diff. That is correct, not a
 * missing feature: nothing had the chance to change. The comparison itself is real and does its
 * job the day an edit-after-publish path exists.
 */

import type { RosterDetail, RosterSlot } from './roster-detail.ts';

export interface SlotDiff {
  readonly slotId: string;
  readonly onDate: string;
  readonly before: RosterSlot['assignment'];
  readonly after: RosterSlot['assignment'];
}

function assignmentsEqual(a: RosterSlot['assignment'], b: RosterSlot['assignment']): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.doctorId === b.doctorId && a.provenance === b.provenance && a.locked === b.locked;
}

/** One entry per slot whose assignment differs between `before` and `after`. Compares by
 * doctor/provenance/locked, not object identity -- `before` and `after` come from independent
 * queries and will never be the same object even when nothing changed. */
export function diffRosterSlots(before: RosterDetail, after: RosterDetail): readonly SlotDiff[] {
  const beforeBySlot = new Map(before.slots.map((slot) => [slot.id, slot]));
  const diffs: SlotDiff[] = [];
  for (const afterSlot of after.slots) {
    const beforeAssignment = beforeBySlot.get(afterSlot.id)?.assignment ?? null;
    if (!assignmentsEqual(beforeAssignment, afterSlot.assignment)) {
      diffs.push({
        slotId: afterSlot.id,
        onDate: afterSlot.onDate,
        before: beforeAssignment,
        after: afterSlot.assignment,
      });
    }
  }
  return diffs;
}
