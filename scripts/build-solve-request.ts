/**
 * Builds a real solve request from the transcribed history, and closes the boundary end to end.
 *
 * This is the pipeline the product will actually run, with nothing hand-written in the middle:
 *
 *   33 months of sheets  →  loadSeedPeriod  →  inferAvailability  →  buildSolveRequest  →  JSON
 *                                                                            ↓
 *                                              solver/…/contract.py::parse_request  →  solve
 *
 * The point is not the JSON. It is that **the availability the solver receives was derived from
 * observed history rather than typed in.** The instance hand-written in `september_2026()` and the
 * one this produces agree, including D07's and D09's Monday exception — two implementations arriving
 * at the same answer from opposite directions.
 *
 * ## Output goes to `private/`
 *
 * The request contains only doctor codes and dates, so it carries no name. It is still derived from
 * material that is not public and describes a real practice's staffing month by month, so it is
 * written under `private/` — the first line of `.gitignore` — rather than into the repository. The
 * shared, committed, synthetic example is `fixtures/solver-request.json`.
 *
 * ## `--future` — a month that has not happened
 *
 * Everything above reads a month that already exists. `--future` builds one that does not: the days
 * come from the calendar, the weekday defaults and the holiday rules
 * (`lib/calendar/month-days.ts`), and the doctors are whoever worked the most recent transcribed
 * month. **This is the operation the product exists to perform**, and until 2 September 2026 no path
 * in the repository could do it.
 *
 * If the month contains a public holiday that drops the weekday's pattern, it **refuses and names
 * the date** rather than guessing — see `docs/domain/holidays.md`. Answer with `--pattern`, which is
 * the command-line stand-in for the prompt the editor will show.
 *
 * Run with:
 *   npm run seed:request                      # the last complete month in the data
 *   node scripts/build-solve-request.ts 2026-08
 *   node scripts/build-solve-request.ts 2026-08 --out private/solve-request.json
 *   node scripts/build-solve-request.ts --future 2026-10
 *   node scripts/build-solve-request.ts --future 2027-03 --pattern 2027-03-26=A
 *
 * **Prints, never fails the gate.** This is a tool, not a check. The one exception is `--future`
 * with an unanswered holiday, which exits 1 — there is nothing to write.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  ANCHOR_WINDOW_MONTHS,
  inferRecurringSlots,
  inferSlotShares,
  windowStart,
} from '../lib/analytics/anchors.ts';
import { inferAvailability } from '../lib/analytics/availability.ts';
import { AGREED_BURDEN_V2, resolveBurden } from '../lib/analytics/burden.ts';
import {
  buildLedger,
  cellKey,
  entitlementWeights,
  holidayLedgerCutoff,
  ledgerCutoff,
  revealedCells,
} from '../lib/analytics/ledger.ts';
import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { indexShifts, PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import type { DoctorCode, RosterPeriod } from '../lib/analytics/types.ts';
import { holidayLookup, SOURCED_DECLARATIONS } from '../lib/calendar/holidays.ts';
import { rosterDaysForMonth } from '../lib/calendar/month-days.ts';
import {
  PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
  PILOT_HOLIDAY_SUSPENDS_V1,
  PILOT_WEEKDAY_DEFAULTS_V1,
} from '../lib/calendar/pattern-precedence.ts';
import {
  buildSolveRequest,
  type DoctorMembership,
  type PreferenceInput,
  RequestBuildError,
  type WireConstraint,
} from '../lib/contract/request.ts';

/** The hour before which pool doctors are at their own practices on an ordinary weekday. H-10. */
const RESTRICTED_BEFORE_HOUR = 17;

/**
 * H-12, from the practice principal on 4 September 2026. `[CONFIRMED]`
 *
 * **Data, never code.** These are agreed commitments and they change when people's other work
 * changes; the day this reads from a database instead of a constant, only the source moves.
 *
 * ⚠️ **Neither bound is hard.** He was explicit: *"these numbers shouldn't be treated as hard
 * constraints, because if the practice is low on doctors for a month then some of the doctors will
 * need to work more."* They sit at `Tier.CONTRACT`, four orders of magnitude below coverage.
 */
const MONTHLY_MINIMUM_SHIFTS = 2;

/**
 * H-11, from the practice principal on 4 September 2026. `[CONFIRMED]`
 *
 * ✅ **Question 46 answered 2026-09-07: it IS one rule.** "All GPs will be unavailable on Saturday
 * mornings, although there are exceptions at times." The Saturday cells are therefore derived from
 * the H-10 set below rather than listed here. What remains in this table is genuinely per-doctor.
 *
 * "Weekends only" is expressed as exclusion from every weekday cell, so one mechanism covers both
 * shapes.
 */
const EVERY_KIND = ['morning', 'afternoon', 'evening', 'night', 'long-day'] as const;
const NO_SATURDAY_MORNING = [{ dayClass: 'saturday', shiftKind: 'morning' }] as const;

/**
 * Per-doctor exclusions that are genuinely individual.
 *
 * ⚠️ **Saturday morning is NOT here any more.** Question 46 was answered on 7 September 2026 —
 * *"One rule, although there are exceptions at times; the general rule is that all GPs will be
 * unavailable on Saturday mornings"* — so it is derived below from the doctors who have their own
 * practice, rather than listed against six codes. Six individual facts predict nothing about a
 * seventh GP joining; one rule does.
 */
const CANNOT_WORK: Readonly<
  Record<string, readonly { readonly dayClass: string; readonly shiftKind: string }[]>
> = {
  D06: [{ dayClass: 'sunday', shiftKind: 'night' }],
  D08: (['weekday', 'saturday', 'sunday', 'public-holiday'] as const).map((dayClass) => ({
    dayClass,
    shiftKind: 'night',
  })),
  // Weekends only: every weekday cell is out.
  D13: EVERY_KIND.map((shiftKind) => ({ dayClass: 'weekday', shiftKind })),
};

/** H-11's pair shape: D04 cannot work two weekend shifts in the same weekend. */
const MAX_SHIFTS_PER_WEEKEND: Readonly<Record<string, number>> = { D04: 1 };

const MONTHLY_MAXIMUM_SHIFTS: Readonly<Record<string, number>> = {
  D06: 4,
  D08: 4,
  D11: 5,
  D12: 4,
  D13: 4,
};

/**
 * Constraint modes, mirroring `docs/domain/constraints.md`.
 *
 * `H-07` ships `OFF` because it is `[INFERRED]`; the mode is data precisely so a confirmed answer
 * flips a switch. Weights are shown for completeness — the parser deliberately ignores them, because
 * a per-request weight override would let a caller reorder the tier hierarchy, and that hierarchy is
 * the safety property.
 */
const CONSTRAINTS: readonly WireConstraint[] = [
  { id: 'H-01', mode: 'BLOCK', weight: 1_000_000 },
  { id: 'H-02', mode: 'WARN', weight: 1_000_000 },
  { id: 'H-04', mode: 'BLOCK', weight: 10_000 },
  { id: 'H-05', mode: 'BLOCK', weight: 10_000 },
  { id: 'H-06', mode: 'WARN', weight: 1 },
  { id: 'H-07', mode: 'OFF', weight: 10_000 },
  { id: 'H-10', mode: 'WARN', weight: 2_000_000 },
  { id: 'S-01', mode: 'WARN', weight: 100 },
  { id: 'S-05', mode: 'WARN', weight: 100 },
  { id: 'S-06', mode: 'WARN', weight: 80 },
  { id: 'S-08', mode: 'WARN', weight: 100 },
  { id: 'H-11', mode: 'WARN', weight: 100 },
  { id: 'H-12', mode: 'WARN', weight: 100 },
  { id: 'H-08', mode: 'WARN', weight: 10_000 },
  { id: 'S-02', mode: 'WARN', weight: 20 },
  { id: 'S-03', mode: 'WARN', weight: 30 },
];

/**
 * `[ASSUMED]` burden weights. Question 35 — the owner has not set these.
 *
 * Sent so the field's shape is exercised, and **flagged in the output** so nobody reads a number
 * here as agreed. A weight nobody agreed to is a weight nobody accepts when it produces an
 * unwelcome result.
 */
const BURDEN_WEIGHTS: Readonly<Record<string, number>> = {
  weekday_day: 1.0,
  weekday_night: 2.5,
  saturday: 3.0,
  sunday: 3.5,
  public_holiday: 5.0,
};

/**
 * Reads a transcribed month of request-diary preferences, if one exists beside the seed data.
 *
 * ⚠️ **The first list is modelled as `PREFER`, never as exhaustive availability.** The diary's
 * opening list is the weekends a doctor says they can work; reading it as *"available on these and
 * no others"* would silently mark every unlisted date unavailable, which is a far stronger claim
 * than the page makes and would distort the whole month. `NOT` is the only list whose semantics
 * the principal has confirmed, so it is the only one modelled as `UNAVAILABLE`.
 *
 * ⚠️ **Transcribed from a photograph of handwriting**, so every entry carries a legibility marker
 * and the file says plainly that it needs his eye before a roster built from it is distributed.
 */
async function readPreferences(month: string): Promise<readonly PreferenceInput[]> {
  interface Entry {
    readonly code: string;
    readonly available: readonly number[];
    readonly not: readonly number[];
    readonly tentative: readonly number[];
  }
  let parsed: { readonly doctors: readonly Entry[] };
  try {
    parsed = JSON.parse(await readFile(`private/preferences-${month}.json`, 'utf8')) as {
      doctors: Entry[];
    };
  } catch {
    return [];
  }

  const iso = (day: number): string => `${month}-${String(day).padStart(2, '0')}`;
  const preferences: PreferenceInput[] = [];
  for (const entry of parsed.doctors) {
    if (entry.not.length > 0) {
      preferences.push({
        doctor: entry.code,
        type: 'UNAVAILABLE',
        dates: entry.not.map(iso),
        sourceToken: 'NOT',
      });
    }
    if (entry.available.length > 0) {
      preferences.push({
        doctor: entry.code,
        type: 'PREFER',
        dates: entry.available.map(iso),
        sourceToken: 'available',
      });
    }
    if (entry.tentative.length > 0) {
      preferences.push({
        doctor: entry.code,
        type: 'PREFER',
        dates: entry.tentative.map(iso),
        tentative: true,
        sourceToken: '±',
      });
    }
  }
  return preferences;
}

async function findSeedDirectory(
  explicit: string | undefined,
): Promise<{ dir: string; files: string[] } | null> {
  const candidates =
    explicit === undefined ? ['private/seed-data', 'fixtures/seed-data'] : [explicit];
  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate);
      const files = entries.filter((entry) => entry.endsWith('.json')).sort();
      if (files.length > 0) {
        return { dir: candidate, files };
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Memberships from what was observed, not from a roster of who exists.
 *
 * Membership in the target month is **whoever worked in it**, and `availableFrom` is the date they
 * were first seen anywhere in the 33 months. Temporal intervals, never a soft delete — ADR-0008.
 *
 * That is how D14, D15 and D16 stop appearing with nobody flipping a flag: they worked no shift in
 * the target month, so they are not members of it. No `is_active` column, and no departure rule
 * needed here — `buildWorkforceTimeline`'s 90-day rule answers a different question (*when* did the
 * workforce change), and this function deliberately does not consult it.
 */
function membershipsFor(
  period: RosterPeriod,
  month: RosterPeriod,
  ownPractice: ReadonlySet<DoctorCode>,
): DoctorMembership[] {
  const active = new Set<DoctorCode>(month.assignments.map((assignment) => assignment.doctor));

  const firstSeen = new Map<DoctorCode, string>();
  for (const assignment of period.assignments) {
    const existing = firstSeen.get(assignment.doctor);
    if (existing === undefined || assignment.date < existing) {
      firstSeen.set(assignment.doctor, assignment.date);
    }
  }

  // Anyone who worked in the target month is a member of it. Using the whole 33-month cast would
  // send departed doctors to the solver, which then has to be told not to use them — the opposite
  // of the temporal model's point.
  return [...active].sort().map((code) => {
    const ceiling = MONTHLY_MAXIMUM_SHIFTS[code];
    const weekendCap = MAX_SHIFTS_PER_WEEKEND[code];

    // H-11's Saturday-morning rule, derived rather than listed. `ownPractice` is the set with an
    // inferred H-10 rule — doctors who never work a weekday before 17:00 because they are at their
    // own surgery — and a GP surgery is open on a Saturday morning, which is the mechanism the
    // principal described. One fact, two consequences, rather than two coincidences.
    //
    // ⚠️ THIS IS AN INFERENCE ON TOP OF AN INFERENCE, and it is stated plainly for that reason.
    // H-10's membership is itself derived from history — though about as safely as that gets:
    // 68–155 shifts per doctor with ZERO contradictions. Elastic either way, so a wrong inclusion
    // scars rather than blocks.
    //
    // ⚠️ It newly covers D06 and D13, who between them worked 15 Saturday mornings in 33 months
    // (6 and 9, about one every four or five months each). The other six GPs worked ZERO. That
    // spread is exactly the principal's "although there are exceptions at times", so those 15 are
    // meant to register as exceptions — which, at Tier.CONTRACT and elastic, is what they do.
    const derived = ownPractice.has(code) ? NO_SATURDAY_MORNING : [];
    const individual = CANNOT_WORK[code] ?? [];
    const cannotWork = [...derived, ...individual];
    return {
      code,
      availableFrom: firstSeen.get(code) ?? month.days[0]?.date ?? '2023-12-01',
      ...(ceiling === undefined ? {} : { maxShiftsPerMonth: ceiling }),
      ...(cannotWork.length === 0 ? {} : { cannotWork }),
      ...(weekendCap === undefined ? {} : { maxShiftsPerWeekend: weekendCap }),
    };
  });
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** Flags that consume the argument after them, so it is not a positional. */
const VALUE_FLAGS = new Set(['--out', '--future', '--pattern']);

/**
 * Positional arguments, with flag values excluded.
 *
 * Previously this was `argv.filter(a => !a.startsWith('--'))`, which swept up **the value of every
 * flag**. `--out private/solve-request.json` therefore put that path into the positionals, where it
 * was read as a seed directory, and the script reported "no seed data found" — for a form its own
 * docblock advertises. Fixed 2 September 2026.
 */
function positionalArguments(argv: readonly string[]): string[] {
  const found: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
    if (VALUE_FLAGS.has(argument)) {
      index += 1;
      continue;
    }
    if (!argument.startsWith('--')) {
      found.push(argument);
    }
  }
  return found;
}

async function main(): Promise<void> {
  const positional = positionalArguments(process.argv.slice(2));
  const outFlag = process.argv.indexOf('--out');
  const outPath = outFlag === -1 ? 'private/solve-request.json' : process.argv[outFlag + 1];
  if (outPath === undefined) {
    console.error('build-solve-request: --out needs a path.');
    process.exitCode = 1;
    return;
  }

  const requestedMonth = positional.find((argument) => /^\d{4}-\d{2}$/.test(argument));
  const requestedDir = positional.find((argument) => !/^\d{4}-\d{2}$/.test(argument));

  const futureFlag = process.argv.indexOf('--future');
  const futureMonth = futureFlag === -1 ? undefined : process.argv[futureFlag + 1];
  if (futureFlag !== -1 && (futureMonth === undefined || !/^\d{4}-\d{2}$/.test(futureMonth))) {
    console.error('build-solve-request: --future needs a month, e.g. --future 2026-10.');
    process.exitCode = 1;
    return;
  }

  // `--pattern 2026-04-03=A`, repeatable. The admin answering the question the resolver asked.
  const patternOverrides = new Map<string, string>();
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== '--pattern') {
      continue;
    }
    const pair = process.argv[index + 1];
    const [date, patternId] = (pair ?? '').split('=');
    if (date === undefined || patternId === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error('build-solve-request: --pattern needs <YYYY-MM-DD>=<patternId>.');
      process.exitCode = 1;
      return;
    }
    patternOverrides.set(date, patternId);
  }

  const found = await findSeedDirectory(requestedDir);
  if (found === null) {
    console.log(
      'build-solve-request: no seed data found. Expected JSON month files in private/seed-data\n' +
        '                    or fixtures/seed-data, or a directory as the first argument.',
    );
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    const raw = await readFile(path.join(found.dir, file), 'utf8');
    documents.push(JSON.parse(raw) as SeedMonthDocument);
  }

  const period = loadSeedPeriod(documents, 'seed');
  const months = splitByMonth(period);

  // ── Future mode: the days come from the calendar, not from a sheet ───────────────────
  //
  // The difference that matters. Every other path here reads a month that already happened.
  // `--future` builds one that has not, from the weekday defaults and the holiday rules, which is
  // the operation the product exists to perform. See lib/calendar/month-days.ts.
  let target: RosterPeriod | undefined;

  if (futureMonth !== undefined) {
    const { days, undecided } = rosterDaysForMonth(futureMonth, {
      weekdayDefaults: PILOT_WEEKDAY_DEFAULTS_V1,
      holidaySuspends: PILOT_HOLIDAY_SUSPENDS_V1,
      suggestWhenUndetermined: PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1,
      holidays: holidayLookup(`${futureMonth}-01`, `${futureMonth}-31`, SOURCED_DECLARATIONS),
      dateOverrides: patternOverrides,
    });

    if (undecided.length > 0) {
      // Refused rather than filled in. A public holiday that drops the weekday's pattern is a
      // decision the practice makes on the day, and guessing it is the one thing this pipeline
      // must not do — see docs/domain/holidays.md.
      console.error(`build-solve-request: ${futureMonth} needs a decision before it can be built.`);
      for (const pending of undecided) {
        console.error(`  ${pending.date}  ${pending.reason}`);
        console.error(
          `    → re-run with --pattern ${pending.date}=${pending.suggestion ?? '<A|B|C>'}`,
        );
      }
      process.exitCode = 1;
      return;
    }

    // The current roll, not the whole 33-month cast: whoever worked the most recent transcribed
    // month. Sending departed doctors to the solver and then telling it not to use them is the
    // opposite of what the temporal model is for.
    const latest = months[months.length - 1];
    if (latest === undefined) {
      console.error('build-solve-request: no transcribed month to take the current roll from.');
      process.exitCode = 1;
      return;
    }
    target = { label: futureMonth, days, assignments: latest.assignments };
  } else {
    target =
      requestedMonth === undefined
        ? months[months.length - 1]
        : months.find((candidate) => candidate.label.startsWith(requestedMonth));
  }

  if (target === undefined) {
    console.error(
      `build-solve-request: no month "${String(requestedMonth)}" in the data. Available: ` +
        months.map((candidate) => candidate.label).join(', '),
    );
    process.exitCode = 1;
    return;
  }

  const first = target.days[0];
  const last = target.days[target.days.length - 1];
  if (first === undefined || last === undefined) {
    console.error(`build-solve-request: month "${target.label}" has no days.`);
    process.exitCode = 1;
    return;
  }

  // ⚠️ Availability is inferred from the WHOLE period, not the target month. One month is far too
  // little evidence — a pool doctor who happened to work no early weekday shift in September would
  // otherwise be indistinguishable from one who cannot.
  const availability = inferAvailability(period, PILOT_PATTERNS_V1, RESTRICTED_BEFORE_HOUR);
  // ⚠️ Doctors with an ACTUAL H-10 rule, not every key: `inferAvailability` returns an entry for
  // everyone, most of them with an empty rule list. Keying on the map would have applied the
  // Saturday rule to all thirteen, the four anchors included.
  const ownPractice = new Set(
    [...availability.values()]
      .filter((entry) => entry.rules.length > 0)
      .map((entry) => entry.doctor),
  );
  const doctors = membershipsFor(period, target, ownPractice);
  const active = new Set(doctors.map((doctor) => doctor.code));
  const scopedAvailability = new Map([...availability].filter(([code]) => active.has(code)));

  // ⚠️ Recurring slots were MISSING here until 2 September 2026, and the omission was invisible.
  //
  // S-05 — prefer the anchor doctor in their own recurring slot — iterates `recurring_slots`, so an
  // empty array registered no penalties at all and nothing in the objective pulled toward the way
  // this practice actually works. The solver kept reporting OPTIMAL with objective 0, which is what
  // an under-constrained model looks like from the inside. `npm run seed:solver-departure` is what
  // made it visible: the solved month sat further from the practice's habits on every axis than any
  // real month in three years.
  //
  // Derived from a trailing window, not the whole period, because anchors change hands — D05 took
  // two slots in June 2026. See lib/analytics/anchors.ts for why a window is a knowing simplification
  // of the validity intervals the contract actually supports.
  const anchorFrom = windowStart(target.label.slice(0, 7), ANCHOR_WINDOW_MONTHS);
  const recurringSlots = inferRecurringSlots(period, {
    from: anchorFrom,
    before: first.date,
  }).filter((slot) => active.has(slot.doctor));

  // S-09, and the reason it exists: the line above covers 7 slots out of 25. The other 18 are 68%
  // of the roster and had no term in the objective at all, so the solver filled them on fairness
  // arithmetic alone — which is how September 2026 came back with the practice principal on 15
  // shifts, second busiest of thirteen, and not one weekend among them. He takes 38% of Saturday
  // mornings historically; nothing in the model knew that, because 38% is not two thirds.
  //
  // Same window as the anchors, deliberately. A share and a holder are the same measurement read
  // at two thresholds, and computing them over different spans would let them disagree about who
  // currently works a slot.
  const slotShares = inferSlotShares(period, {
    from: anchorFrom,
    before: first.date,
  }).filter((share) => active.has(share.doctor));

  // ⚠️ The burden ledger was MISSING here too, and it is the whole of S-01.
  //
  // S-01 equalises **cumulative** burden — "a within-month-fair January is not fair if
  // someone took three of four Christmas-week nights last December". With no carry-in the
  // solver equalises the month in isolation, which is the fair-looking-and-actually-unfair
  // behaviour the constraint exists to prevent. Second field in a row found validated,
  // documented, and never sent; see `recurringSlots` above.
  //
  // `equalisableBurden`, not `burden`: a doctor who ASKED for extra shifts must not have
  // next month withheld as a consequence — `requested` provenance is reported and excluded
  // from equalisation. Every historical assignment is `unknown`, which counts as directed,
  // so today the two are equal; the day the product records provenance they diverge.
  // ⚠️ BOUNDED to the last few months, not all 33. `LEDGER_WINDOW_MONTHS` is a policy, not a
  // tuning constant — the owner's steer is that the principal treats this as a new beginning
  // rather than a reckoning for two years of past imbalance. It is also what gives S-01 any
  // traction at all: against a 33-month ledger one month is ~3%, and the objective goes flat.
  const ledgerFrom = ledgerCutoff(target.label.slice(0, 7));
  const historyBeforeTarget = {
    label: `before-${target.label}`,
    days: period.days.filter((day) => day.date < first.date && day.date >= ledgerFrom),
    assignments: period.assignments.filter(
      (assignment) => assignment.date < first.date && assignment.date >= ledgerFrom,
    ),
  };
  const ledger = buildLedger(historyBeforeTarget, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
  // The denominator must span the same period as the carry-in — see LedgerCarryIn. Computed
  // here rather than in the solver because `revealed-opportunity` is one implementation and
  // duplicating it in Python is precisely the divergence the contract exists to prevent.
  // ⚠️ The denominator must span the SAME period as the numerator — history *and this month*.
  //
  // The numerator is `cumulativeBurden + whatever the solver assigns this month`, so an
  // entitlement covering only the history is short by exactly one month. The solver used to
  // paper over that by adding its own opportunity estimate, which was a second and different
  // definition of "could have worked". This computes both halves the one way.
  //
  // The target month's half cannot come from `entitlementWeights` directly: `revealed-opportunity`
  // reads the cells a doctor was *observed* working, and a month being solved has no assignments
  // yet — for `--future` it never will. So the cells are learned from history and applied to the
  // target month's days, which is what `revealedCells` is for.
  const historyEntitlement = entitlementWeights(
    historyBeforeTarget,
    PILOT_PATTERNS_V1,
    AGREED_BURDEN_V2,
    ledger,
    { basis: 'revealed-opportunity' },
  );
  const cells = revealedCells(historyBeforeTarget, PILOT_PATTERNS_V1);
  const shiftsById = indexShifts(PILOT_PATTERNS_V1);
  const patternsById = new Map(PILOT_PATTERNS_V1.map((pattern) => [pattern.id, pattern]));
  const entitlement = new Map<DoctorCode, number>();
  for (const [code, historyShare] of historyEntitlement) {
    let thisMonth = 0;
    const revealed = cells.get(code);
    if (revealed !== undefined) {
      for (const day of target.days) {
        for (const patternShift of patternsById.get(day.patternId)?.shifts ?? []) {
          const shift = shiftsById.get(patternShift.id);
          if (shift === undefined || !revealed.has(cellKey(day.dayClass, shift.kind))) {
            continue;
          }
          thisMonth += resolveBurden(day, shift, AGREED_BURDEN_V2).weight;
        }
      }
    }
    entitlement.set(code, historyShare + thisMonth);
  }
  // ── S-08's holiday ledger, over TWELVE months rather than three ──────────────────────
  //
  // A separate, longer window because there are only about forty-four holiday slots in a year;
  // three months of them is roughly eleven across thirteen doctors, which says nothing about
  // whether holidays are being shared. See HOLIDAY_LEDGER_WINDOW_MONTHS.
  const preferences = await readPreferences(target.label.slice(0, 7));

  const holidayFrom = holidayLedgerCutoff(target.label.slice(0, 7));
  // The calendar is the authority, with the day's own flag winning where it states one — the same
  // precedence `lib/contract/request.ts` uses, because `dayClass` loses a weekend holiday.
  const historyCalendar = holidayLookup(holidayFrom, first.date, SOURCED_DECLARATIONS);
  const isHolidayDay = (day: { date: string; isPublicHoliday?: boolean }): boolean =>
    day.isPublicHoliday ?? historyCalendar.has(day.date);
  const holidayHistory = {
    label: `holidays-before-${target.label}`,
    days: period.days.filter(
      (day) => day.date < first.date && day.date >= holidayFrom && isHolidayDay(day),
    ),
    assignments: [] as typeof period.assignments,
  };
  const holidayDates = new Set(holidayHistory.days.map((day) => day.date));
  const holidayPeriod = {
    ...holidayHistory,
    assignments: period.assignments.filter((assignment) => holidayDates.has(assignment.date)),
  };
  const holidayLedger = buildLedger(holidayPeriod, PILOT_PATTERNS_V1, AGREED_BURDEN_V2);
  // The denominator: the burden of the holiday slots each doctor could have worked over the
  // same twelve months. Cells are learned from the FULL history rather than from holidays
  // alone — a doctor who has worked a Sunday night can work a holiday night, and holidays are
  // too sparse to reveal an opportunity set on their own.
  const holidayEntitlement = entitlementWeights(
    holidayPeriod,
    PILOT_PATTERNS_V1,
    AGREED_BURDEN_V2,
    holidayLedger,
    { basis: 'revealed-opportunity', cells },
  );
  const holidayCarried = new Map(
    holidayLedger.entries.map((entry) => [entry.doctor, entry.equalisableBurden] as const),
  );

  const burdenLedger = new Map(
    ledger.entries
      .filter((entry) => active.has(entry.doctor))
      .map((entry) => {
        const holidayShare = holidayEntitlement.get(entry.doctor) ?? 0;
        return [
          entry.doctor,
          {
            cumulativeBurden: entry.equalisableBurden,
            entitlement: entitlement.get(entry.doctor) ?? 0,
            // Both halves or neither — the parser refuses one alone, and a holiday burden
            // over a mismatched denominator is the dimensional error that broke S-01.
            ...(holidayShare > 0
              ? {
                  holidayBurden: holidayCarried.get(entry.doctor) ?? 0,
                  holidayEntitlement: holidayShare,
                }
              : {}),
          },
        ] as const;
      }),
  );

  let request;
  try {
    request = buildSolveRequest({
      solveRunId: `seed-${target.label}`,
      tenantId: 'pilot',
      rosterId: `roster-${target.label}`,
      horizon: { start: first.date, end: last.date },
      doctors,
      days: target.days,
      patterns: PILOT_PATTERNS_V1,
      availability: scopedAvailability,
      recurringSlots,
      slotShares,
      burdenLedger,
      burdenWeights: BURDEN_WEIGHTS,
      burdenSchedule: AGREED_BURDEN_V2,
      monthlyMinimumShifts: MONTHLY_MINIMUM_SHIFTS,
      preferences,
      constraints: CONSTRAINTS,
    });
  } catch (error) {
    if (error instanceof RequestBuildError) {
      console.error(`build-solve-request: refused to build — ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  try {
    await writeFile(outPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  } catch (error) {
    // A fresh clone has no private/ — it is gitignored, so it only exists for the owner. Say that
    // rather than surfacing ENOENT on a path the reader never chose.
    console.error(
      `build-solve-request: could not write ${outPath} — ${(error as Error).message}\n` +
        '                    Pass --out <path> to write somewhere that exists.',
    );
    process.exitCode = 1;
    return;
  }

  // ── Report ─────────────────────────────────────────────────────────────────────────
  console.log(`build-solve-request: ${String(months.length)} month(s) read from ${found.dir}`);
  console.log(`  target month     ${target.label}  (${first.date} .. ${last.date})`);
  console.log(`  days             ${String(request.days.length)}`);
  console.log(
    `  slots            ${String(request.days.reduce((sum, day) => sum + day.shifts.length, 0))}`,
  );
  console.log(
    `  preferences      ${String(request.preferences.length)}  (from the request diary)`,
    `  doctors          ${String(request.doctors.length)}  ${doctors.map((d) => d.code).join(' ')}`,
  );
  console.log(
    `  holidays         ${String(request.days.filter((day) => day.isPublicHoliday).length)}`,
  );
  console.log(
    `  patterns used    ${[...new Set(request.days.map((day) => day.patternId))].sort().join(' ')}`,
  );
  console.log();

  console.log('  availability, inferred from all 33 months:');
  if (request.availability.length === 0) {
    console.log('    none — every doctor in this month was seen on an early weekday');
  }
  for (const entry of request.availability) {
    const rule = entry.rules[0];
    const except = rule?.exceptWeekdays ?? [];
    const evidence = entry.derivedFrom;
    console.log(
      `    ${pad(entry.doctorCode, 5)} not before ${String(rule?.hour ?? 0)}:00` +
        (except.length > 0 ? `  except ${except.join(', ')}` : '') +
        (evidence === undefined
          ? ''
          : `   (${String(evidence.shiftsObserved)} shifts, ${String(evidence.contradictions)} contradictions)`),
    );
  }
  console.log();

  console.log(`  written to       ${outPath}`);
  console.log();
  console.log(
    // ⚠️ This line said "[ASSUMED] placeholders — nobody has agreed them" until 7 September 2026,
    // three days after the principal gave his own numbers and AGREED_BURDEN_V2 replaced them.
    // A stale warning is worse than none: it teaches the reader to discount the real ones.
    "  burdenWeights are AGREED_BURDEN_V2 — the principal's own numbers, [CONFIRMED] 2026-09-04.",
  );
  console.log();
  console.log('  Verify the other side parses and solves it:');
  console.log(
    `    .tools/uv/uv.exe run --project solver python -c "import json,pathlib; ` +
      `from call_roster_solver.contract import parse_request; from call_roster_solver.model import build, solve; ` +
      `r=solve(build(parse_request(json.loads(pathlib.Path(r'${outPath}').read_text())))); ` +
      `print(r.status, len(r.assignments), 'assignments')"`,
  );
}

await main();
