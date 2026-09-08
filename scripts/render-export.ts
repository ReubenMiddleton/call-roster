/**
 * Renders one month's roster to a printable PDF, and to the HTML behind it.
 *
 * **This is the artifact of record**, and the shortest path to the only question that matters:
 * does the practice principal look at it and say *"yes, that's my roster"*? If he does, the
 * project's largest risk is retired for the price of a renderer rather than a whole application.
 *
 * Reads a transcribed month, lays it out with `calendar-layout`, renders it with `render-html`,
 * and prints it through headless Chromium.
 *
 * ## Output goes to `private/`
 *
 * The PDF carries doctor labels and, with `--branding`, the practice's own name and logo. That is
 * exactly the material the data boundary keeps out of the repository, so it is written under
 * `private/` — the first line of `.gitignore` — and never anywhere else. Without `--branding` it
 * renders `SYNTHETIC_BRANDING` and doctor codes, which is safe to screenshot.
 *
 * ## ⚠️ Fonts
 *
 * The source template uses Corbel and Cooper Black. Both ship with Windows and Office and neither
 * is redistributable, so **this produces an exact match on the principal's own machine and an
 * approximation anywhere else.** That is fine for showing him a first export and is not fine for a
 * server. Decide the substitution before he forms an opinion — see `docs/NEEDS_YOUR_INPUT.md`.
 *
 * Run with:
 *   npm run export:render                       # last complete month, synthetic branding
 *   node scripts/render-export.ts 2026-08
 *   node scripts/render-export.ts 2026-08 --branding private/template/branding.json
 *   node scripts/render-export.ts 2026-08 --draft "20 September"
 *
 * **Prints, never fails the gate.** This is a tool.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  loadSeedPeriod,
  type SeedMonthDocument,
  splitByMonth,
} from '../lib/analytics/seed-period.ts';
import { indexShifts, PILOT_PATTERNS_V1 } from '../lib/analytics/shifts.ts';
import { holidayLookup, SOURCED_DECLARATIONS } from '../lib/calendar/holidays.ts';
import {
  buildExportDocument,
  type ExportBranding,
  SYNTHETIC_BRANDING,
} from '../lib/export/branding.ts';
import { type LayoutDay, layoutMonth, type MonthGrid } from '../lib/export/calendar-layout.ts';
import { renderExportHtml } from '../lib/export/render-html.ts';

/**
 * How the practice writes a shift's hours on the sheet.
 *
 * `7-15`, `23-7`, `17-23` — no leading zero, no colon. Derived from the shift's own hours rather
 * than a lookup table, so a tenant with different times still prints correctly.
 */
function printedTime(startHour: number, hours: number): string {
  return `${String(startHour)}-${String((startHour + hours) % 24)}`;
}

function flagValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function findSeedDirectory(): Promise<{ dir: string; files: string[] } | null> {
  for (const candidate of ['private/seed-data', 'fixtures/seed-data']) {
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
 * Resolves `Dnn` codes to surnames, read at run time from `private/doctor-codes.md`.
 *
 * ⚠️ **The mapping is never imported, only read.** `branding.ts` takes `labelFor` as a *function*
 * precisely so that no layer of this codebase has to hold the pairing: a renderer handed codes
 * prints codes, which is the correct behaviour for a test, a fixture or a screenshot. Passing
 * `--names` is an explicit act by someone who already has the private file.
 *
 * The output still goes to `private/export/`, which is the first line of `.gitignore`, and
 * `npm run publish:check` fails on any document or image anywhere in the tree.
 */
async function readDoctorNames(codesPath: string): Promise<(code: string) => string> {
  const text = await readFile(codesPath, 'utf8');
  const names = new Map<string, string>();
  // Rows look like: | **D01** | Example | Anchor | … | — synthetic surname on purpose;
  // `npm run names:check` caught a real one here on 6 September and was right to.
  for (const match of text.matchAll(/^\|\s*\*\*(D\d{2})\*\*\s*\|\s*([^|]+?)\s*\|/gm)) {
    const [, code, surname] = match;
    if (code !== undefined && surname !== undefined) {
      names.set(code, surname);
    }
  }
  if (names.size === 0) {
    throw new Error(`no "| **Dnn** | Surname |" rows found in ${codesPath}`);
  }
  console.log(`  names            ${String(names.size)} resolved from ${codesPath}`);
  // A code with no row prints as itself rather than blank — a missing name must be visible.
  return (code: string) => names.get(code) ?? code;
}

/** Writes the HTML and the PDF, then reports. Shared by the seed path and the solved path. */
async function writeAndPrint(grid: MonthGrid, monthKey: string, source: string): Promise<void> {
  let branding: ExportBranding = SYNTHETIC_BRANDING;
  const brandingPath = flagValue('--branding');
  if (brandingPath !== undefined) {
    branding = JSON.parse(await readFile(brandingPath, 'utf8')) as ExportBranding;
  }

  const namesPath = flagValue('--names');
  const labelFor = namesPath === undefined ? undefined : await readDoctorNames(namesPath);

  const deadline = flagValue('--draft');
  const exportDocument = buildExportDocument({
    grid,
    branding,
    ...(labelFor === undefined ? {} : { labelFor, labelStyle: 'surname' as const }),
    ...(deadline === undefined ? {} : { draft: { reviewDeadline: deadline } }),
  });
  const html = renderExportHtml(exportDocument);

  const outDir = flagValue('--out') ?? 'private/export';
  const base = path.join(outDir, `roster-${monthKey}`);
  try {
    await writeFile(`${base}.html`, html, 'utf8');
  } catch (error) {
    console.error(
      `render-export: could not write ${base}.html — ${(error as Error).message}\n` +
        `                Create the directory, or pass --out <path>.`,
    );
    process.exitCode = 1;
    return;
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: `${base}.pdf`,
      // Landscape US Letter, as the source .docx specifies. `preferCSSPageSize` honours the
      // @page rule so the geometry comes from one place rather than two.
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  const filled = grid.weeks.flat().filter((cell) => cell !== null).length;
  console.log(`render-export: ${monthKey} — ${source}`);
  console.log(
    `  weeks            ${String(grid.weeks.length)}${grid.wrapped ? '  (wrapped into row one)' : ''}`,
  );
  console.log(`  cells with dates ${String(filled)}`);
  console.log(
    `  branding         ${branding.practiceName}${branding.logo === undefined ? '  (no logo)' : '  (with logo)'}`,
  );
  console.log(`  draft            ${deadline ?? 'no — final'}`);
  console.log(`  written to       ${base}.pdf`);
  console.log(`                   ${base}.html`);
  if (branding === SYNTHETIC_BRANDING) {
    console.log('');
    console.log(
      '  ⚠️ Synthetic branding and doctor codes. Pass --branding to render the real sheet.',
    );
  }
  console.log('');
  console.log('  ⚠️ Corbel and Cooper Black are not redistributable. This matches the source');
  console.log('     exactly on a machine that has them, and approximates it anywhere else.');
}

/**
 * Renders a month the solver produced rather than one the practice already worked.
 *
 * **This is the loop the product exists to close**: history → solve → the printable sheet, with
 * nothing hand-written in between. The days come from the request (which carries each date's
 * pattern, its shifts and their printed hours) and the doctors from the result, so both halves of
 * the wire boundary are exercised.
 */
async function renderSolvedMonth(requestPath: string, resultPath: string): Promise<void> {
  interface WireShift {
    readonly shiftId: string;
    readonly start: string;
    readonly end: string;
  }
  interface WireDay {
    readonly date: string;
    readonly isPublicHoliday: boolean;
    readonly shifts: readonly WireShift[];
  }
  const request = JSON.parse(await readFile(requestPath, 'utf8')) as {
    readonly horizon: { readonly start: string };
    readonly days: readonly WireDay[];
  };
  const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
    readonly status: string;
    readonly assignments: readonly { date: string; shiftId: string; doctorCode: string }[];
  };

  const month = request.horizon.start.slice(0, 7);
  const order = new Map<string, number>();
  const printed = new Map<string, string>();
  for (const day of request.days) {
    for (const shift of day.shifts) {
      const startHour = Number(shift.start.slice(0, 2));
      const endHour = Number(shift.end.slice(0, 2));
      order.set(`${day.date}|${shift.shiftId}`, startHour);
      printed.set(`${day.date}|${shift.shiftId}`, `${String(startHour)}-${String(endHour)}`);
    }
  }

  const lines = new Map<string, { doctor: string; time: string; start: number }[]>();
  for (const assignment of result.assignments) {
    const key = `${assignment.date}|${assignment.shiftId}`;
    const list = lines.get(assignment.date) ?? [];
    list.push({
      doctor: assignment.doctorCode,
      time: printed.get(key) ?? assignment.shiftId,
      start: order.get(key) ?? 0,
    });
    lines.set(assignment.date, list);
  }

  const days: LayoutDay[] = request.days.map((day) => ({
    date: day.date,
    ...(day.isPublicHoliday ? { holidayName: 'Public holiday' } : {}),
    lines: (lines.get(day.date) ?? [])
      .sort((a, b) => a.start - b.start)
      .map(({ doctor, time }) => ({ doctor, time })),
  }));

  const grid = layoutMonth({ month, days });
  await writeAndPrint(grid, month, `solved ${result.status}`);
}

async function main(): Promise<void> {
  const solveRequest = flagValue('--request');
  const solveResult = flagValue('--solved');
  if (solveRequest !== undefined && solveResult !== undefined) {
    await renderSolvedMonth(solveRequest, solveResult);
    return;
  }

  const found = await findSeedDirectory();
  if (found === null) {
    console.log(
      'render-export: no seed data found. Looked in private/seed-data, fixtures/seed-data',
    );
    return;
  }

  const documents: SeedMonthDocument[] = [];
  for (const file of found.files) {
    documents.push(
      JSON.parse(await readFile(path.join(found.dir, file), 'utf8')) as SeedMonthDocument,
    );
  }
  const period = loadSeedPeriod(documents, 'seed');
  const months = splitByMonth(period);

  const positional = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}$/.test(arg));
  const target =
    positional === undefined ? months.at(-1) : months.find((m) => m.label === positional);
  if (target === undefined) {
    console.error(`render-export: no month "${positional ?? ''}" in the data.`);
    process.exitCode = 1;
    return;
  }

  const shiftsById = indexShifts(PILOT_PATTERNS_V1);
  const calendar = holidayLookup(
    target.days[0]?.date ?? '',
    target.days.at(-1)?.date ?? '',
    SOURCED_DECLARATIONS,
  );

  // Shift order is the caller's and is preserved by the layout, so it is set here — the sheets
  // print the day's shifts in start-hour order, with the night last.
  const byDate = new Map<string, LayoutDay>();
  for (const day of target.days) {
    const holiday = calendar.get(day.date);
    byDate.set(day.date, {
      date: day.date,
      ...(day.isPublicHoliday === true || holiday !== undefined
        ? { holidayName: holiday?.name ?? 'Public holiday' }
        : {}),
      lines: [],
    });
  }
  const lines = new Map<string, { doctor: string; time: string; start: number }[]>();
  for (const assignment of target.assignments) {
    const shift = shiftsById.get(assignment.shiftId);
    if (shift === undefined) {
      continue;
    }
    const list = lines.get(assignment.date) ?? [];
    list.push({
      doctor: assignment.doctor,
      time: printedTime(shift.startHour, shift.hours),
      start: shift.startHour,
    });
    lines.set(assignment.date, list);
  }

  const days: LayoutDay[] = [];
  for (const [date, day] of byDate) {
    const sorted = (lines.get(date) ?? []).sort((a, b) => a.start - b.start);
    days.push({ ...day, lines: sorted.map(({ doctor, time }) => ({ doctor, time })) });
  }

  // ⚠️ Spill days come from the raw document, not from the period.
  //
  // `loadSeedPeriod` excludes them on purpose — the sheet that owns a date carries it too, so
  // including them double-counts burden and silently inflates the ledger. But the EXPORT is
  // exactly where they belong: they are how the sheets fill the empty cells around a month, and
  // the practice's December 2023 sheet prints `1 Jan` beside a wrapped 31 December.
  //
  // Dropping them was a real bug, caught by rendering December 2023 and holding it beside the
  // photographed sheet: mine had an empty Monday where his has `1 Jan`.
  const sourceDocument = documents.find((entry) => entry.month === target.label);
  const spillDays: LayoutDay[] = (sourceDocument?.spillDays ?? []).map((seedDay) => {
    const sorted = Object.entries(seedDay.assignments)
      .map(([shiftId, doctor]) => ({ shiftId, doctor, shift: shiftsById.get(shiftId) }))
      .filter((entry) => entry.shift !== undefined)
      .sort((a, b) => (a.shift?.startHour ?? 0) - (b.shift?.startHour ?? 0));
    return {
      date: seedDay.date,
      ...(seedDay.isPublicHoliday === true
        ? { holidayName: seedDay.holidayName ?? 'Public holiday' }
        : {}),
      lines: sorted.map((entry) => ({
        doctor: entry.doctor,
        time: printedTime(entry.shift?.startHour ?? 0, entry.shift?.hours ?? 0),
      })),
    };
  });

  const grid = layoutMonth({ month: target.label, days, spillDays });

  await writeAndPrint(grid, target.label, found.dir);
}

await main();
