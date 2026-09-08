/**
 * Structural assertions for the export renderer.
 *
 * **Deliberately not pixel comparison.** `docs/ops/testing-strategy.md` puts visual regression in a
 * pinned container and never on a development machine, because font metrics differ across operating
 * systems and a screenshot suite run on the host goes permanently red. These assertions carry the
 * real weight instead: they survive a legitimate font update and still catch silent layout breakage,
 * a missing shift, or an unbranded export.
 */

import { describe, expect, it } from 'vitest';

import { buildExportDocument, SYNTHETIC_BRANDING } from './branding.ts';
import { layoutMonth } from './calendar-layout.ts';
import { renderExportHtml, TEMPLATE_FONTS, TEMPLATE_GEOMETRY } from './render-html.ts';

/** A month with the two shapes that matter: a night gap, and a four-line Friday. */
function septemberGrid() {
  return layoutMonth({
    month: '2026-09',
    days: [
      {
        date: '2026-09-01',
        lines: [
          { doctor: 'D01', time: '7-15' },
          { doctor: 'D02', time: '15-23' },
          { doctor: 'D03', time: '23-7' },
        ],
      },
      {
        date: '2026-09-04',
        lines: [
          { doctor: 'D01', time: '7-12' },
          { doctor: 'D02', time: '12-17' },
          { doctor: 'D06', time: '17-23' },
          { doctor: 'D07', time: '23-7' },
        ],
      },
      {
        date: '2026-09-24',
        holidayName: 'Heritage Day',
        lines: [{ doctor: 'D09', time: '7-15' }],
      },
    ],
  });
}

function render(
  overrides: Parameters<typeof buildExportDocument>[0] extends never ? never : object = {},
) {
  return renderExportHtml(buildExportDocument({ grid: septemberGrid(), ...overrides }));
}

describe('the printed sheet', () => {
  it('is US Letter landscape with half-inch margins, as the source file says', () => {
    // ⚠️ NOT A4. `testing-strategy.md` said A4 before the .docx arrived; the file says Letter,
    // 15840 x 12240 twips, and a measured source outranks a remembered one.
    expect(TEMPLATE_GEOMETRY.pageWidth).toBe(15840);
    expect(TEMPLATE_GEOMETRY.pageHeight).toBe(12240);
    expect(render()).toContain('@page { size: 11.0000in 8.5000in; margin: 0.5000in; }');
  });

  it('⚠️ makes the Sunday column narrower than the other six', () => {
    // The single most visible way to stop looking like his sheet is to equalise these. The source
    // table is tblLayout:fixed and Sunday is ~10% narrower on purpose.
    const html = render();
    expect(TEMPLATE_GEOMETRY.sundayColumn).toBeLessThan(TEMPLATE_GEOMETRY.otherColumn);
    expect(html).toContain('col.rst-col-sun { width: 1.2299in; }');
    expect(html).toContain('col.rst-col { width: 1.3608in; }');
    // Seven columns: one Sunday plus six others.
    expect(html.match(/<col class="rst-col-sun">/g)).toHaveLength(1);
    expect(html.match(/<col class="rst-col">/g)).toHaveLength(6);
  });

  it('⚠️ builds a week as two rows, a thin date row above a tall entries row', () => {
    // Not one row with the number floated inside. The source draws insideV but no insideH, so only
    // the date row carries a top border and the pair reads as a single cell.
    const html = render();
    const dateRows = html.match(/<tr class="rst-row-date"/g) ?? [];
    const entryRows = html.match(/<tr class="rst-row-entries"/g) ?? [];
    expect(dateRows).toHaveLength(entryRows.length);
    expect(dateRows.length).toBeGreaterThan(0);
    expect(html).toContain('.rst-row-date td { border-top:');
    // And no horizontal border between the pair.
    expect(html).not.toContain('.rst-row-entries td { border-top:');
  });

  it('never prints a sixth week row', () => {
    // The practice's document cannot: it is eleven rows, one header plus five week blocks. A sixth
    // changes the row height, which changes whether it fits one page.
    const grid = septemberGrid();
    expect(grid.weeks.length).toBeLessThanOrEqual(5);
  });

  it('gives every filled cell a doctor and a time', () => {
    const html = render();
    const lines = html.match(/<div class="rst-line[^"]*">.*?<\/div>/g) ?? [];
    expect(lines.length).toBe(8); // 3 + 4 + 1
    for (const line of lines) {
      expect(line).toMatch(/<span class="rst-who">[^<]+<\/span>/);
      expect(line).toMatch(/<span class="rst-time">[^<]+<\/span>/);
    }
  });

  it('keeps the blank line before the night shift', () => {
    // On every sheet the practice has ever printed. Load-bearing for legibility at print size.
    const html = render();
    expect(html).toContain('rst-line--gap');
    expect(html).toContain('.rst-line--gap { margin-top:');
  });

  it('renders the tenant’s branding, and names nobody by default', () => {
    const html = render();
    expect(html).toContain(SYNTHETIC_BRANDING.practiceName);
    expect(html).toContain(SYNTHETIC_BRANDING.accentBandColour);
    expect(html).toContain(SYNTHETIC_BRANDING.titleBandColour);
    // Handed codes, it prints codes. The real mapping lives in tenant config under private/.
    expect(html).toContain('>D01<');
  });

  it('omits the logo element entirely when a tenant has none', () => {
    // Rather than an empty <img>, which prints as a broken-image box.
    expect(render()).not.toContain('rst-logo"');
  });

  it('embeds a logo as a data URI when one is supplied', () => {
    // A URL would either fail offline or leak a request to whoever hosts it — and this document is
    // printed, PDF'd and screenshotted into WhatsApp.
    const html = renderExportHtml(
      buildExportDocument({
        grid: septemberGrid(),
        branding: {
          ...SYNTHETIC_BRANDING,
          logo: { dataUri: 'data:image/png;base64,AAAA', alt: 'Example practice logo' },
        },
      }),
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt="Example practice logo"');
  });

  it('watermarks a draft and leaves a final export clean', () => {
    // Somebody glancing at a phone screenshot in a WhatsApp group has to tell in one second which
    // one they are holding.
    const draft = renderExportHtml(
      buildExportDocument({
        grid: septemberGrid(),
        draft: { reviewDeadline: '20 September' },
      }),
    );
    // Assert on the ELEMENT, not the class name — the stylesheet always carries the rule, so a
    // bare string match would pass on a final export too.
    expect(draft).toContain('<div class="rst-watermark">DRAFT</div>');
    expect(draft).toContain('20 September');

    expect(render()).not.toContain('<div class="rst-watermark">');
  });

  it('marks a holiday only when the tenant asks for it', () => {
    // `none` is the current default and a legitimate choice: the source .docx has no conditional
    // shading anywhere, so guessing a colour would be inventing house style.
    expect(SYNTHETIC_BRANDING.holidayMarking).toBe('none');
    // The element, not the class name — the stylesheet carries both rules either way.
    expect(render()).not.toContain('<td class="rst-entries rst-entries--holiday');

    const tinted = renderExportHtml(
      buildExportDocument({
        grid: septemberGrid(),
        branding: { ...SYNTHETIC_BRANDING, holidayMarking: 'tint' },
      }),
    );
    expect(tinted).toContain('<td class="rst-entries rst-entries--holiday-tint">');
  });

  it('escapes caller-supplied text', () => {
    // The practice name and doctor labels are both tenant configuration, and an export is a
    // document that gets emailed and printed.
    const html = renderExportHtml(
      buildExportDocument({
        grid: septemberGrid(),
        branding: { ...SYNTHETIC_BRANDING, practiceName: 'A & B <script>' },
      }),
    );
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('prefers the practice’s own fonts and falls back to redistributable ones', () => {
    // ⚠️ Corbel and Cooper Black ship with Windows and Office and cannot be embedded server-side.
    // On his machine the first entry resolves and the output is exact; elsewhere it degrades.
    expect(TEMPLATE_FONTS.body.startsWith("'Corbel'")).toBe(true);
    expect(TEMPLATE_FONTS.display.startsWith("'Cooper Black'")).toBe(true);
    expect(TEMPLATE_FONTS.body).toContain('Carlito');

    const substituted = renderExportHtml(buildExportDocument({ grid: septemberGrid() }), {
      fonts: { body: 'Carlito, sans-serif', display: 'Georgia, serif' },
    });
    expect(substituted).toContain('Carlito, sans-serif');
    expect(substituted).not.toContain('Corbel');
  });

  it('distinguishes a spill day from a wrapped one', () => {
    // Regression, 6 September 2026. `render-export.ts` was not passing `spillDays` at all, so
    // December 2023 rendered an empty Monday where the practice's own sheet prints `1 Jan`
    // beside a wrapped 31 December. Caught by rendering that month and holding it against the
    // photographed sheet — the layout was right, the caller was dropping the input.
    //
    // The two are different things and must not look alike: a WRAPPED day is still this month,
    // displaced into row one, and prints a plain number. A SPILL day belongs to the adjacent
    // month and prints day-plus-month, greyed.
    const grid = layoutMonth({
      month: '2023-12',
      days: [
        { date: '2023-12-31', lines: [{ doctor: 'D03', time: '7-15' }] },
        { date: '2023-12-01', lines: [{ doctor: 'D02', time: '7-17' }] },
      ],
      spillDays: [{ date: '2024-01-01', lines: [{ doctor: 'D03', time: '7-15' }] }],
    });
    const html = renderExportHtml(buildExportDocument({ grid }));

    expect(html).toContain('<td class="rst-date rst-date--spill">1 Jan</td>');
    // The wrapped day is NOT greyed — it is this month.
    expect(html).toContain('<td class="rst-date">31</td>');
  });

  it('is deterministic — same input, same bytes', () => {
    // No timestamp and no random id, so a diff between two renders shows only what changed in the
    // roster. Anything generated-at belongs in the caller's footer.
    expect(render()).toBe(render());
  });

  it('can render the grid alone, for embedding in an existing page', () => {
    const fragment = renderExportHtml(buildExportDocument({ grid: septemberGrid() }), {
      standalone: false,
    });
    expect(fragment.startsWith('<div class="rst-sheet">')).toBe(true);
    expect(fragment).not.toContain('<!doctype html>');
  });
});
