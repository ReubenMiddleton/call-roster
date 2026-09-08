/**
 * Renders an {@link ExportDocument} as a self-contained printable HTML page.
 *
 * **This is the artifact of record.** Everything else the product does is a better version of
 * something the practice already does; this is the thing that either replaces the Word table or does
 * not. The failure mode is precise: he builds a roster in the app, exports it, decides it does not
 * look right, rebuilds it in Word, does the work twice, and stops using the app.
 *
 * ## Every measurement here is read out of the practice's own `.docx`
 *
 * Not inferred from a photograph — see *What the Word source settles* in
 * `docs/product/export.md`. Twips are Word's unit, 1440 to the inch, and the conversions are kept
 * visible so a later reader can check them against the file rather than trusting a rounded inch.
 *
 * The two that will look like mistakes and are not:
 *
 * - **The Sunday column is narrower than the other six.** 1771 twips against 1959.5. It is not a
 *   rounding artefact; the source table is `tblLayout: fixed` and Sunday is deliberately ~10%
 *   narrower. Equalising the columns is the single most visible way to make this stop looking like
 *   his sheet.
 * - **A week is two table rows, not one.** A thin date row carrying the right-aligned day number
 *   sits above a tall entries row, and the table draws vertical inside borders but **no horizontal
 *   ones** — so the pair reads as a single cell. Rendering one row per week with the number floated
 *   inside it is close but subtly wrong, and it goes wrong exactly when a cell has four shift lines.
 *
 * ## ⚠️ The fonts are a licensing problem, and it is not solved here
 *
 * The source uses **Corbel** for cells and **Cooper Black** for the practice name. Both ship with
 * Windows and Office and **neither is freely redistributable**, so a server-side PDF renderer cannot
 * embed them. On the principal's own Windows machine the first stack entry resolves and the output
 * is exact; anywhere else it falls through to a metric-compatible substitute and the spacing shifts.
 *
 * **Decide this before he forms an opinion about how the export looks**, not after — see
 * `docs/NEEDS_YOUR_INPUT.md`. {@link ExportFonts} exists so the substitution is a parameter rather
 * than a find-and-replace.
 *
 * ## Branding is a parameter, and nothing here names the practice
 *
 * Per [ADR-0010](../../docs/architecture/decisions/0010-productisation-seams-first.md) the export
 * takes branding as input. The default is {@link SYNTHETIC_BRANDING}, which is invented. The real
 * name, colours and logo live in tenant configuration under `private/`, and a renderer handed only
 * doctor codes prints codes — which is the correct behaviour for a test, a demo or a screenshot.
 */

import type { ExportDocument } from './branding.ts';
import { COLUMN_ORDER, type GridCell } from './calendar-layout.ts';

/** Word's unit. 1440 to the inch, and every figure below came out of the file in twips. */
const TWIPS_PER_INCH = 1440;

function inches(twips: number): string {
  return `${(twips / TWIPS_PER_INCH).toFixed(4)}in`;
}

/**
 * The measured geometry of the practice's own template, in twips.
 *
 * Exported so a test can assert against the numbers rather than against rendered pixels — font
 * rendering differs across machines, these do not. See `docs/ops/testing-strategy.md`.
 */
export const TEMPLATE_GEOMETRY = {
  /** US Letter **landscape**. Not A4 — the source file says Letter and it is the source of truth. */
  pageWidth: 15840,
  pageHeight: 12240,
  margin: 720,
  tableWidth: 13528,
  /** ⚠️ Sunday is narrower than the rest, deliberately. */
  sundayColumn: 1771,
  otherColumn: 1959.5,
  /** The thin row carrying the day number. */
  dateRow: 270,
  /** The tall row carrying the shift lines. */
  entriesRow: 1040,
  logoWidth: 1253,
  logoHeight: 979,
} as const;

/**
 * Font stacks, as a parameter because the source's fonts cannot be shipped.
 *
 * The first entry in each is what the practice actually uses. The rest are metric-compatible
 * fallbacks in descending order of closeness — Carlito is metric-compatible with Calibri and is
 * SIL-licensed, so it is the safest freely-redistributable choice in the Corbel family's vicinity.
 */
export interface ExportFonts {
  /** Cell text, weekday headers, the month label. Corbel in the source. */
  readonly body: string;
  /** The practice name on the title band. Cooper Black in the source. */
  readonly display: string;
}

export const TEMPLATE_FONTS: ExportFonts = {
  body: "'Corbel', 'Candara', 'Carlito', 'Calibri', 'Segoe UI', sans-serif",
  display: "'Cooper Black', 'Cooper Std Black', 'Georgia', 'Times New Roman', serif",
};

/** Colours measured from the source table's borders and shading. */
const GRID_LINE = '#bfbfbf';
const WEEKDAY_HEADER_FILL = '#d9d9d9';
const WEEKDAY_HEADER_TEXT = '#7f7f7f';

export interface RenderOptions {
  readonly fonts?: ExportFonts;
  /**
   * Emit a `<!doctype html>` wrapper.
   *
   * Off when embedding the grid in a page that already has one. On by default, because the common
   * case is a standalone file handed to a PDF renderer.
   */
  readonly standalone?: boolean;
}

/** Escapes text for HTML. Doctor labels and the practice name are both caller-supplied. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCellLines(cell: GridCell, document_: ExportDocument): string {
  return cell.lines
    .map((line) => {
      // The blank line before the night shift. It appears on every sheet the practice has ever
      // printed and it does real work for legibility at print size — see export.md.
      const gap = line.gapBefore ? ' rst-line--gap' : '';
      return (
        `<div class="rst-line${gap}">` +
        `<span class="rst-who">${escapeHtml(document_.labelFor(line.doctor))}</span>` +
        `<span class="rst-time">${escapeHtml(line.time)}</span>` +
        '</div>'
      );
    })
    .join('');
}

function renderWeek(
  week: readonly (GridCell | null)[],
  document_: ExportDocument,
  weekIndex: number,
): string {
  const dateCells = week
    .map((cell) => {
      if (cell === null) {
        return '<td class="rst-date rst-empty"></td>';
      }
      // A spill day is greyed because it belongs to a different month. A wrapped day is not — it is
      // still this month, just displaced into row one, and the sheets print it as a plain number.
      const spill = cell.kind === 'spill' ? ' rst-date--spill' : '';
      return `<td class="rst-date${spill}">${escapeHtml(cell.label)}</td>`;
    })
    .join('');

  const entryCells = week
    .map((cell) => {
      if (cell === null) {
        return '<td class="rst-entries rst-empty"></td>';
      }
      const holiday =
        cell.holidayName !== undefined && document_.branding.holidayMarking !== 'none'
          ? ` rst-entries--holiday-${document_.branding.holidayMarking}`
          : '';
      return `<td class="rst-entries${holiday}">${renderCellLines(cell, document_)}</td>`;
    })
    .join('');

  return (
    `<tr class="rst-row-date" data-week="${String(weekIndex)}">${dateCells}</tr>` +
    `<tr class="rst-row-entries" data-week="${String(weekIndex)}">${entryCells}</tr>`
  );
}

function styles(fonts: ExportFonts): string {
  const g = TEMPLATE_GEOMETRY;
  return `
@page { size: ${inches(g.pageWidth)} ${inches(g.pageHeight)}; margin: ${inches(g.margin)}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ${fonts.body};
  font-size: 10pt;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.rst-sheet { width: ${inches(g.tableWidth)}; margin: 0 auto; position: relative; }

/* ── The banner: accent band, then the title band ─────────────────────────── */
.rst-accent { height: ${inches(g.logoHeight + 120)}; display: flex; align-items: center; padding: 0 0.12in; }
.rst-logo { width: ${inches(g.logoWidth)}; height: ${inches(g.logoHeight)}; object-fit: contain; }
.rst-title {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 0.06in 0.14in;
}
.rst-practice { font-family: ${fonts.display}; font-size: 20pt; line-height: 1.1; }
.rst-month { font-size: 12pt; font-weight: 700; }

/* ── The grid: 1 weekday header + 5 week blocks of 2 rows each ─────────────── */
.rst-grid {
  width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 0.10in;
}
.rst-grid col.rst-col-sun { width: ${inches(g.sundayColumn)}; }
.rst-grid col.rst-col { width: ${inches(g.otherColumn)}; }
.rst-grid th {
  font-size: 11pt; font-weight: 400; color: ${WEEKDAY_HEADER_TEXT};
  background: ${WEEKDAY_HEADER_FILL}; text-align: center; padding: 0.03in 0;
  border: 0.75pt solid ${GRID_LINE};
}
.rst-grid td { border-left: 0.75pt solid ${GRID_LINE}; border-right: 0.75pt solid ${GRID_LINE}; }

/* ⚠️ Only the DATE row carries a top border. The source draws insideV but no insideH, so the
   date row and the entries row beneath it read as one cell. */
.rst-row-date td { border-top: 0.75pt solid ${GRID_LINE}; }
.rst-grid tr:last-child td { border-bottom: 0.75pt solid ${GRID_LINE}; }

.rst-date {
  height: ${inches(g.dateRow)}; text-align: right; vertical-align: top;
  padding: 0.02in 0.06in 0; font-size: 10pt;
}
.rst-date--spill { color: #7f7f7f; }
.rst-entries { height: ${inches(g.entriesRow)}; vertical-align: top; padding: 0 0.06in 0.04in; }
.rst-entries--holiday-bold { font-weight: 700; }
.rst-entries--holiday-tint { background: #fdf0ee; }
.rst-empty { background: #fff; }

/* ── A shift line: doctor left, time right, on one line ────────────────────── */
.rst-line { display: flex; justify-content: space-between; gap: 0.08in; line-height: 1.25; }
.rst-line--gap { margin-top: 0.09in; }
.rst-who { overflow-wrap: anywhere; }
.rst-time { white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── Draft watermark ──────────────────────────────────────────────────────── */
.rst-draft-note { font-size: 9pt; padding: 0.04in 0.14in; }
.rst-watermark {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-family: ${fonts.display}; font-size: 96pt; color: rgba(0, 0, 0, 0.10);
  transform: rotate(-24deg); pointer-events: none; letter-spacing: 0.1em;
}
`.trim();
}

/**
 * Renders the document. Deterministic: same input, same bytes.
 *
 * No timestamp and no random id in the output, so a diff between two renders shows only what
 * actually changed in the roster. Anything generated-at belongs in the caller's footer.
 */
export function renderExportHtml(document_: ExportDocument, options: RenderOptions = {}): string {
  const fonts = options.fonts ?? TEMPLATE_FONTS;
  const branding = document_.branding;

  const cols = COLUMN_ORDER.map((_, index) =>
    index === 0 ? '<col class="rst-col-sun">' : '<col class="rst-col">',
  ).join('');
  const head = COLUMN_ORDER.map((day) => `<th scope="col">${escapeHtml(day)}</th>`).join('');
  const body = document_.grid.weeks
    .map((week, index) => renderWeek(week, document_, index))
    .join('');

  const logo =
    branding.logo === undefined
      ? ''
      : `<img class="rst-logo" src="${escapeHtml(branding.logo.dataUri)}" alt="${escapeHtml(branding.logo.alt)}">`;

  const draftNote =
    document_.draft === undefined
      ? ''
      : `<div class="rst-draft-note">DRAFT — changes to ${escapeHtml(document_.draft.reviewDeadline)}</div>`;
  const watermark = document_.draft === undefined ? '' : '<div class="rst-watermark">DRAFT</div>';

  const sheet =
    '<div class="rst-sheet">' +
    `<div class="rst-accent" style="background:${escapeHtml(branding.accentBandColour)}">${logo}</div>` +
    `<div class="rst-title" style="background:${escapeHtml(branding.titleBandColour)};color:${escapeHtml(branding.titleTextColour)}">` +
    `<span class="rst-practice">${escapeHtml(branding.practiceName)}</span>` +
    `<span class="rst-month">${escapeHtml(document_.monthLabel)}</span>` +
    '</div>' +
    draftNote +
    `<table class="rst-grid"><colgroup>${cols}</colgroup>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    watermark +
    '</div>';

  if (options.standalone === false) {
    return sheet;
  }
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${escapeHtml(branding.practiceName)} — ${escapeHtml(document_.monthLabel)}</title>` +
    `<style>${styles(fonts)}</style></head><body>${sheet}</body></html>`
  );
}
