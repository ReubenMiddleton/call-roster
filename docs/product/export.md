# The export

**The printable monthly grid is the artifact of record.** Everything else the product does is a
better version of something the practice already does; this is the thing that either replaces the
Word table or does not.

The failure mode is precise, and it is the single most likely way this project fails: the principal
builds a roster in the app, exports it, decides it does not look right, rebuilds it in Word, does the
work twice, and stops using the app.

He confirmed on 31 August 2026 that it **must look exactly as it looks now**, and offered a blank
template. The geometry below was derived from nineteen photographed exports covering December 2023 to
June 2025, then verified against all 33 transcribed months — and **a real Word source arrived on
6 September 2026**, which settles the typography the photographs could not. See
[*What the Word source settles*](#what-the-word-source-settles) at the foot of this document.

```bash
npm run seed:layout
```

That lays out every real month and checks every cell. It is in the gate.

---

## What is built, and what is not

**Built:** [`lib/export/calendar-layout.ts`](../../lib/export/calendar-layout.ts) — the geometry.
Pure logic, 18 unit tests, and validated against **1,023 real cells across 33 months**, every one
landing in the correct weekday column.

✅ **Also built, 6 September 2026:** the renderer.
[`lib/export/render-html.ts`](../../lib/export/render-html.ts) turns an `ExportDocument` into a
self-contained printable page, and `npm run export:render` prints it through headless Chromium.

```bash
npm run export:render                                    # last month, synthetic branding
node scripts/render-export.ts 2023-12 --branding private/template/branding.json
node scripts/render-export.ts 2026-08 --draft "20 September"
```

Output goes to `private/export/` — the PDF carries doctor labels and, with `--branding`, the
practice's own name and logo, which is exactly what the data boundary keeps out of the repository.
Without `--branding` it renders `SYNTHETIC_BRANDING` and doctor codes and is safe to screenshot.

**Verified against the December 2023 photograph**, cell by cell: the wrapped `31`, the `1 Jan` spill
beside it, the four-line Fridays, the blank line before every 23:00, and the narrower Sunday column.
One page, `MediaBox 792 × 612` — US Letter landscape, from the `@page` rule rather than a second
setting in the PDF call.

⚠️ **That comparison found a real bug.** The renderer was not being passed `spillDays` at all, so
December 2023 came out with an empty Monday where the practice's sheet prints `1 Jan`. The layout
had always handled it; the caller was dropping the input. `loadSeedPeriod` excludes spill days on
purpose — they double-count burden — so the export has to read them from the source document
separately. Regression test: `distinguishes a spill day from a wrapped one`.

---

## The geometry, as the practice produces it

Seven columns, **Sunday through Saturday**. A cell carries the day number top-right, then one line
per shift: doctor left, time right. Times are written the practice's way — `7-15`, `15-23`, `23-7`,
`7-12`, `12-17`, `17-23`, `7-17`.

### The five-row rule, which is the part worth knowing

**A Sunday-start calendar needs six week-rows for about a fifth of all months** — ten of the
forty-eight between 2023 and 2026, and eight of our 33. **The practice never prints a sixth row.**

Instead the trailing days **wrap into the leading empty cells of row one**:

| Month | Shape | What the sheet prints |
|---|---|---|
| **March 2025** | starts Saturday, 31 days | 30 and 31 in row one's Sunday and Monday |
| **June 2024** | starts Saturday, 30 days | 30 in row one's Sunday |
| **December 2023** | starts Friday, 31 days | 31 December in Sunday **and** 1 January in Monday |

**This is not cosmetic.** A sixth row changes the row height, which changes whether the grid fits one
page, which is the difference between a usable export and Word.

### Wrapping and spilling share the same cells

December 2023 is the case that forced them to be computed together: a **wrapped own-day** (31
December) sits beside a **spill day** (1 January) in the same row. So:

- **Wrapping is deterministic.** If the month needs six rows, its trailing days go into row one's
  leading empties, in order, from Sunday rightward. A wrapped day prints a plain number — it is still
  this month.
- **Spilling is optional data.** Adjacent-month dates fill whatever empties remain, **matched to the
  column of their real weekday**. A spill prints day plus month — `1 Jan`, `1 April`, `1 Sept` — which
  is how the sheets disambiguate them.
- **A spill with no free cell in its own column is dropped, not moved.** Printing 1 April under
  Tuesday when Tuesday is taken would misalign the calendar, which is worse than omitting it.

Whether a spill is shown at all is a judgement the scheduler makes, not a rule: June 2024 wraps its
30th and shows no spill; December 2023 wraps and shows one. So the caller supplies them.

### The gap before the night shift

Every one of the nineteen sheets puts a **blank line before the 23:00 row**. It reads as separating
the day from the night and it is load-bearing for legibility at print size.

Detected from the **printed time**, not a shift id — the gap is a property of what the sheet shows, so
a tenant whose night shift is called something else still gets it as long as it starts at 23:00.

### A date with no assignments still prints

Two Saturdays in December 2024 carry a night-shift time with no doctor against it, both circled in red
on the sheet by the practice. The grid must still print those dates: a missing cell would shift every
later day by one.

---

## Branding is per-tenant, and nothing about it is committed

The sheets carry a logo top-left, a light-blue band, then a grey band with the practice name in bold
caps at the left and the month and year at the right.

**All of it is a parameter.** Per [ADR-0010](../architecture/decisions/0010-productisation-seams-first.md)
the export takes branding as input, and per the data boundary **nothing committed names the practice
or embeds its logo** — tests and fixtures use synthetic values. The real name and logo live only in
tenant configuration.

---

## What the Word source settles

Question **G**, answered on 6 September 2026 by a real `.docx` — the January 2019 roster — plus the
practice letterhead as a PDF. Both live in `private/template/source/`, with a blanked template and the
extracted logo beside them. **Every figure below is read out of the file, not inferred from a
photograph.**

| Was inferred | Is now measured |
|---|---|
| Page size and margins | **US Letter landscape**, 15840 × 12240 twips, **0.5″ margins** all four sides |
| Column widths | **Not equal.** Sunday **1771** twips; the other six **1959/1960** — Sunday is ~10% narrower. Table 13528 twips (9.39″), `tblLayout` **fixed** |
| The font | **Corbel** at **10 pt** in the cells; the weekday header is Corbel **11 pt** in `#7F7F7F`, centred |
| The banner | Practice name in **Cooper Black 20 pt white**; month and year in **Corbel bold 12 pt white** |
| The greys and blues | Accent band `#76C5EF`, title band `#7F7F7F`, grid lines `#BFBFBF` at 0.75 pt, weekday header fill `#D9D9D9` |
| An over-long name | **Wraps inside its column.** `tblLayout` is fixed, so a long name can never widen a column — it takes a second line and grows the row |
| Holiday marking | **None.** No conditional shading anywhere in the file, which corroborates the sheet reading |

⚠️ **Both fonts are a licensing problem waiting to happen.** Corbel and Cooper Black ship with
Windows and Office; neither is freely redistributable, so a server-side PDF renderer cannot simply
embed them. Either license them, or choose metric-compatible substitutes **before** he sees the first
export and forms an opinion about how it looks.

### The construction is two rows per week, not one

Worth knowing before rendering: a week is **not** seven cells with a number inside each. It is **two
table rows** — a thin date row (~270 twips, day number right-aligned) above a tall entries row
(~1000–1100 twips). Only the date row carries a top border, and the table style draws `insideV` but
no `insideH`, so a date row and the entries row under it read as a single cell. Reproducing the look
means reproducing that, or matching it deliberately with padding.

The grid is **11 rows: one weekday header plus five week blocks.** The five-row rule above is not an
inference from photographs — the document cannot print a sixth row.

### Provenance, and the one caveat

The file is a **Word 2011 for Mac** document built on Microsoft's stock **`Banner Calendar.dotm`**
template, so the house style is largely Microsoft's rather than the practice's. The logo is an
embedded PNG, 265 px wide, printed at 0.87″ × 0.68″ on the accent band.

⚠️ **It is the January 2019 sheet — four years older than the nineteen photographed ones.** It has not
been confirmed as the template still in use, so the column widths above are 2019's. Open item, logged
in [`NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md): ask whether today's sheets come from this same
file.
