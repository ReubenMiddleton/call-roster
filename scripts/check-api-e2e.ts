// Exercises the JSON API route handlers directly -- imported as plain functions and called with
// constructed `Request` objects, no dev server involved -- against a real, throwaway Postgres
// cluster. This is the API's equivalent of `solver:e2e`: proof that the pieces work together, not
// just that each one type-checks.
//
// A separate gate from `npm run check`, the same way `db:check` and `solver:check` are.

import { join } from 'node:path';
import { createPgTestCluster, REPO_ROOT } from './lib/pg-test-cluster.ts';

const cluster = createPgTestCluster({
  pgdata: join(REPO_ROOT, '.tools', 'pgdata-api-test'),
  port: '55435',
});
process.env.DATABASE_URL = cluster.connectionString();

// Imported only after DATABASE_URL is set -- `lib/server/db.ts` reads it lazily on first query,
// but setting it up front removes any doubt about import order mattering.
const { resetPoolForTests, withTenant } = await import('../lib/server/db.ts');
const practicesRoute = await import('../app/api/practices/route.ts');
const practiceRoute = await import('../app/api/practices/[practiceId]/route.ts');
const doctorsRoute = await import('../app/api/practices/[practiceId]/doctors/route.ts');
const rostersRoute = await import('../app/api/practices/[practiceId]/rosters/route.ts');
const rosterRoute = await import('../app/api/practices/[practiceId]/rosters/[rosterId]/route.ts');
const slotsRoute = await import(
  '../app/api/practices/[practiceId]/rosters/[rosterId]/slots/route.ts'
);
const shiftPatternsRoute = await import(
  '../app/api/practices/[practiceId]/shift-patterns/route.ts'
);
const weekdayDefaultsRoute = await import(
  '../app/api/practices/[practiceId]/weekday-defaults/route.ts'
);
const datePatternsRoute = await import('../app/api/practices/[practiceId]/date-patterns/route.ts');
const assignmentsRoute = await import('../app/api/practices/[practiceId]/assignments/route.ts');
const assignmentRoute = await import(
  '../app/api/practices/[practiceId]/assignments/[assignmentId]/route.ts'
);
const publishRoute = await import(
  '../app/api/practices/[practiceId]/rosters/[rosterId]/publish/route.ts'
);
const unpublishRoute = await import(
  '../app/api/practices/[practiceId]/rosters/[rosterId]/unpublish/route.ts'
);
const closeReviewWindowRoute = await import(
  '../app/api/practices/[practiceId]/rosters/[rosterId]/close-review-window/route.ts'
);
const archiveRoute = await import(
  '../app/api/practices/[practiceId]/rosters/[rosterId]/archive/route.ts'
);
const swapRequestsRoute = await import('../app/api/practices/[practiceId]/swap-requests/route.ts');
const approveSwapRoute = await import(
  '../app/api/practices/[practiceId]/swap-requests/[swapRequestId]/approve/route.ts'
);
const rejectSwapRoute = await import(
  '../app/api/practices/[practiceId]/swap-requests/[swapRequestId]/reject/route.ts'
);
const notificationsRoute = await import('../app/api/practices/[practiceId]/notifications/route.ts');
const icsFeedRoute = await import(
  '../app/api/practices/[practiceId]/doctors/[doctorId]/ics-feed/route.ts'
);
const icsPublicRoute = await import('../app/api/ics/[token]/route.ts');
const ledgerRoute = await import('../app/api/practices/[practiceId]/ledger/route.ts');
const ledgerRecalculateRoute = await import(
  '../app/api/practices/[practiceId]/ledger/recalculate/route.ts'
);
const burdenSchedulesRoute = await import(
  '../app/api/practices/[practiceId]/burden-schedules/route.ts'
);
const commandJournalRoute = await import(
  '../app/api/practices/[practiceId]/command-journal/route.ts'
);
const diagnosticBundleRoute = await import(
  '../app/api/practices/[practiceId]/rosters/[rosterId]/diagnostic-bundle/route.ts'
);

function jsonRequest(method: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/test', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

function params(practiceId: string): { params: Promise<{ practiceId: string }> } {
  return { params: Promise.resolve({ practiceId }) };
}

function rosterParams(
  practiceId: string,
  rosterId: string,
): { params: Promise<{ practiceId: string; rosterId: string }> } {
  return { params: Promise.resolve({ practiceId, rosterId }) };
}

function assignmentParams(
  practiceId: string,
  assignmentId: string,
): { params: Promise<{ practiceId: string; assignmentId: string }> } {
  return { params: Promise.resolve({ practiceId, assignmentId }) };
}

function swapRequestParams(
  practiceId: string,
  swapRequestId: string,
): { params: Promise<{ practiceId: string; swapRequestId: string }> } {
  return { params: Promise.resolve({ practiceId, swapRequestId }) };
}

function doctorParams(
  practiceId: string,
  doctorId: string,
): { params: Promise<{ practiceId: string; doctorId: string }> } {
  return { params: Promise.resolve({ practiceId, doctorId }) };
}

function tokenParams(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

async function expectStatus(response: Response, expected: number, label: string): Promise<unknown> {
  const body: unknown = await response.json();
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected status ${String(expected)}, got ${String(response.status)}\n${JSON.stringify(body)}`,
    );
  }
  return body;
}

function step(label: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${label} ... `);
  return fn().then(() => {
    process.stdout.write('ok\n');
  });
}

async function main(): Promise<void> {
  console.log('Starting a throwaway PostgreSQL cluster from .tools/pgsql ...');
  cluster.start();
  cluster.applyMigrations();

  try {
    let practiceId = '';
    let otherPracticeId = '';
    let doctorId = '';
    let rosterId = '';
    let patternAId = '';
    let patternCId = '';
    let assignmentId = '';

    await step('POST /api/practices creates a tenant', async () => {
      const response = await practicesRoute.POST(
        jsonRequest('POST', { name: 'Synthetic Practice' }),
      );
      const body = (await expectStatus(response, 201, 'create practice')) as {
        id: string;
        name: string;
      };
      if (body.name !== 'Synthetic Practice') {
        throw new Error(`Unexpected name: ${body.name}`);
      }
      practiceId = body.id;
    });

    await step('POST /api/practices rejects an unknown field (strict schema)', async () => {
      const response = await practicesRoute.POST(
        jsonRequest('POST', { name: 'X', extra: 'not allowed' }),
      );
      await expectStatus(response, 400, 'strict schema rejection');
    });

    await step('POST /api/practices rejects a missing name', async () => {
      const response = await practicesRoute.POST(jsonRequest('POST', {}));
      await expectStatus(response, 400, 'missing name rejection');
    });

    await step('GET /api/practices/:id without x-tenant-id is rejected', async () => {
      const response = await practiceRoute.GET(jsonRequest('GET'), params(practiceId));
      await expectStatus(response, 400, 'missing tenant header');
    });

    await step('GET /api/practices/:id with the right header returns the practice', async () => {
      const response = await practiceRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'get practice')) as { id: string };
      if (body.id !== practiceId) {
        throw new Error(`Expected id ${practiceId}, got ${body.id}`);
      }
    });

    await step('POST /api/practices a second time, for cross-tenant checks', async () => {
      const response = await practicesRoute.POST(jsonRequest('POST', { name: 'Other Practice' }));
      const body = (await expectStatus(response, 201, 'create second practice')) as { id: string };
      otherPracticeId = body.id;
    });

    await step("GET /api/practices/:id with another tenant's header 404s, not leaks", async () => {
      const response = await practiceRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': otherPracticeId }),
        params(practiceId),
      );
      await expectStatus(response, 404, 'cross-tenant practice lookup');
    });

    await step('POST doctors creates a person and their membership together', async () => {
      const response = await doctorsRoute.POST(
        jsonRequest(
          'POST',
          { fullName: 'Synthetic Doctor', validFrom: '2026-01-01' },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const body = (await expectStatus(response, 201, 'create doctor')) as {
        id: string;
        validTo: string | null;
      };
      if (body.validTo !== null) {
        throw new Error(`Expected an open-ended membership, got validTo=${body.validTo}`);
      }
      doctorId = body.id;
    });

    await step('GET doctors lists the doctor just created, and only for this tenant', async () => {
      const response = await doctorsRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'list doctors')) as {
        doctors: { id: string }[];
      };
      if (body.doctors.length !== 1 || body.doctors[0]?.id !== doctorId) {
        throw new Error(`Expected exactly one doctor (${doctorId}), got ${JSON.stringify(body)}`);
      }

      const otherResponse = await doctorsRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': otherPracticeId }),
        params(otherPracticeId),
      );
      const otherBody = (await expectStatus(otherResponse, 200, 'list doctors, other tenant')) as {
        doctors: unknown[];
      };
      if (otherBody.doctors.length !== 0) {
        throw new Error(
          `Expected the other tenant to have no doctors, got ${JSON.stringify(otherBody)}`,
        );
      }
    });

    await step('POST rosters creates a draft roster for a month', async () => {
      const response = await rostersRoute.POST(
        jsonRequest('POST', { month: '2026-10' }, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 201, 'create roster')) as {
        id: string;
        status: string;
      };
      if (body.status !== 'draft') {
        throw new Error(`Expected a new roster to be draft, got ${body.status}`);
      }
      rosterId = body.id;
    });

    await step('POST rosters again for the same month is a 409, not a 500', async () => {
      const response = await rostersRoute.POST(
        jsonRequest('POST', { month: '2026-10' }, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      await expectStatus(response, 409, 'duplicate roster month');
    });

    await step('GET rosters lists the one roster', async () => {
      const response = await rostersRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'list rosters')) as { rosters: unknown[] };
      if (body.rosters.length !== 1) {
        throw new Error(`Expected exactly one roster, got ${JSON.stringify(body)}`);
      }
    });

    await step(
      'POST shift-patterns creates a pattern and rejects one that misses 24 hours',
      async () => {
        const badResponse = await shiftPatternsRoute.POST(
          jsonRequest(
            'POST',
            {
              name: 'Broken',
              shifts: [{ shiftKey: 'only', startHour: 7, hours: 8, kind: 'morning' }],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(badResponse, 400, 'pattern not summing to 24 hours');

        const standardResponse = await shiftPatternsRoute.POST(
          jsonRequest(
            'POST',
            {
              name: 'Standard',
              shifts: [
                { shiftKey: 'std-morning', startHour: 7, hours: 8, kind: 'morning' },
                { shiftKey: 'std-afternoon', startHour: 15, hours: 8, kind: 'afternoon' },
                { shiftKey: 'std-night', startHour: 23, hours: 8, kind: 'night' },
              ],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const standard = (await expectStatus(standardResponse, 201, 'create pattern A')) as {
          id: string;
          shifts: unknown[];
        };
        if (standard.shifts.length !== 3) {
          throw new Error(`Expected 3 shifts, got ${JSON.stringify(standard)}`);
        }
        patternAId = standard.id;

        const reducedResponse = await shiftPatternsRoute.POST(
          jsonRequest(
            'POST',
            {
              name: 'Reduced',
              shifts: [
                { shiftKey: 'long-day', startHour: 7, hours: 10, kind: 'long-day' },
                { shiftKey: 'red-evening', startHour: 17, hours: 6, kind: 'evening' },
                { shiftKey: 'red-night', startHour: 23, hours: 8, kind: 'night' },
              ],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const reduced = (await expectStatus(reducedResponse, 201, 'create pattern C')) as {
          id: string;
        };
        patternCId = reduced.id;
      },
    );

    await step('GET shift-patterns lists both patterns', async () => {
      const response = await shiftPatternsRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'list shift patterns')) as {
        shiftPatterns: unknown[];
      };
      if (body.shiftPatterns.length !== 2) {
        throw new Error(`Expected 2 patterns, got ${JSON.stringify(body)}`);
      }
    });

    await step('PUT weekday-defaults sets every day to the Standard pattern', async () => {
      const allStandard = Object.fromEntries(
        ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(
          (day) => [day, patternAId],
        ),
      );
      const response = await weekdayDefaultsRoute.PUT(
        jsonRequest('PUT', allStandard, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      await expectStatus(response, 200, 'set weekday defaults');

      const getResponse = await weekdayDefaultsRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(getResponse, 200, 'get weekday defaults')) as {
        weekdayDefaults: Record<string, string | null>;
      };
      if (body.weekdayDefaults.monday !== patternAId) {
        throw new Error(`Expected Monday to be the Standard pattern, got ${JSON.stringify(body)}`);
      }
    });

    await step('POST date-patterns overrides one date to the Reduced pattern', async () => {
      const response = await datePatternsRoute.POST(
        jsonRequest(
          'POST',
          { onDate: '2026-10-05', patternId: patternCId, reason: 'short-staffed' },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      await expectStatus(response, 201, 'create date-pattern override');

      const getResponse = await datePatternsRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(getResponse, 200, 'list date-pattern overrides')) as {
        datePatterns: unknown[];
      };
      if (body.datePatterns.length !== 1) {
        throw new Error(`Expected 1 override, got ${JSON.stringify(body)}`);
      }
    });

    await step('POST slots generates October 2026: 30 Standard days + 1 Reduced day', async () => {
      const response = await slotsRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const body = (await expectStatus(response, 201, 'generate slots')) as {
        slotsCreated: number;
        datesNeedingDecision: unknown[];
      };
      // 30 dates x 3 Standard shifts + 1 date x 3 Reduced shifts = 93.
      if (body.slotsCreated !== 93) {
        throw new Error(`Expected 93 slots, got ${JSON.stringify(body)}`);
      }
      if (body.datesNeedingDecision.length !== 0) {
        throw new Error(`Expected no undetermined dates, got ${JSON.stringify(body)}`);
      }

      // Idempotent: running it again adds nothing.
      const secondResponse = await slotsRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const secondBody = (await expectStatus(secondResponse, 201, 'regenerate slots')) as {
        slotsCreated: number;
      };
      if (secondBody.slotsCreated !== 0) {
        throw new Error(`Expected regenerating to add nothing, got ${JSON.stringify(secondBody)}`);
      }
    });

    let standardSlotId = '';
    let overrideDaySlotIds: string[] = [];

    await step(
      'GET roster shows 93 slots, the override day running the Reduced pattern',
      async () => {
        const response = await rosterRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        const body = (await expectStatus(response, 200, 'get roster detail')) as {
          slots: { id: string; onDate: string; kind: string; assignment: unknown }[];
        };
        if (body.slots.length !== 93) {
          throw new Error(`Expected 93 slots, got ${String(body.slots.length)}`);
        }

        overrideDaySlotIds = body.slots
          .filter((slot) => slot.onDate === '2026-10-05')
          .map((slot) => slot.id);
        if (overrideDaySlotIds.length !== 3) {
          throw new Error(
            `Expected 3 slots on the overridden date, got ${String(overrideDaySlotIds.length)}`,
          );
        }
        const overrideKinds = body.slots
          .filter((slot) => slot.onDate === '2026-10-05')
          .map((slot) => slot.kind)
          .sort();
        if (JSON.stringify(overrideKinds) !== JSON.stringify(['evening', 'long-day', 'night'])) {
          throw new Error(
            `Expected the Reduced pattern's kinds, got ${JSON.stringify(overrideKinds)}`,
          );
        }

        const firstMorning = body.slots.find(
          (slot) => slot.onDate === '2026-10-01' && slot.kind === 'morning',
        );
        if (firstMorning === undefined) {
          throw new Error('Expected a morning slot on 2026-10-01');
        }
        standardSlotId = firstMorning.id;
        if (firstMorning.assignment !== null) {
          throw new Error('Expected a freshly generated slot to have no assignment');
        }
      },
    );

    await step(
      'POST assignments assigns a doctor, deriving the period from the shift definition',
      async () => {
        const response = await assignmentsRoute.POST(
          jsonRequest(
            'POST',
            { shiftSlotId: standardSlotId, doctorId },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const body = (await expectStatus(response, 201, 'create assignment')) as {
          id: string;
          periodStart: string;
          periodEnd: string;
          provenance: string;
        };
        // 07:00 SAST (UTC+2, no DST) is 05:00 UTC; the shift is 8 hours.
        if (
          body.periodStart !== '2026-10-01T05:00:00.000Z' ||
          body.periodEnd !== '2026-10-01T13:00:00.000Z'
        ) {
          throw new Error(`Unexpected period: ${JSON.stringify(body)}`);
        }
        if (body.provenance !== 'directed') {
          throw new Error(
            `Expected the default provenance to be 'directed', got ${body.provenance}`,
          );
        }
        assignmentId = body.id;
      },
    );

    await step('GET roster reflects the new assignment', async () => {
      const response = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const body = (await expectStatus(response, 200, 'get roster after assignment')) as {
        slots: { id: string; assignment: { doctorId: string } | null }[];
      };
      const slot = body.slots.find((s) => s.id === standardSlotId);
      if (slot?.assignment?.doctorId !== doctorId) {
        throw new Error(`Expected the slot to show the assignment, got ${JSON.stringify(slot)}`);
      }
    });

    await step(
      'POST assignments 404s on a shift slot from another tenant/nonexistent',
      async () => {
        const response = await assignmentsRoute.POST(
          jsonRequest(
            'POST',
            { shiftSlotId: '00000000-0000-0000-0000-000000000000', doctorId },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(response, 404, 'assign to a nonexistent slot');
      },
    );

    await step(
      'The exclusion constraint refuses a doctor double-booked on overlapping shifts',
      async () => {
        // A pattern whose shifts deliberately overlap, purely to exercise the invariant through the
        // API -- no real shift pattern in docs/domain/shift-patterns.md overlaps with itself, by
        // construction, so this is the only way to trigger it above the SQL layer.
        const patternResponse = await shiftPatternsRoute.POST(
          jsonRequest(
            'POST',
            {
              name: 'Overlap Test',
              shifts: [
                { shiftKey: 'dup-a', startHour: 7, hours: 8, kind: 'morning' },
                { shiftKey: 'dup-b', startHour: 7, hours: 8, kind: 'afternoon' },
                { shiftKey: 'rest', startHour: 15, hours: 8, kind: 'night' },
              ],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const pattern = (await expectStatus(patternResponse, 201, 'create overlap pattern')) as {
          id: string;
        };

        await datePatternsRoute.POST(
          jsonRequest(
            'POST',
            { onDate: '2026-10-10', patternId: pattern.id },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const generateResponse = await slotsRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        await expectStatus(generateResponse, 201, 'generate slots including the overlap date');

        const rosterResponse = await rosterRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        const rosterBody = (await expectStatus(
          rosterResponse,
          200,
          'get roster for overlap slots',
        )) as {
          slots: { id: string; onDate: string; shiftKey?: string }[];
        };
        const overlapSlots = rosterBody.slots.filter((s) => s.onDate === '2026-10-10');
        const dupA = overlapSlots.find((s) => 'shiftKey' in s && s.shiftKey === 'dup-a');
        const dupB = overlapSlots.find((s) => 'shiftKey' in s && s.shiftKey === 'dup-b');
        if (dupA === undefined || dupB === undefined) {
          throw new Error(`Expected both overlapping slots, got ${JSON.stringify(overlapSlots)}`);
        }

        const firstResponse = await assignmentsRoute.POST(
          jsonRequest('POST', { shiftSlotId: dupA.id, doctorId }, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        await expectStatus(firstResponse, 201, 'assign the first overlapping slot');

        const secondResponse = await assignmentsRoute.POST(
          jsonRequest('POST', { shiftSlotId: dupB.id, doctorId }, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        await expectStatus(secondResponse, 409, 'assign the same doctor to an overlapping slot');
      },
    );

    await step('H-03 refuses a doctor outside their membership interval', async () => {
      const doctorResponse = await doctorsRoute.POST(
        jsonRequest(
          'POST',
          { fullName: 'Doctor Outside Membership', validFrom: '2020-01-01', validTo: '2020-12-31' },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const outsideDoctor = (await expectStatus(doctorResponse, 201, 'create a lapsed doctor')) as {
        id: string;
      };

      // Needs a slot nobody has claimed yet -- `standardSlotId` is still held by `doctorId` at
      // this point in the run, and `dupA`/`dupB` from the previous step are taken or refused.
      // The third slot on the overlap date ('rest') was never touched by either.
      const rosterResponse = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const rosterBody = (await expectStatus(rosterResponse, 200, 'get roster for H-03 slot')) as {
        slots: { id: string; onDate: string; shiftKey?: string; assignment: unknown }[];
      };
      const openSlot = rosterBody.slots.find(
        (slot) => slot.onDate === '2026-10-10' && slot.shiftKey === 'rest',
      );
      if (openSlot?.assignment !== null) {
        throw new Error(
          `Expected an open 'rest' slot on 2026-10-10, got ${JSON.stringify(openSlot)}`,
        );
      }

      const response = await assignmentsRoute.POST(
        jsonRequest(
          'POST',
          { shiftSlotId: openSlot.id, doctorId: outsideDoctor.id },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      await expectStatus(response, 400, 'assign a doctor outside their membership interval');
    });

    await step('DELETE assignments unassigns, and the roster reflects it', async () => {
      const response = await assignmentRoute.DELETE(
        jsonRequest('DELETE', undefined, { 'x-tenant-id': practiceId }),
        assignmentParams(practiceId, assignmentId),
      );
      await expectStatus(response, 200, 'delete assignment');

      const rosterResponse = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const body = (await expectStatus(rosterResponse, 200, 'get roster after unassign')) as {
        slots: { id: string; assignment: unknown }[];
      };
      const slot = body.slots.find((s) => s.id === standardSlotId);
      if (slot?.assignment !== null) {
        throw new Error(`Expected the slot to be unassigned, got ${JSON.stringify(slot)}`);
      }
    });

    await step('DELETE assignments 404s on an assignment that no longer exists', async () => {
      const response = await assignmentRoute.DELETE(
        jsonRequest('DELETE', undefined, { 'x-tenant-id': practiceId }),
        assignmentParams(practiceId, assignmentId),
      );
      await expectStatus(response, 404, 'delete an already-deleted assignment');
    });

    await step('Lifecycle commands refuse the wrong precondition on a draft roster', async () => {
      const unpublishResponse = await unpublishRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      await expectStatus(unpublishResponse, 409, 'unpublish a draft');

      const closeResponse = await closeReviewWindowRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      await expectStatus(closeResponse, 409, 'close the review window on a draft');

      const archiveResponse = await archiveRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      await expectStatus(archiveResponse, 409, 'archive a draft');
    });

    let firstVersionHash = '';

    await step(
      'POST publish snapshots the roster as version 1 and moves it to PUBLISHED',
      async () => {
        const response = await publishRoute.POST(
          jsonRequest('POST', { actorId: doctorId }, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        const body = (await expectStatus(response, 200, 'publish')) as {
          status: string;
          version: { versionNumber: number; hash: string; prevHash: string | null };
          ledger: { recalculated: boolean; reason?: string };
        };
        if (body.status !== 'published') {
          throw new Error(`Expected 'published', got ${body.status}`);
        }
        if (body.version.versionNumber !== 1 || body.version.prevHash !== null) {
          throw new Error(`Expected the first version, got ${JSON.stringify(body.version)}`);
        }
        firstVersionHash = body.version.hash;

        // No burden schedule exists yet at this point in the sequence -- publish must still
        // succeed, just with the ledger step reporting it was skipped and why, not blocking.
        if (body.ledger.recalculated || !body.ledger.reason?.includes('No burden schedule')) {
          throw new Error(
            `Expected publish to report a skipped ledger recalculation, got ${JSON.stringify(body.ledger)}`,
          );
        }

        const rosterResponse = await rosterRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        const rosterBody = (await expectStatus(rosterResponse, 200, 'get published roster')) as {
          status: string;
        };
        if (rosterBody.status !== 'published') {
          throw new Error(
            `Expected the roster's own status to read 'published', got ${rosterBody.status}`,
          );
        }
      },
    );

    await step(
      'Publishing again, and editing directly, are both refused once PUBLISHED',
      async () => {
        const republishResponse = await publishRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        await expectStatus(republishResponse, 409, 'publish an already-published roster');

        const generateResponse = await slotsRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        await expectStatus(generateResponse, 409, 'generate slots on a published roster');

        const assignResponse = await assignmentsRoute.POST(
          jsonRequest(
            'POST',
            { shiftSlotId: standardSlotId, doctorId },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(assignResponse, 409, 'assign on a published roster');
      },
    );

    await step(
      'POST unpublish returns an empty diff (nothing could have changed) and reopens DRAFT',
      async () => {
        const response = await unpublishRoute.POST(
          jsonRequest(
            'POST',
            { reason: 'fixing a typo before the real test' },
            { 'x-tenant-id': practiceId },
          ),
          rosterParams(practiceId, rosterId),
        );
        const body = (await expectStatus(response, 200, 'unpublish')) as {
          status: string;
          diff: unknown[];
        };
        if (body.status !== 'draft') {
          throw new Error(`Expected 'draft', got ${body.status}`);
        }
        if (body.diff.length !== 0) {
          throw new Error(
            `Expected an empty diff (edits were refused while published), got ${JSON.stringify(body.diff)}`,
          );
        }
      },
    );

    await step(
      'Editing works again after unpublish, and republishing chains onto version 1',
      async () => {
        const assignResponse = await assignmentsRoute.POST(
          jsonRequest(
            'POST',
            { shiftSlotId: standardSlotId, doctorId },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(assignResponse, 201, 're-assign after unpublish');

        const response = await publishRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId),
        );
        const body = (await expectStatus(response, 200, 'publish version 2')) as {
          version: { versionNumber: number; prevHash: string | null };
        };
        if (body.version.versionNumber !== 2 || body.version.prevHash !== firstVersionHash) {
          throw new Error(
            `Expected version 2 chained onto version 1, got ${JSON.stringify(body.version)}`,
          );
        }
      },
    );

    await step('POST close-review-window moves PUBLISHED to LOCKED', async () => {
      const response = await closeReviewWindowRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const body = (await expectStatus(response, 200, 'close review window')) as { status: string };
      if (body.status !== 'locked') {
        throw new Error(`Expected 'locked', got ${body.status}`);
      }

      const unpublishResponse = await unpublishRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      await expectStatus(unpublishResponse, 409, 'unpublish a locked roster');
    });

    await step('POST archive moves LOCKED to ARCHIVED, terminal', async () => {
      const response = await archiveRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const body = (await expectStatus(response, 200, 'archive')) as { status: string };
      if (body.status !== 'archived') {
        throw new Error(`Expected 'archived', got ${body.status}`);
      }

      const reArchiveResponse = await archiveRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      await expectStatus(reArchiveResponse, 409, 're-archive an already-archived roster');

      const rosterResponse = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId),
      );
      const rosterBody = (await expectStatus(rosterResponse, 200, 'get archived roster')) as {
        status: string;
        slots: unknown[];
      };
      // 93 from the Standard/Reduced generation earlier, +3 from the overlap-test pattern
      // added to 2026-10-10 during the exclusion-constraint step.
      if (rosterBody.status !== 'archived' || rosterBody.slots.length !== 96) {
        throw new Error(
          `Expected an archived, still-readable roster, got ${JSON.stringify({ status: rosterBody.status, slotCount: rosterBody.slots.length })}`,
        );
      }
    });

    let secondDoctorId = '';
    let rosterId2 = '';
    let assignmentId1 = '';
    let assignmentId2 = '';

    await step('Set up a second roster (November) to exercise swaps on', async () => {
      const doctorResponse = await doctorsRoute.POST(
        jsonRequest(
          'POST',
          { fullName: 'Second Synthetic Doctor', validFrom: '2026-01-01' },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const doctor = (await expectStatus(doctorResponse, 201, 'create second doctor')) as {
        id: string;
      };
      secondDoctorId = doctor.id;

      const rosterResponse = await rostersRoute.POST(
        jsonRequest('POST', { month: '2026-11' }, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const roster = (await expectStatus(rosterResponse, 201, 'create November roster')) as {
        id: string;
      };
      rosterId2 = roster.id;

      const generateResponse = await slotsRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId2),
      );
      // November has 30 days, all Standard (the Reduced override was only for 2026-10-05).
      const generateBody = (await expectStatus(
        generateResponse,
        201,
        'generate November slots',
      )) as {
        slotsCreated: number;
      };
      if (generateBody.slotsCreated !== 90) {
        throw new Error(`Expected 90 slots for November, got ${JSON.stringify(generateBody)}`);
      }

      const detailResponse = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId2),
      );
      const detail = (await expectStatus(detailResponse, 200, 'get November roster')) as {
        slots: { id: string; onDate: string; kind: string }[];
      };
      const day1Morning = detail.slots.find(
        (s) => s.onDate === '2026-11-01' && s.kind === 'morning',
      );
      const day2Morning = detail.slots.find(
        (s) => s.onDate === '2026-11-02' && s.kind === 'morning',
      );
      if (day1Morning === undefined || day2Morning === undefined) {
        throw new Error('Expected morning slots on 2026-11-01 and 2026-11-02');
      }

      const assign1 = await assignmentsRoute.POST(
        jsonRequest(
          'POST',
          { shiftSlotId: day1Morning.id, doctorId },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const assignment1 = (await expectStatus(assign1, 201, 'assign day 1')) as { id: string };
      assignmentId1 = assignment1.id;

      const assign2 = await assignmentsRoute.POST(
        jsonRequest(
          'POST',
          { shiftSlotId: day2Morning.id, doctorId },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const assignment2 = (await expectStatus(assign2, 201, 'assign day 2')) as { id: string };
      assignmentId2 = assignment2.id;
    });

    await step(
      'RequestSwap refuses a draft roster; PublishRoster moves it to PUBLISHED',
      async () => {
        const tooEarly = await swapRequestsRoute.POST(
          jsonRequest(
            'POST',
            { shiftAssignmentId: assignmentId1, requestedDoctorId: secondDoctorId },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(tooEarly, 409, 'request a swap on a draft roster');

        const publishResponse = await publishRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId2),
        );
        await expectStatus(publishResponse, 200, 'publish November roster');
      },
    );

    let firstSwapRequestId = '';

    await step('RequestSwap rejects a no-op, then creates a pending request', async () => {
      const noOp = await swapRequestsRoute.POST(
        jsonRequest(
          'POST',
          { shiftAssignmentId: assignmentId1, requestedDoctorId: doctorId },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      await expectStatus(noOp, 400, 'request a swap to the same doctor');

      const response = await swapRequestsRoute.POST(
        jsonRequest(
          'POST',
          {
            shiftAssignmentId: assignmentId1,
            requestedDoctorId: secondDoctorId,
            reason: 'covering a leave day',
          },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const body = (await expectStatus(response, 201, 'request a swap')) as {
        id: string;
        status: string;
      };
      if (body.status !== 'pending') {
        throw new Error(`Expected 'pending', got ${body.status}`);
      }
      firstSwapRequestId = body.id;

      const duplicate = await swapRequestsRoute.POST(
        jsonRequest(
          'POST',
          { shiftAssignmentId: assignmentId1, requestedDoctorId: secondDoctorId },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      await expectStatus(duplicate, 409, 'a second pending request for the same assignment');
    });

    await step('GET swap-requests filters by status', async () => {
      const response = await swapRequestsRoute.GET(
        new Request('http://localhost/test?status=pending', {
          headers: { 'x-tenant-id': practiceId },
        }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'list pending swap requests')) as {
        swapRequests: { id: string }[];
      };
      if (body.swapRequests.length !== 1 || body.swapRequests[0]?.id !== firstSwapRequestId) {
        throw new Error(`Expected exactly the one pending request, got ${JSON.stringify(body)}`);
      }
    });

    await step('RejectSwap declines it, and it cannot be decided twice', async () => {
      const response = await rejectSwapRoute.POST(
        jsonRequest(
          'POST',
          { rejectionReason: 'not needed after all' },
          { 'x-tenant-id': practiceId },
        ),
        swapRequestParams(practiceId, firstSwapRequestId),
      );
      const body = (await expectStatus(response, 200, 'reject the swap')) as { status: string };
      if (body.status !== 'rejected') {
        throw new Error(`Expected 'rejected', got ${body.status}`);
      }

      const rejectAgain = await rejectSwapRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        swapRequestParams(practiceId, firstSwapRequestId),
      );
      await expectStatus(rejectAgain, 409, 're-reject an already-rejected request');

      const approveRejected = await approveSwapRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        swapRequestParams(practiceId, firstSwapRequestId),
      );
      await expectStatus(approveRejected, 409, 'approve a rejected request');
    });

    let secondSwapRequestId = '';

    await step('ApproveSwap changes the doctor and chains a new version', async () => {
      const publishedRoster = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId2),
      );
      const publishedBody = (await expectStatus(
        publishedRoster,
        200,
        'reread published roster',
      )) as {
        status: string;
      };
      if (publishedBody.status !== 'published') {
        throw new Error(`Expected still 'published', got ${publishedBody.status}`);
      }

      // The rejected request freed the assignment up for a new one -- the partial unique index
      // only blocks a second *pending* request.
      const requestResponse = await swapRequestsRoute.POST(
        jsonRequest(
          'POST',
          { shiftAssignmentId: assignmentId1, requestedDoctorId: secondDoctorId },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const request = (await expectStatus(requestResponse, 201, 'request the swap again')) as {
        id: string;
      };
      secondSwapRequestId = request.id;

      const approveResponse = await approveSwapRoute.POST(
        jsonRequest('POST', { actorId: doctorId }, { 'x-tenant-id': practiceId }),
        swapRequestParams(practiceId, secondSwapRequestId),
      );
      const approveBody = (await expectStatus(approveResponse, 200, 'approve the swap')) as {
        status: string;
        version: { versionNumber: number; hash: string; prevHash: string | null };
        ledger: { recalculated: boolean; reason?: string };
      };
      if (approveBody.status !== 'approved' || approveBody.version.versionNumber !== 2) {
        throw new Error(`Expected version 2, got ${JSON.stringify(approveBody)}`);
      }
      // Still no burden schedule configured at this point -- ApproveSwap must succeed anyway.
      if (
        approveBody.ledger.recalculated ||
        !approveBody.ledger.reason?.includes('No burden schedule')
      ) {
        throw new Error(
          `Expected the swap approval to report a skipped ledger recalculation, got ${JSON.stringify(approveBody.ledger)}`,
        );
      }

      const approveAgain = await approveSwapRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        swapRequestParams(practiceId, secondSwapRequestId),
      );
      await expectStatus(approveAgain, 409, 're-approve an already-approved request');

      const detailResponse = await rosterRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId2),
      );
      const detail = (await expectStatus(detailResponse, 200, 'get roster after swap')) as {
        slots: { id: string; assignment: { id: string; doctorId: string } | null }[];
      };
      const swapped = detail.slots.find((s) => s.assignment?.id === assignmentId1);
      if (swapped?.assignment?.doctorId !== secondDoctorId) {
        throw new Error(
          `Expected the assignment to now belong to the second doctor, got ${JSON.stringify(swapped)}`,
        );
      }
    });

    await step(
      'ApproveSwap refuses H-03, and the request stays pending after the failed attempt',
      async () => {
        const lapsedDoctorResponse = await doctorsRoute.POST(
          jsonRequest(
            'POST',
            {
              fullName: 'Doctor Outside Membership Two',
              validFrom: '2019-01-01',
              validTo: '2019-12-31',
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const lapsedDoctor = (await expectStatus(
          lapsedDoctorResponse,
          201,
          'create a lapsed doctor',
        )) as {
          id: string;
        };

        const requestResponse = await swapRequestsRoute.POST(
          jsonRequest(
            'POST',
            { shiftAssignmentId: assignmentId2, requestedDoctorId: lapsedDoctor.id },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const request = (await expectStatus(
          requestResponse,
          201,
          'request a swap to a lapsed doctor',
        )) as {
          id: string;
        };

        const approveResponse = await approveSwapRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          swapRequestParams(practiceId, request.id),
        );
        await expectStatus(approveResponse, 400, 'approve a swap violating H-03');

        const listResponse = await swapRequestsRoute.GET(
          new Request('http://localhost/test?status=pending', {
            headers: { 'x-tenant-id': practiceId },
          }),
          params(practiceId),
        );
        const listBody = (await expectStatus(
          listResponse,
          200,
          'list pending after a failed approve',
        )) as {
          swapRequests: { id: string }[];
        };
        if (listBody.swapRequests.every((r) => r.id !== request.id)) {
          throw new Error('Expected the swap request to still be pending after the failed approve');
        }
      },
    );

    await step('RequestSwap and ApproveSwap 404 on unknown ids, and journal neither', async () => {
      const before = await commandJournalRoute.GET(
        new Request('http://localhost/test?limit=500', { headers: { 'x-tenant-id': practiceId } }),
        params(practiceId),
      );
      const beforeCount = (
        (await expectStatus(before, 200, 'journal count before')) as { commands: unknown[] }
      ).commands.length;

      const badAssignment = await swapRequestsRoute.POST(
        jsonRequest(
          'POST',
          {
            shiftAssignmentId: '00000000-0000-0000-0000-000000000000',
            requestedDoctorId: doctorId,
          },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      await expectStatus(badAssignment, 404, 'request a swap on a nonexistent assignment');

      const badSwap = await approveSwapRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        swapRequestParams(practiceId, '00000000-0000-0000-0000-000000000000'),
      );
      await expectStatus(badSwap, 404, 'approve a nonexistent swap request');

      // 404 -- no entity to attribute the attempt to -- is deliberately not journaled
      // (classifyOutcome, lib/server/command-journal.ts). Confirmed, not assumed.
      const after = await commandJournalRoute.GET(
        new Request('http://localhost/test?limit=500', { headers: { 'x-tenant-id': practiceId } }),
        params(practiceId),
      );
      const afterCount = (
        (await expectStatus(after, 200, 'journal count after')) as { commands: unknown[] }
      ).commands.length;
      if (afterCount !== beforeCount) {
        throw new Error(
          `Expected two 404s to add nothing to the journal, went from ${String(beforeCount)} to ${String(afterCount)}`,
        );
      }
    });

    await step(
      'GET notifications shows RosterPublished and SwapApproved, all still pending',
      async () => {
        const response = await notificationsRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        const body = (await expectStatus(response, 200, 'list notifications')) as {
          notifications: { doctorId: string; eventType: string; status: string }[];
        };
        const hasPublished = body.notifications.some((n) => n.eventType === 'RosterPublished');
        const hasSwapForOld = body.notifications.some(
          (n) => n.eventType === 'SwapApproved' && n.doctorId === doctorId,
        );
        const hasSwapForNew = body.notifications.some(
          (n) => n.eventType === 'SwapApproved' && n.doctorId === secondDoctorId,
        );
        if (!hasPublished || !hasSwapForOld || !hasSwapForNew) {
          throw new Error(
            `Expected RosterPublished and SwapApproved (both doctors), got ${JSON.stringify(
              body.notifications.map((n) => ({ doctorId: n.doctorId, eventType: n.eventType })),
            )}`,
          );
        }
        if (body.notifications.some((n) => n.status !== 'pending')) {
          throw new Error(
            "Expected every notification to still be 'pending' -- nothing sends them yet",
          );
        }

        const sentResponse = await notificationsRoute.GET(
          new Request('http://localhost/test?status=sent', {
            headers: { 'x-tenant-id': practiceId },
          }),
          params(practiceId),
        );
        const sentBody = (await expectStatus(sentResponse, 200, 'list sent notifications')) as {
          notifications: unknown[];
        };
        if (sentBody.notifications.length !== 0) {
          throw new Error(`Expected no 'sent' notifications, got ${JSON.stringify(sentBody)}`);
        }
      },
    );

    let icsToken = '';

    await step(
      'POST ics-feed mints a token; the public feed serves a valid VCALENDAR',
      async () => {
        const mintResponse = await icsFeedRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          doctorParams(practiceId, secondDoctorId),
        );
        const mintBody = (await expectStatus(mintResponse, 201, 'mint ics feed')) as {
          token: string;
          sequence: number;
        };
        if (mintBody.sequence !== 0) {
          throw new Error(
            `Expected a freshly minted feed to start at sequence 0, got ${String(mintBody.sequence)}`,
          );
        }
        icsToken = mintBody.token;

        const feedResponse = await icsPublicRoute.GET(jsonRequest('GET'), tokenParams(icsToken));
        if (feedResponse.status !== 200) {
          throw new Error(
            `Expected the public feed to return 200, got ${String(feedResponse.status)}`,
          );
        }
        if (feedResponse.headers.get('content-type') !== 'text/calendar; charset=utf-8') {
          throw new Error(
            `Unexpected content-type: ${String(feedResponse.headers.get('content-type'))}`,
          );
        }
        const calendarText = await feedResponse.text();
        if (
          !calendarText.startsWith('BEGIN:VCALENDAR') ||
          !calendarText.includes('END:VCALENDAR')
        ) {
          throw new Error(`Doesn't look like a VCALENDAR document:\n${calendarText.slice(0, 200)}`);
        }
        // The second doctor holds exactly one assignment at this point -- the one won in the swap.
        const veventCount = (calendarText.match(/BEGIN:VEVENT/g) ?? []).length;
        if (veventCount !== 1) {
          throw new Error(
            `Expected exactly 1 VEVENT, got ${String(veventCount)}:\n${calendarText}`,
          );
        }
        if (!calendarText.includes('SEQUENCE:0')) {
          throw new Error("Expected SEQUENCE:0 on a feed that hasn't been bumped yet");
        }
      },
    );

    await step('Regenerating the token revokes the old one immediately', async () => {
      const remintResponse = await icsFeedRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        doctorParams(practiceId, secondDoctorId),
      );
      const remintBody = (await expectStatus(remintResponse, 201, 'regenerate ics token')) as {
        token: string;
      };
      if (remintBody.token === icsToken) {
        throw new Error('Expected a different token after regenerating');
      }

      const oldFeedResponse = await icsPublicRoute.GET(jsonRequest('GET'), tokenParams(icsToken));
      if (oldFeedResponse.status !== 404) {
        throw new Error(
          `Expected the old token to be revoked (404), got ${String(oldFeedResponse.status)}`,
        );
      }

      icsToken = remintBody.token;
      const newFeedResponse = await icsPublicRoute.GET(jsonRequest('GET'), tokenParams(icsToken));
      if (newFeedResponse.status !== 200) {
        throw new Error(`Expected the new token to work, got ${String(newFeedResponse.status)}`);
      }
    });

    await step('DELETE ics-feed revokes it, and a revoked/unknown token 404s', async () => {
      const revokeResponse = await icsFeedRoute.DELETE(
        jsonRequest('DELETE', undefined, { 'x-tenant-id': practiceId }),
        doctorParams(practiceId, secondDoctorId),
      );
      await expectStatus(revokeResponse, 200, 'revoke ics feed');

      const revokedFeedResponse = await icsPublicRoute.GET(
        jsonRequest('GET'),
        tokenParams(icsToken),
      );
      if (revokedFeedResponse.status !== 404) {
        throw new Error(
          `Expected the revoked token to 404, got ${String(revokedFeedResponse.status)}`,
        );
      }

      const revokeAgainResponse = await icsFeedRoute.DELETE(
        jsonRequest('DELETE', undefined, { 'x-tenant-id': practiceId }),
        doctorParams(practiceId, secondDoctorId),
      );
      await expectStatus(revokeAgainResponse, 404, 'revoke an already-revoked feed');
    });

    await step('POST ics-feed 404s for a doctor with no membership in this practice', async () => {
      const response = await icsFeedRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        doctorParams(practiceId, '00000000-0000-0000-0000-000000000000'),
      );
      await expectStatus(response, 404, 'mint a feed for a nonexistent doctor');
    });

    await step('POST ledger/recalculate refuses to run with no schedule configured', async () => {
      const response = await ledgerRecalculateRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      await expectStatus(response, 400, 'recalculate with no burden schedule');
    });

    await step('POST burden-schedules rejects a schedule with no catch-all rule', async () => {
      const response = await burdenSchedulesRoute.POST(
        jsonRequest(
          'POST',
          {
            version: 'broken',
            validFrom: '2026-01-01',
            confidence: 'ASSUMED',
            rules: [
              {
                label: 'weekday night only',
                match: { dayClass: 'weekday', shiftKind: 'night' },
                weight: 2.5,
              },
            ],
          },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      await expectStatus(response, 400, 'schedule with no catch-all');
    });

    await step(
      'POST burden-schedules creates the tenant’s own schedule; GET lists it as active',
      async () => {
        const response = await burdenSchedulesRoute.POST(
          jsonRequest(
            'POST',
            {
              version: 'synthetic-v1',
              validFrom: '2026-01-01',
              confidence: 'ASSUMED',
              rules: [
                {
                  label: 'weekday night',
                  match: { dayClass: 'weekday', shiftKind: 'night' },
                  weight: 2.5,
                },
                { label: 'Friday from 17:00', match: { weekday: 5, fromHour: 17 }, weight: 3 },
                { label: 'weekday daytime', match: {}, weight: 1 },
              ],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const body = (await expectStatus(response, 201, 'create burden schedule')) as {
          id: string;
          version: string;
        };
        if (body.version !== 'synthetic-v1') {
          throw new Error(`Unexpected version: ${body.version}`);
        }

        const listResponse = await burdenSchedulesRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        const listBody = (await expectStatus(listResponse, 200, 'list burden schedules')) as {
          burdenSchedules: { id: string; active: boolean; validTo: string | null }[];
        };
        const created = listBody.burdenSchedules.find((s) => s.id === body.id);
        if (created?.active !== true || created.validTo !== null) {
          throw new Error(`Expected the new schedule to be active, got ${JSON.stringify(created)}`);
        }
      },
    );

    await step(
      "A 'requested' assignment is priced but excluded from equalisable burden",
      async () => {
        // The core claim behind provenance (docs/domain/fairness.md): `requested` burden must be
        // reported (counted in `burden`) but excluded from equalisation (`equalisableBurden`).
        // `lib/analytics/ledger.ts` already gets this right in isolation; this proves the real
        // API + DB path delivers it too, not just a unit test.
        const before = await ledgerRecalculateRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        const beforeBody = (await expectStatus(before, 200, 'recalculate before')) as {
          entries: { doctorId: string; burden: number; equalisableBurden: number }[];
        };
        const beforeEntry = beforeBody.entries.find((e) => e.doctorId === doctorId);
        if (beforeEntry === undefined) {
          throw new Error('Expected an existing ledger entry for the main doctor');
        }

        const rosterResponse = await rostersRoute.POST(
          jsonRequest('POST', { month: '2026-12' }, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        const roster = (await expectStatus(rosterResponse, 201, 'create December roster')) as {
          id: string;
        };
        const rosterId3 = roster.id;

        await slotsRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId3),
        );
        const detailResponse = await rosterRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId3),
        );
        const detail = (await expectStatus(detailResponse, 200, 'get December roster')) as {
          slots: { id: string; onDate: string; kind: string }[];
        };
        // A 'morning' slot never matches the night rule (shiftKind) or the Friday-from-17:00 rule
        // (fromHour), whichever weekday it lands on -- it always prices at the 1.0 catch-all,
        // which is what makes the arithmetic below predictable without knowing December's calendar.
        const morningSlot = detail.slots.find(
          (s) => s.onDate === '2026-12-01' && s.kind === 'morning',
        );
        if (morningSlot === undefined) {
          throw new Error('Expected a morning slot on 2026-12-01');
        }

        const assignResponse = await assignmentsRoute.POST(
          jsonRequest(
            'POST',
            { shiftSlotId: morningSlot.id, doctorId, provenance: 'requested' },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const assignBody = (await expectStatus(assignResponse, 201, 'assign as requested')) as {
          provenance: string;
        };
        if (assignBody.provenance !== 'requested') {
          throw new Error(
            `Expected the assignment to record 'requested', got ${assignBody.provenance}`,
          );
        }

        const publishResponse = await publishRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId3),
        );
        await expectStatus(publishResponse, 200, 'publish December');

        const after = await ledgerRecalculateRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        const afterBody = (await expectStatus(after, 200, 'recalculate after')) as {
          entries: {
            doctorId: string;
            shifts: number;
            burden: number;
            equalisableBurden: number;
          }[];
        };
        const afterEntry = afterBody.entries.find((e) => e.doctorId === doctorId);
        if (afterEntry === undefined) {
          throw new Error('Expected the ledger entry to still exist after the new assignment');
        }

        if (afterEntry.burden !== beforeEntry.burden + 1) {
          throw new Error(
            `Expected raw burden to grow by the shift's weight (1), got ${String(beforeEntry.burden)} -> ${String(afterEntry.burden)}`,
          );
        }
        if (afterEntry.equalisableBurden !== beforeEntry.equalisableBurden) {
          throw new Error(
            `Expected equalisable burden UNCHANGED ('requested' is excluded), got ${String(beforeEntry.equalisableBurden)} -> ${String(afterEntry.equalisableBurden)}`,
          );
        }
      },
    );

    await step('ApproveSwap auto-recalculates the ledger now that a schedule exists', async () => {
      // assignmentId1 now belongs to secondDoctorId (the earlier swap) and has no pending
      // request outstanding -- swap it back to doctorId. PublishRoute uses the identical
      // tryRecalculateLedger helper, so proving it here proves both wiring points.
      const requestResponse = await swapRequestsRoute.POST(
        jsonRequest(
          'POST',
          { shiftAssignmentId: assignmentId1, requestedDoctorId: doctorId },
          { 'x-tenant-id': practiceId },
        ),
        params(practiceId),
      );
      const request = (await expectStatus(requestResponse, 201, 'request a third swap')) as {
        id: string;
      };

      const approveResponse = await approveSwapRoute.POST(
        jsonRequest('POST', { actorId: doctorId }, { 'x-tenant-id': practiceId }),
        swapRequestParams(practiceId, request.id),
      );
      const approveBody = (await expectStatus(approveResponse, 200, 'approve the third swap')) as {
        ledger: { recalculated: boolean; scheduleVersion?: string | null };
      };
      if (
        !approveBody.ledger.recalculated ||
        approveBody.ledger.scheduleVersion !== 'synthetic-v1'
      ) {
        throw new Error(
          `Expected the approval to auto-recalculate against the tenant's schedule, got ${JSON.stringify(approveBody.ledger)}`,
        );
      }

      const ledgerResponse = await ledgerRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const ledgerBody = (await expectStatus(ledgerResponse, 200, 'get ledger after swap')) as {
        entries: { doctorId: string; burden: number }[];
      };
      if (ledgerBody.entries.length === 0) {
        throw new Error('Expected the auto-recalculation to have persisted burden_credit rows');
      }
    });

    await step(
      "ApproveSwap uses the request's own provenance, not a hard-coded 'directed'",
      async () => {
        // assignmentId1 belongs to doctorId again after the previous step. Request this one as
        // 'absorbed' -- nobody else was available -- and confirm the resulting assignment says so,
        // closing the gap `0015_swap_request_provenance.sql` exists to fix.
        const requestResponse = await swapRequestsRoute.POST(
          jsonRequest(
            'POST',
            {
              shiftAssignmentId: assignmentId1,
              requestedDoctorId: secondDoctorId,
              provenance: 'absorbed',
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        const request = (await expectStatus(requestResponse, 201, 'request a fourth swap')) as {
          id: string;
          provenance: string;
        };
        if (request.provenance !== 'absorbed') {
          throw new Error(`Expected the request to record 'absorbed', got ${request.provenance}`);
        }

        const approveResponse = await approveSwapRoute.POST(
          jsonRequest('POST', { actorId: doctorId }, { 'x-tenant-id': practiceId }),
          swapRequestParams(practiceId, request.id),
        );
        await expectStatus(approveResponse, 200, 'approve the fourth swap');

        const detailResponse = await rosterRoute.GET(
          jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
          rosterParams(practiceId, rosterId2),
        );
        const detail = (await expectStatus(
          detailResponse,
          200,
          'get roster after fourth swap',
        )) as {
          slots: { assignment: { id: string; doctorId: string; provenance: string } | null }[];
        };
        const swapped = detail.slots.find((s) => s.assignment?.id === assignmentId1);
        if (
          swapped?.assignment?.doctorId !== secondDoctorId ||
          swapped.assignment.provenance !== 'absorbed'
        ) {
          throw new Error(
            `Expected the reassigned shift to carry 'absorbed', not the old hard-coded 'directed', got ${JSON.stringify(swapped)}`,
          );
        }
      },
    );

    await step('POST ledger/recalculate rebuilds burden_credit and is idempotent', async () => {
      const response = await ledgerRecalculateRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'recalculate ledger')) as {
        assignmentsProcessed: number;
        totalBurden: number;
        scheduleVersion: string | null;
        entries: { doctorId: string; shifts: number; burden: number; loadRatio: number | null }[];
      };
      if (body.assignmentsProcessed === 0) {
        throw new Error('Expected at least one assignment to have been processed');
      }
      if (body.scheduleVersion !== 'synthetic-v1') {
        throw new Error(
          `Expected the tenant's own schedule to be used, got ${String(body.scheduleVersion)}`,
        );
      }
      const doctorEntry = body.entries.find((e) => e.doctorId === doctorId);
      if (doctorEntry === undefined || doctorEntry.shifts === 0) {
        throw new Error(
          `Expected an entry for the main doctor, got ${JSON.stringify(body.entries)}`,
        );
      }

      const secondResponse = await ledgerRecalculateRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const secondBody = (await expectStatus(secondResponse, 200, 'recalculate again')) as {
        totalBurden: number;
      };
      if (secondBody.totalBurden !== body.totalBurden) {
        throw new Error(
          `Expected recalculation to be idempotent, got ${String(body.totalBurden)} then ${String(secondBody.totalBurden)}`,
        );
      }
    });

    await step('GET ledger reads the persisted totals', async () => {
      const response = await ledgerRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'get ledger')) as {
        entries: { doctorId: string; doctorName: string; shifts: number; burden: number }[];
      };
      const doctorEntry = body.entries.find((e) => e.doctorId === doctorId);
      if (doctorEntry === undefined || doctorEntry.burden <= 0) {
        throw new Error(
          `Expected a positive burden entry for the main doctor, got ${JSON.stringify(body.entries)}`,
        );
      }
    });

    await step(
      'A schedule change is refused if it would be backdated before the open one',
      async () => {
        const response = await burdenSchedulesRoute.POST(
          jsonRequest(
            'POST',
            {
              version: 'too-early',
              validFrom: '2025-06-01',
              confidence: 'ASSUMED',
              rules: [{ label: 'flat', match: {}, weight: 1 }],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(response, 409, 'backdate a schedule before the open one');
      },
    );

    await step(
      'A new schedule starting mid-history makes recalculation refuse to span it',
      async () => {
        // November's two assignment dates are 2026-11-01 and 2026-11-02. Starting the next version
        // exactly on the second date splits them across two schedule versions.
        const response = await burdenSchedulesRoute.POST(
          jsonRequest(
            'POST',
            {
              version: 'synthetic-v2',
              validFrom: '2026-11-02',
              confidence: 'ASSUMED',
              rules: [{ label: 'flat', match: {}, weight: 1 }],
            },
            { 'x-tenant-id': practiceId },
          ),
          params(practiceId),
        );
        await expectStatus(response, 201, 'create a second schedule version');

        const recalcResponse = await ledgerRecalculateRoute.POST(
          jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
          params(practiceId),
        );
        await expectStatus(recalcResponse, 409, 'recalculate spanning two schedule versions');
      },
    );

    await step('GET command-journal lists journalled commands, most recent first', async () => {
      const response = await commandJournalRoute.GET(
        new Request(`http://localhost/test?rosterId=${rosterId2}`, {
          headers: { 'x-tenant-id': practiceId },
        }),
        params(practiceId),
      );
      const body = (await expectStatus(response, 200, 'list command journal')) as {
        commands: {
          commandType: string;
          outcome: string;
          rosterId: string | null;
          actorId: string | null;
          actorName: string | null;
          reason: string | null;
          issuedAt: string;
        }[];
      };
      if (body.commands.length === 0) {
        throw new Error('Expected at least one journalled command for the November roster');
      }
      if (body.commands.some((c) => c.rosterId !== rosterId2)) {
        throw new Error(
          `Expected every row scoped to ${rosterId2}, got ${JSON.stringify(body.commands)}`,
        );
      }
      // Refusals from earlier in this sequence (journalRefusal, lib/server/command-journal.ts)
      // must all be here too -- an application-level conflict, an application-level no-op check,
      // and an H-03 constraint violation, each with a real reason, not a generic one.
      const refused = body.commands.filter((c) => c.outcome === 'refused');
      if (refused.length < 3) {
        throw new Error(`Expected several refused rows, got ${JSON.stringify(refused)}`);
      }
      const h03Refusal = refused.find((c) => c.commandType === 'ApproveSwap');
      if (h03Refusal?.reason?.includes('H-03') !== true) {
        throw new Error(`Expected an H-03 refusal reason, got ${JSON.stringify(h03Refusal)}`);
      }
      const noOpRefusal = refused.find((c) => c.reason?.includes('already holds this assignment'));
      if (noOpRefusal === undefined) {
        throw new Error(`Expected the no-op RequestSwap refusal, got ${JSON.stringify(refused)}`);
      }
      if (refused.some((c) => c.outcome !== 'refused' || c.commandType.length === 0)) {
        throw new Error(
          `Expected every refused row to name a real command, got ${JSON.stringify(refused)}`,
        );
      }
      const timestamps = body.commands.map((c) => c.issuedAt);
      const sorted = [...timestamps].sort().reverse();
      if (JSON.stringify(timestamps) !== JSON.stringify(sorted)) {
        throw new Error('Expected commands ordered most-recent-first');
      }
      const approved = body.commands.find((c) => c.commandType === 'ApproveSwap');
      if (approved?.actorId !== doctorId || approved.actorName === null) {
        throw new Error(
          `Expected an ApproveSwap row attributed to the main doctor with a joined name, got ${JSON.stringify(approved)}`,
        );
      }
    });

    await step('GET diagnostic-bundle assembles the L5 bundle for a roster', async () => {
      const response = await diagnosticBundleRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, rosterId2),
      );
      const body = (await expectStatus(response, 200, 'get diagnostic bundle')) as {
        appVersion: string;
        schemaVersion: string | null;
        roster: { id: string; status: string; activeRosterVersion: number | null };
        recentCommands: { commandType: string }[];
        notIncluded: { viewState: string; recentErrors: string };
      };
      if (body.appVersion.length === 0 || body.schemaVersion === null) {
        throw new Error(`Expected non-empty version info, got ${JSON.stringify(body)}`);
      }
      if (body.roster.id !== rosterId2 || body.roster.status !== 'published') {
        throw new Error(
          `Expected the November roster, published, got ${JSON.stringify(body.roster)}`,
        );
      }
      if (body.roster.activeRosterVersion === null || body.roster.activeRosterVersion < 1) {
        throw new Error(`Expected a real active version, got ${JSON.stringify(body.roster)}`);
      }
      if (body.recentCommands.length === 0) {
        throw new Error('Expected the bundle to include recent commands');
      }
      if (body.notIncluded.viewState.length === 0 || body.notIncluded.recentErrors.length === 0) {
        throw new Error(
          `Expected the known gaps named explicitly, got ${JSON.stringify(body.notIncluded)}`,
        );
      }

      const missing = await diagnosticBundleRoute.GET(
        jsonRequest('GET', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, '00000000-0000-0000-0000-000000000000'),
      );
      await expectStatus(missing, 404, 'diagnostic bundle for an unknown roster');
    });

    await step('L2: an unanticipated error is recorded, correlated to the tenant', async () => {
      // A malformed (but non-empty, so Zod-valid) rosterId reaches the database as a genuine
      // 22P02 invalid-uuid-syntax error -- one of the four SQLSTATEs `toErrorResponse` recognises
      // by name is NOT this one, so it falls all the way through to the generic-500 branch that
      // now calls `recordError` (lib/server/error-record.ts), the real path a bug takes, not a
      // synthetic hook added just for this test.
      const response = await publishRoute.POST(
        jsonRequest('POST', undefined, { 'x-tenant-id': practiceId }),
        rosterParams(practiceId, 'not-a-valid-uuid'),
      );
      const body = await expectStatus(response, 500, 'publish with a malformed roster id');
      if (
        JSON.stringify(body) !==
        JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.' } })
      ) {
        throw new Error(`Expected the generic 500 shape, got ${JSON.stringify(body)}`);
      }

      const recorded = await withTenant(practiceId, (client) =>
        client.query<{
          exception_type: string;
          exception_message: string;
          source: string;
          route: string | null;
          app_version: string | null;
        }>(
          `select exception_type, exception_message, source, route, app_version
           from error_record
           where tenant_id = $1
           order by occurred_at desc
           limit 1`,
          [practiceId],
        ),
      );
      const row = recorded.rows[0];
      // `route` reflects `request.url`, and `jsonRequest` (this harness) always constructs
      // `http://localhost/test` regardless of the real path being exercised -- so `/test` here
      // proves the field was threaded through correctly, not that it holds a realistic path.
      if (
        row?.source !== 'server' ||
        row.route !== '/test' ||
        row.app_version === null ||
        !row.exception_message.toLowerCase().includes('uuid')
      ) {
        throw new Error(
          `Expected a correlated, uuid-syntax error record, got ${JSON.stringify(row)}`,
        );
      }
    });

    console.log('\nAll API checks passed.');
  } finally {
    console.log('Closing the connection pool and discarding the throwaway cluster ...');
    await resetPoolForTests();
    cluster.stop();
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error('\napi:check FAILED');
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  cluster.stop();
  process.exit(1);
}
