/**
 * A doctor's personal calendar feed -- RFC 5545, the minimum a real calendar app needs. "An ICS
 * URL is a bearer credential. Treat it as one." (docs/domain/commands-events.md)
 *
 * The token-resolution half of this feature (matching a bearer token back to its tenant before
 * any tenant context exists) lives in the database, not here -- see `resolve_ics_token` in
 * `supabase/migrations/0012_notification_and_ics_feed.sql` for why a `SECURITY DEFINER` function
 * was the right tool and a superuser-connection shortcut would not have survived a real Supabase
 * deployment.
 */

import { randomBytes } from 'node:crypto';

/** Unguessable, URL-safe. 24 bytes -> 32 base64url characters, comparable in strength to a
 * session token; this is a long-lived bearer credential, so it needs to be. */
export function generateIcsToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface IcsEvent {
  readonly uid: string;
  readonly startUtc: Date;
  readonly endUtc: Date;
  readonly summary: string;
}

function formatIcsDateTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Builds a complete `VCALENDAR` document. Every `VEVENT` carries the same `SEQUENCE` -- a
 * feed-level generation counter bumped on `ApproveSwap`, not a per-event one -- because the whole
 * feed is regenerated fresh on every fetch rather than diffed against a previous version; see the
 * migration comment above for why that's the right amount of complexity here.
 *
 * No line-folding at 75 octets (RFC 5545 §3.1): every value here is short enough that folding
 * would never trigger, and adding it for content that can't reach the limit is speculative.
 */
export function buildIcsCalendar(events: readonly IcsEvent[], sequence: number): string {
  const dtstamp = formatIcsDateTime(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Call Roster//Doctor Feed//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${formatIcsDateTime(event.startUtc)}`,
      `DTEND:${formatIcsDateTime(event.endUtc)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      `SEQUENCE:${String(sequence)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
