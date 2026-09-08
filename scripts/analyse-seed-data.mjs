/**
 * Cross-month analysis of the transcribed historical roster.
 *
 * Two jobs, and the first is the more important:
 *
 * 1. TEST THE CATALOGUED CONSTRAINTS AGAINST THE REAL DATA. Every "never" in
 *    docs/domain/constraints.md was tagged from an interview plus an eyeball pass over the
 *    sheets. Eyeballing seventeen months is exactly the kind of thing a human does badly
 *    and a script does perfectly, and the results so far have been humbling: several
 *    CONFIRMED constraints have counterexamples. This script finds them all, every time it
 *    runs, so nobody has to remember.
 *
 * 2. Prototype the fairness ledger. Burden distribution, night counts, weekend counts,
 *    holiday counts, per doctor, across every month available. This is the arithmetic a
 *    paper diary structurally cannot do, and it is the single most persuasive output the
 *    product has.
 *
 * Reads private/seed-data/ (never committed) or falls back to fixtures/seed-data/.
 * Prints only aggregate statistics and dates - never a real name, since it only ever sees
 * Dnn codes.
 *
 * Usage:  node scripts/analyse-seed-data.mjs [dir]
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Illustrative weights from docs/domain/fairness.md. ASSUMED, not agreed with the
// practice - the numbers must be set with the group before they mean anything.
const BURDEN = {
  'std-morning': 1.0,
  'std-afternoon': 1.0,
  'std-night': 2.5,
  'fri-early': 1.0,
  'fri-midday': 1.0,
  'fri-evening': 1.5,
  'fri-night': 2.5,
  'red-longday': 1.5,
  'red-evening': 1.5,
  'red-night': 2.5,
};
const SATURDAY_MULTIPLIER = 3.0;
const SUNDAY_MULTIPLIER = 3.5;
const HOLIDAY_MULTIPLIER = 5.0;

const NIGHT_SHIFTS = new Set(['std-night', 'fri-night', 'red-night']);
const FRIDAY_BACK_HALF = new Set(['fri-evening', 'fri-night']);

// The doctors each "never" constraint names. From private/doctor-codes.md via the
// constraint catalogue - these are codes, not names.
const H05_SATURDAY_EXCLUDED = new Set(['D02']);
const H06_FRIDAY_BACK_HALF_EXCLUDED = new Set(['D01', 'D02', 'D03', 'D04']);
const H07_PATTERN_B_EXCLUDED = new Set(['D01']);

const argDir = process.argv[2];
const candidates = argDir
  ? [argDir]
  : [path.join('private', 'seed-data'), path.join('fixtures', 'seed-data')];

let dir = null;
let files = [];
for (const candidate of candidates) {
  try {
    const found = (await readdir(candidate)).filter((n) => n.endsWith('.json')).sort();
    if (found.length > 0) {
      dir = candidate;
      files = found;
      break;
    }
  } catch {
    /* next */
  }
}

if (dir === null) {
  console.log('analyse-seed-data: no seed data found — skipping.');
  process.exit(0);
}

// ── Load every assignment into one chronological list ────────────────────────────────
/** @type {{date: string, shiftId: string, doctor: string, pattern: string, holiday: boolean}[]} */
const all = [];
const months = [];

for (const file of files) {
  const doc = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  months.push(doc.month);
  for (const day of doc.days ?? []) {
    for (const [shiftId, doctor] of Object.entries(day.assignments ?? {})) {
      all.push({
        date: day.date,
        shiftId,
        doctor,
        pattern: day.patternId,
        holiday: day.isPublicHoliday === true,
      });
    }
  }
}
all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat

console.log(`analyse-seed-data: ${String(months.length)} months in ${dir}`);
console.log(`  ${months[0]} .. ${months[months.length - 1]}, ${String(all.length)} assignments\n`);

// Report gaps in the month sequence — missing months skew every per-doctor total.
const gaps = [];
for (let i = 1; i < months.length; i += 1) {
  const [py, pm] = months[i - 1].split('-').map(Number);
  const [cy, cm] = months[i].split('-').map(Number);
  if ((cy - py) * 12 + (cm - pm) !== 1) gaps.push(`${months[i - 1]} -> ${months[i]}`);
}
if (gaps.length > 0) {
  console.log('⚠  GAPS in the month sequence (per-doctor totals are not comparable across them):');
  for (const g of gaps) console.log(`     ${g}`);
  console.log('');
}

// ── 1. Constraint verification ──────────────────────────────────────────────────────
console.log('CONSTRAINT VERIFICATION against the real data');
console.log('─'.repeat(78));

/** @param {string} id @param {string} claim @param {{date:string,doctor:string,shiftId:string}[]} breaches */
function report(id, claim, breaches) {
  if (breaches.length === 0) {
    console.log(`  ${id}  HOLDS      ${claim}`);
    return;
  }
  console.log(`  ${id}  FALSIFIED  ${claim}`);
  console.log(`        ${String(breaches.length)} counterexample(s):`);
  for (const b of breaches) {
    console.log(`          ${b.date}  ${b.doctor}  ${b.shiftId}`);
  }
}

// H-04: no night shift on day D followed by a night shift on day D+1.
const nightsByDoctor = new Map();
for (const a of all) {
  if (!NIGHT_SHIFTS.has(a.shiftId)) continue;
  if (!nightsByDoctor.has(a.doctor)) nightsByDoctor.set(a.doctor, new Set());
  nightsByDoctor.get(a.doctor).add(a.date);
}
const h04 = [];
for (const [doctor, dates] of nightsByDoctor) {
  for (const date of [...dates].sort()) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextIso = next.toISOString().slice(0, 10);
    if (dates.has(nextIso)) h04.push({ date, doctor, shiftId: `night, then night on ${nextIso}` });
  }
}
report('H-04', 'no back-to-back night shifts', h04);

// H-02: at most one shift per doctor per day.
const perDoctorDay = new Map();
for (const a of all) {
  const key = `${a.doctor}|${a.date}`;
  perDoctorDay.set(key, (perDoctorDay.get(key) ?? 0) + 1);
}
const h02 = [...perDoctorDay.entries()]
  .filter(([, n]) => n > 1)
  .map(([key, n]) => {
    const [doctor, date] = key.split('|');
    return { date, doctor, shiftId: `${String(n)} shifts that day` };
  });
report('H-02', 'at most one shift per doctor per day', h02);

// H-05: the Saturday standing rule.
const h05 = all
  .filter((a) => H05_SATURDAY_EXCLUDED.has(a.doctor) && weekday(a.date) === 6)
  .map(({ date, doctor, shiftId }) => ({ date, doctor, shiftId }));
report('H-05', 'D02 is never assigned a Saturday shift', h05);

// H-06: Friday's back half is pool doctors only.
const h06 = all
  .filter((a) => FRIDAY_BACK_HALF.has(a.shiftId) && H06_FRIDAY_BACK_HALF_EXCLUDED.has(a.doctor))
  .map(({ date, doctor, shiftId }) => ({ date, doctor, shiftId }));
report('H-06', "Friday's evening and night exclude D01-D04", h06);

// H-07: scoped to Pattern B, per the correction in docs/domain/constraints.md.
const h07 = all
  .filter((a) => a.pattern === 'B' && H07_PATTERN_B_EXCLUDED.has(a.doctor))
  .map(({ date, doctor, shiftId }) => ({ date, doctor, shiftId }));
report('H-07', 'D01 is never assigned a Pattern B shift', h07);

// ── 2. The fairness ledger, prototyped ──────────────────────────────────────────────
console.log(`\nFAIRNESS LEDGER (illustrative weights — see docs/domain/fairness.md)`);
console.log('─'.repeat(78));

const stats = new Map();
const ensure = (d) =>
  stats.get(d) ??
  (stats.set(d, { shifts: 0, nights: 0, saturdays: 0, sundays: 0, holidays: 0, burden: 0 }),
  stats.get(d));

for (const a of all) {
  const s = ensure(a.doctor);
  const day = weekday(a.date);
  let weight = BURDEN[a.shiftId] ?? 1.0;
  if (a.holiday) weight *= HOLIDAY_MULTIPLIER;
  else if (day === 6) weight *= SATURDAY_MULTIPLIER;
  else if (day === 0) weight *= SUNDAY_MULTIPLIER;

  s.shifts += 1;
  s.burden += weight;
  if (NIGHT_SHIFTS.has(a.shiftId)) s.nights += 1;
  if (day === 6) s.saturdays += 1;
  if (day === 0) s.sundays += 1;
  if (a.holiday) s.holidays += 1;
}

const rows = [...stats.entries()].sort((a, b) => b[1].burden - a[1].burden);
const totalBurden = rows.reduce((sum, [, s]) => sum + s.burden, 0);
const mean = totalBurden / rows.length;

console.log('  code   shifts  nights   Sat   Sun   hols    burden   vs mean');
for (const [code, s] of rows) {
  const delta = s.burden - mean;
  const sign = delta >= 0 ? '+' : '-';
  console.log(
    `  ${code}   ${String(s.shifts).padStart(6)}  ${String(s.nights).padStart(6)}` +
      `  ${String(s.saturdays).padStart(4)}  ${String(s.sundays).padStart(4)}` +
      `  ${String(s.holidays).padStart(5)}  ${s.burden.toFixed(1).padStart(8)}` +
      `   ${sign}${Math.abs(delta).toFixed(1).padStart(7)}`,
  );
}

const top4 = rows.slice(0, 4);
const top4Shifts = top4.reduce((sum, [, s]) => sum + s.shifts, 0);
console.log(
  `\n  Mean burden ${mean.toFixed(1)}. Spread ${rows[0][1].burden.toFixed(1)} (${rows[0][0]}) ` +
    `to ${rows[rows.length - 1][1].burden.toFixed(1)} (${rows[rows.length - 1][0]}) — ` +
    `${(rows[0][1].burden / Math.max(rows[rows.length - 1][1].burden, 0.01)).toFixed(1)}x.`,
);
console.log(
  `  The four heaviest-loaded doctors carry ${String(top4Shifts)} of ${String(all.length)} shifts ` +
    `(${((top4Shifts / all.length) * 100).toFixed(0)}%).`,
);
console.log(
  '\n  This spread is EXPECTED, not a finding: anchors hold recurring weekday slots because\n' +
    '  this is their primary practice, while pool doctors cover weekends around a primary\n' +
    '  practice elsewhere. See docs/domain/workforce.md. Comparing raw totals across the two\n' +
    '  groups is meaningless — which is why the objective divides by FTE.',
);

// ── 3. Undocumented patterns ────────────────────────────────────────────────────────
// The catalogue was built from an interview plus an eyeball pass. Strong skews that
// nobody mentioned are candidate constraints - either a real rule the principal never
// thought to state, or a coincidence worth ruling out. Either way he should be asked.
console.log(`\nUNDOCUMENTED PATTERNS — candidate constraints nobody has stated`);
console.log('─'.repeat(78));

const found = [];

for (const [code, s] of rows) {
  if (s.shifts < 12) continue; // too few shifts to say anything

  const nightRate = s.nights / s.shifts;
  if (nightRate === 0) {
    found.push(`${code} has NEVER worked a night shift in ${String(s.shifts)} shifts.`);
  } else if (nightRate < 0.05) {
    found.push(
      `${code} works nights almost never: ${String(s.nights)} of ${String(s.shifts)} shifts ` +
        `(${(nightRate * 100).toFixed(1)}%), against a roster average of ` +
        `${((all.filter((a) => NIGHT_SHIFTS.has(a.shiftId)).length / all.length) * 100).toFixed(0)}%.`,
    );
  } else if (nightRate > 0.9) {
    found.push(
      `${code} works almost ONLY nights: ${String(s.nights)} of ${String(s.shifts)} shifts ` +
        `(${(nightRate * 100).toFixed(0)}%).`,
    );
  }

  // A doctor who appears on essentially one weekday is holding a single standing slot.
  const days = new Set(all.filter((a) => a.doctor === code).map((a) => weekday(a.date)));
  if (days.size <= 2) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    found.push(
      `${code} appears on only ${String(days.size)} weekday(s) — ` +
        `${[...days]
          .sort()
          .map((d) => names[d])
          .join(', ')} — across ${String(s.shifts)} shifts.`,
    );
  }
}

if (found.length === 0) {
  console.log('  None detected.');
} else {
  for (const f of found) console.log(`  • ${f}`);
  console.log(
    '\n  Each of these is a QUESTION, not a constraint. A strong skew may be a rule the\n' +
      '  principal never thought to state, or an artefact of who happened to be available.\n' +
      '  Passive learning from patterns like these over-fits badly — the documented failure\n' +
      '  mode is inferring "cannot work Sunday nights" from "never did", which is wrong and\n' +
      '  invisible. Ask before modelling. See docs/domain/constraints.md.',
  );
}
