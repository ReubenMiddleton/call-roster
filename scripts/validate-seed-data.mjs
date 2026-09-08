/**
 * Validates transcribed historical roster data against the arithmetic invariants.
 *
 * Why this is not optional
 * -----------------------
 * The historical sheets contain real errors. Working three months by hand found one
 * immediately: a Wednesday reading 07:00-15:00, 17:00-23:00, 23:00-07:00, leaving two
 * hours uncovered and summing to 22 hours instead of 24. Almost certainly a typing slip
 * in the original Word table, but it is *in the source*.
 *
 * So transcription cannot be trusted and neither can the source. Every month gets checked
 * arithmetically, and anything that fails is either a transcription error to fix or a real
 * anomaly to record deliberately in the file's `anomalies` array.
 *
 * This is the same requirement docs/domain/fairness.md states for vision-model extraction
 * (hallucinated rows break arithmetic checks), arriving from the opposite direction.
 *
 * Data location
 * -------------
 * Real transcriptions live in private/seed-data/ and are NEVER committed: 16 months of
 * day-by-day movements for thirteen identifiable people is precisely the data the project
 * brief defaults to not publishing, and pseudonymous codes are not anonymisation when the
 * mapping exists. A committed synthetic fixture exercises this validator in CI.
 *
 * Usage:
 *   node scripts/validate-seed-data.mjs                 # private/seed-data/, or the fixture
 *   node scripts/validate-seed-data.mjs <dir>
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const KNOWN_PATTERNS = {
  A: [
    { shiftId: 'std-morning', hours: 8 },
    { shiftId: 'std-afternoon', hours: 8 },
    { shiftId: 'std-night', hours: 8 },
  ],
  B: [
    { shiftId: 'fri-early', hours: 5 },
    { shiftId: 'fri-midday', hours: 5 },
    { shiftId: 'fri-evening', hours: 6 },
    { shiftId: 'fri-night', hours: 8 },
  ],
  C: [
    { shiftId: 'red-longday', hours: 10 },
    { shiftId: 'red-evening', hours: 6 },
    { shiftId: 'red-night', hours: 8 },
  ],
};

// D01-D20. Widened from D15 on 2026-09-01: transcribing the 2023-2025 sheets surfaced a
// doctor who had left before the original observation window, and older rosters are still
// being recovered. The ceiling is headroom, not a claim about how many doctors exist.
const DOCTOR_CODE = /^D(?:0[1-9]|1[0-9]|20)$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** @returns {{errors: string[], warnings: string[], stats: object}} */
function validateMonth(file, doc) {
  const errors = [];
  const warnings = [];
  const where = (extra) => `${file}${extra ? ` ${extra}` : ''}`;

  if (!/^\d{4}-\d{2}$/.test(doc.month ?? '')) {
    errors.push(`${where()}: 'month' must be YYYY-MM.`);
    return { errors, warnings, stats: {} };
  }
  if (!doc.source) warnings.push(`${where()}: no 'source' recorded — provenance is lost.`);

  const [year, month] = doc.month.split('-').map(Number);
  const expected = daysInMonth(year, month);
  const declaredAnomalies = new Set((doc.anomalies ?? []).map((a) => `${a.date}:${a.kind}`));

  const seenDates = new Set();
  const shiftCounts = {};
  const doctorShiftCounts = {};

  for (const day of doc.days ?? []) {
    const at = where(`${day.date}`);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date ?? '')) {
      errors.push(`${at}: invalid date.`);
      continue;
    }
    if (!day.date.startsWith(doc.month)) {
      errors.push(`${at}: date is outside ${doc.month}. Spill cells belong in 'spillDays'.`);
      continue;
    }
    if (seenDates.has(day.date)) errors.push(`${at}: duplicate date.`);
    seenDates.add(day.date);

    const pattern = KNOWN_PATTERNS[day.patternId];
    if (!pattern) {
      errors.push(`${at}: unknown patternId '${day.patternId}'.`);
      continue;
    }

    // The invariant that catches the real-world typo: a day's shifts must sum to 24 hours.
    const total = pattern.reduce((sum, s) => sum + s.hours, 0);
    if (total !== 24) {
      errors.push(`${at}: pattern ${day.patternId} sums to ${String(total)}h, not 24h.`);
    }

    const assignments = day.assignments ?? {};
    const assignedShiftIds = Object.keys(assignments);

    for (const { shiftId } of pattern) {
      const code = assignments[shiftId];
      if (code === undefined) {
        const key = `${day.date}:missing-shift`;
        if (declaredAnomalies.has(key)) {
          warnings.push(`${at}: '${shiftId}' unassigned — declared anomaly, accepted.`);
        } else {
          errors.push(
            `${at}: pattern ${day.patternId} requires '${shiftId}' but it is absent. ` +
              `If the source really shows a gap, declare it in 'anomalies' with kind 'missing-shift'.`,
          );
        }
        continue;
      }
      if (!DOCTOR_CODE.test(code)) {
        errors.push(`${at}: '${shiftId}' has '${String(code)}' — not a D01..D15 code.`);
        continue;
      }
      shiftCounts[shiftId] = (shiftCounts[shiftId] ?? 0) + 1;
      doctorShiftCounts[code] = (doctorShiftCounts[code] ?? 0) + 1;
    }

    for (const shiftId of assignedShiftIds) {
      if (!pattern.some((s) => s.shiftId === shiftId)) {
        errors.push(`${at}: '${shiftId}' is not part of pattern ${day.patternId}.`);
      }
    }

    // H-02: a doctor works at most one shift per day.
    //
    // A declared anomaly downgrades this to a warning, added 2026-09-01. H-02 stopped being a
    // hard constraint on 2026-08-31: asked whether it was absolute, the principal answered "it
    // should be absolute but it has happened, and so the app should still allow for it if it
    // happens." A validator that refuses to ingest history he actually produced would be the
    // same mistake the solver just stopped making.
    //
    // The escape is deliberately narrow: the double must be declared per date in 'anomalies'
    // with kind 'h02-double-shift'. An undeclared one is still an error, because the far more
    // likely cause is a transcription slip - two adjacent cells read as the same surname.
    const codes = pattern.map((s) => assignments[s.shiftId]).filter(Boolean);
    const duplicates = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (duplicates.length > 0) {
      const named = [...new Set(duplicates)].join(', ');
      if (declaredAnomalies.has(`${day.date}:h02-double-shift`)) {
        warnings.push(`${at}: ${named} assigned twice (H-02) — declared anomaly, accepted.`);
      } else {
        errors.push(
          `${at}: ${named} assigned more than once (H-02).` +
            ` If the source really shows this, declare it in 'anomalies' with kind 'h02-double-shift'.`,
        );
      }
    }
  }

  if (seenDates.size !== expected) {
    const missing = [];
    for (let d = 1; d <= expected; d += 1) {
      const iso = `${doc.month}-${String(d).padStart(2, '0')}`;
      if (!seenDates.has(iso)) missing.push(iso);
    }
    errors.push(
      `${where()}: ${String(seenDates.size)} of ${String(expected)} days present. ` +
        `Missing: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`,
    );
  }

  for (const day of doc.spillDays ?? []) {
    if (day.date?.startsWith(doc.month)) {
      errors.push(`${where(day.date)}: listed as a spill day but belongs to ${doc.month}.`);
    }
  }

  return {
    errors,
    warnings,
    stats: {
      days: seenDates.size,
      slots: Object.values(shiftCounts).reduce((a, b) => a + b, 0),
      doctors: Object.keys(doctorShiftCounts).length,
      doctorShiftCounts,
    },
  };
}

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
    // try the next candidate
  }
}

if (dir === null) {
  console.log(
    'validate-seed-data: no seed data found — skipping.\n' +
      '  Looked in: ' +
      candidates.join(', ') +
      '\n  Real transcriptions live in private/seed-data/ and are never committed.',
  );
  process.exit(0);
}

let totalErrors = 0;
let totalWarnings = 0;
const perDoctor = {};
let totalSlots = 0;

for (const file of files) {
  const doc = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  const { errors, warnings, stats } = validateMonth(file, doc);

  totalErrors += errors.length;
  totalWarnings += warnings.length;
  totalSlots += stats.slots ?? 0;
  for (const [code, n] of Object.entries(stats.doctorShiftCounts ?? {})) {
    perDoctor[code] = (perDoctor[code] ?? 0) + n;
  }

  const flag = errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'warn' : ' ok ';
  console.log(
    `[${flag}] ${file.padEnd(14)} ${String(stats.days ?? 0).padStart(2)} days, ` +
      `${String(stats.slots ?? 0).padStart(3)} slots, ${String(stats.doctors ?? 0)} doctors`,
  );
  for (const w of warnings) console.log(`         ~ ${w}`);
  for (const e of errors) console.error(`         ! ${e}`);
}

console.log(
  `\nvalidate-seed-data: ${String(files.length)} month(s) in ${dir}, ` +
    `${String(totalSlots)} slots, ${String(totalErrors)} error(s), ${String(totalWarnings)} warning(s).`,
);

if (Object.keys(perDoctor).length > 0) {
  const sorted = Object.entries(perDoctor).sort((a, b) => b[1] - a[1]);
  console.log('\nShifts per doctor across all months transcribed so far:');
  for (const [code, n] of sorted) {
    console.log(`  ${code}  ${String(n).padStart(4)}  ${'#'.repeat(Math.round(n / 4))}`);
  }
}

if (totalErrors > 0) process.exitCode = 1;
